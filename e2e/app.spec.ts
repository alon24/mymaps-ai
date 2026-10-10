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
  // New items are added closed: they flash in their layer instead of opening the editor
  await expect(page.getByLabel('שם', { exact: true })).toHaveCount(0)
  await expect(page.locator('.frow.is-new')).toHaveCount(1)
  await page.locator('.toast').getByRole('button', { name: 'ערוך' }).click()
  await page.locator('.editor__title button').click()
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
  await page.getByRole('button', { name: 'מחק פריט' }).click()
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

test('back up all maps and restore them', async ({ page }) => {
  await addPoint(page, 'לגיבוי', 0.5, 0.4)
  await page.getByRole('button', { name: 'תפריט' }).click()
  await page.getByRole('menuitem', { name: /המפות שלי/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /גבה את כל המפות/ }).click()
  const path = await (await download).path()
  const backup = JSON.parse(readFileSync(path!, 'utf8'))
  expect(backup.app).toBe('mymaps-ai')
  expect(JSON.stringify(backup.maps)).toContain('לגיבוי')
  await page.locator('.backup input[type=file]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: readFileSync(path!) })
  await expect(page.locator('.toast')).toContainText('שוחזרו')
})

test('menu shows the version and opens About', async ({ page }) => {
  await page.getByRole('button', { name: 'תפריט' }).click()
  await expect(page.locator('.menu__version')).toContainText(/גרסה \d+\.\d+/)
  await page.getByRole('menuitem', { name: /אודות/ }).click()
  const about = page.getByRole('dialog', { name: 'אודות MyMaps AI' })
  await expect(about).toBeVisible()
  await expect(about.getByText('גרסה', { exact: true })).toBeVisible()
  await expect(about.getByRole('button', { name: /בדוק עדכונים/ })).toBeVisible()
})

test('AI promised places but sent no actions: the app asks again, then adds them', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('mymaps-ai.settings', JSON.stringify({ workerUrl: `${location.origin}/__worker`, appToken: 't' })))
  await page.reload()
  // Geocoding is mocked: every query resolves near Tel Aviv
  await page.unroute(/tile\.openstreetmap|arcgisonline|opentopomap|fonts\.(googleapis|gstatic)|nominatim/)
  await page.route(/tile\.openstreetmap|arcgisonline|opentopomap|fonts\.(googleapis|gstatic)/, (r) => r.abort())
  let n = 0
  await page.route(/nominatim/, (r) => r.fulfill({ json: [{ lat: String(32.07 + n++ * 0.004), lon: '34.77', name: 'מקום', display_name: 'מקום, תל אביב' }] }))
  const bodies: { messages: { role: string; content: string }[] }[] = []
  await page.route('**/__worker/ai', async (route) => {
    bodies.push(route.request().postDataJSON())
    const content =
      bodies.length === 1
        ? JSON.stringify({ reply: 'בסדר, מוסיף 2 מקומות לשכבה החדשה "הצעות".' })
        : JSON.stringify({ reply: 'הנה', actions: [{ type: 'add_layer', layer_name: 'הצעות', features: [{ place: 'Carmel Market, Tel Aviv' }, { place: 'Jaffa Port, Tel Aviv' }] }] })
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content } }] } })
  })
  await page.getByRole('tab', { name: /AI/ }).click()
  await page.getByLabel('הודעה לעוזר').fill('הצע 2 מקומות והוסף לשכבה חדשה')
  await page.getByRole('button', { name: 'שלח' }).click()
  await expect(page.locator('.proposal li')).toHaveText([/שכבה חדשה "הצעות" עם 2 מקומות/])
  expect(bodies).toHaveLength(2)
  expect(bodies[1].messages.at(-1)!.content).toContain('no valid "actions"')
  await page.getByRole('button', { name: /החל שינויים/ }).click()
  await expect(page.locator('.proposal')).toContainText('נוספו 2 מקומות', { timeout: 10_000 })
})

test('AI sends no actions twice: the app says nothing was added and offers a retry', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('mymaps-ai.settings', JSON.stringify({ workerUrl: `${location.origin}/__worker`, appToken: 't' })))
  await page.reload()
  await page.route('**/__worker/ai', (route) =>
    route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify({ reply: 'הנה 5 מקומות מומלצים: א, ב, ג' }) } }] } }),
  )
  await page.getByRole('tab', { name: /AI/ }).click()
  await page.getByLabel('הודעה לעוזר').fill('הצע 5 מקומות והוסף אותם לשכבה חדשה')
  await page.getByRole('button', { name: 'שלח' }).click()
  await expect(page.getByText('ה-AI לא שלח שינויים שאפשר להחיל')).toBeVisible()
  await expect(page.getByRole('button', { name: 'נסה שוב' })).toBeVisible()
})

test('Check for updates reads the server version; a stale build never loops forever', async ({ page }) => {
  await page.route('**/version.json*', (r) => r.fulfill({ json: { version: '9.9.9' } }))
  await page.getByRole('button', { name: 'תפריט' }).click()
  await page.getByRole('menuitem', { name: /אודות/ }).click()
  await page.getByRole('button', { name: /בדוק עדכונים/ }).click()
  // The served build stays old here: after one automatic retry the app stops and says so
  await expect(page.getByText('הגרסה החדשה לא נטענה')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).searchParams.has('v')).toBe(false)
})

test('Check for updates says when already on the latest version', async ({ page }) => {
  await page.route('**/version.json*', (r) => r.fulfill({ json: { version: '1.0.0' } }))
  await page.getByRole('button', { name: 'תפריט' }).click()
  await page.getByRole('menuitem', { name: /אודות/ }).click()
  await page.getByRole('button', { name: /בדוק עדכונים/ }).click()
  await expect(page.getByText(/אתה בגרסה האחרונה/)).toBeVisible()
})
