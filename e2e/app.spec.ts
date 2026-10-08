import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Map tiles and fonts are external; tests don't need them.
test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap|arcgisonline|opentopomap|fonts\.(googleapis|gstatic)|nominatim/, (r) => r.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

async function addPoint(page: Page, name: string, x: number, y: number) {
  await page.getByRole('button', { name: 'הוסף נקודה' }).click()
  const map = page.locator('.map')
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width * x, box.y + Math.min(box.height * y, 300))
  const field = page.getByLabel('שם', { exact: true })
  await field.fill(name)
  await field.press('Enter')
  await page.getByRole('button', { name: 'סיום עריכה' }).click()
}

async function dragOnto(page: Page, source: string, target: string) {
  const handle = page.locator(`[data-sort-item] :text("${source}")`).locator('xpath=ancestor::*[@data-sort-item][1]').locator('[data-sort-handle]')
  const from = (await handle.boundingBox())!
  const to = (await page.locator(target).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('add points, plan a trip day with numbered stops, export the itinerary', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'drag uses a mouse here; touch drag is covered on desktop logic')
  await addPoint(page, 'חוף', 0.45, 0.4)
  await addPoint(page, 'שוק', 0.55, 0.45)
  await addPoint(page, 'מוזיאון', 0.65, 0.5)
  await expect(page.locator('.frow')).toHaveCount(3)

  await page.getByRole('tab', { name: /מסלול/ }).click()
  await page.getByRole('button', { name: /הוסף יום/ }).click()
  const day = page.locator('.day').first()
  await expect(day).toContainText('יום 1')

  await dragOnto(page, 'שוק', '.day .stops')
  await dragOnto(page, 'חוף', '.day .stops')
  await expect(day.locator('.stop__num')).toHaveText(['1', '2'])
  await expect(day.locator('.stop__name')).toHaveText([/שוק/, /חוף/])
  // numbered pins on the map
  await expect(page.locator('.pin--num')).toHaveCount(2)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /מסלול לטיול/ }).click()
  const file = await (await download).path()
  const html = readFileSync(file!, 'utf8')
  expect(html).toContain('שוק')
  expect(html).toContain('https://www.google.com/maps/dir/?api=1&amp;destination=')
})

test('export KML and import it back as a new map', async ({ page }) => {
  await addPoint(page, 'נקודה לייצוא', 0.5, 0.4)
  await page.getByRole('button', { name: 'תפריט' }).click()
  await page.getByRole('menuitem', { name: /ייצוא/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^KML/ }).click()
  const path = await (await download).path()
  await page.getByRole('button', { name: 'סגור' }).click()

  await page.getByRole('button', { name: 'תפריט' }).click()
  await page.getByRole('menuitem', { name: /ייבוא/ }).click()
  await page.getByRole('button', { name: 'כמפה חדשה' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'map.kml', mimeType: 'application/vnd.google-earth.kml+xml', buffer: readFileSync(path!) })
  await expect(page.getByText(/יובאו 1 פריטים/)).toBeVisible()
  await expect(page.locator('.frow')).toContainText(['נקודה לייצוא'])
})

test('undo restores a deleted point', async ({ page }) => {
  await addPoint(page, 'למחיקה', 0.5, 0.4)
  await page.locator('.frow__main', { hasText: 'למחיקה' }).click()
  await page.getByRole('button', { name: /מחק/ }).click()
  await expect(page.locator('.frow')).toHaveCount(0)
  await page.getByRole('button', { name: 'בטל', exact: true }).click()
  await expect(page.locator('.frow')).toHaveCount(1)
})

test('AI tab explains setup when no Worker is configured', async ({ page }) => {
  await page.getByRole('tab', { name: /AI/ }).click()
  await expect(page.getByText('כדי להשתמש בעוזר ה-AI צריך לחבר את ה-Worker.')).toBeVisible()
})

test('AI proposes changes, user applies them, undo reverts', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('mymaps-ai.settings', JSON.stringify({ workerUrl: `${location.origin}/__worker`, appToken: 't' })))
  await page.reload()
  await addPoint(page, 'א', 0.45, 0.4)
  await addPoint(page, 'ב', 0.6, 0.45)
  // Same-origin mock Worker (no CORS preflight involved)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.route('**/__worker/ai', async (route) => {
    const body = route.request().postDataJSON() as { system: string }
    const ids = [...body.system.matchAll(/"id":"([^"]+)","name":"(א|ב)"/g)].map((m) => m[1])
    const content = JSON.stringify({
      reply: 'יצרתי יום אחד עם שתי העצירות.',
      actions: [
        { type: 'add_layer', layer_name: 'יום 1', day: { date: '2026-11-02' } },
        { type: 'move_features', ids, layer_name: 'יום 1' },
      ],
    })
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content } }] } })
  })
  await page.getByRole('tab', { name: /AI/ }).click()
  await page.getByLabel('הודעה לעוזר').fill('תכנן יום')
  await page.getByRole('button', { name: 'שלח' }).click()
  await expect(page.locator('.msg--assistant').last()).toContainText('יצרתי יום אחד')
  expect(errors).toEqual([])
  await expect(page.locator('.proposal li')).toHaveText([/שכבה חדשה "יום 1"/, /העברת 2 פריטים/])
  await page.getByRole('button', { name: /החל שינויים/ }).click()
  await expect(page.locator('.pin--num')).toHaveCount(2)
  await page.getByRole('tab', { name: /מסלול/ }).click()
  await expect(page.locator('.day')).toContainText('יום 1')
  await page.getByRole('button', { name: 'בטל (Ctrl+Z)' }).click()
  await expect(page.locator('.day')).toHaveCount(0)
})
