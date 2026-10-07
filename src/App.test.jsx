import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { fixture } from '../test/fixtures.js'

// Leaflet needs a real layout engine; render a stub that exposes what it got.
vi.mock('./components/MapView.jsx', () => ({
  default: ({ geojson, aiGeojson }) => (
    <div data-testid="map">
      {geojson?.features.length ?? 0}/{aiGeojson?.features.length ?? 0}
    </div>
  ),
}))

const MID = '1AbC_def-GhIjKlMnOp'
const settings = { workerUrl: 'https://w.example.dev', appToken: 'secret-token' }

function configure() {
  localStorage.setItem('mymaps-ai.settings', JSON.stringify(settings))
}

function mockFetch(handler) {
  const fn = vi.fn(handler)
  vi.stubGlobal('fetch', fn)
  return fn
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.unstubAllGlobals())

describe('settings screen', () => {
  it('shows settings on first run and saves them', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('form', { name: 'הגדרות' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('כתובת ה-Worker'), 'https://w.example.dev/')
    await user.type(screen.getByLabelText('APP_TOKEN'), 'abc')
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    expect(screen.queryByRole('form', { name: 'הגדרות' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('mymaps-ai.settings'))).toEqual({
      workerUrl: 'https://w.example.dev',
      appToken: 'abc',
    })
  })

  it('rejects an invalid worker URL', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('כתובת ה-Worker'), 'http://insecure.dev')
    await user.type(screen.getByLabelText('APP_TOKEN'), 'abc')
    await user.click(screen.getByRole('button', { name: 'שמירה' }))
    expect(screen.getByRole('alert')).toHaveTextContent('https://')
  })

  it('can reopen settings with the saved values', async () => {
    configure()
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'הגדרות' }))
    expect(screen.getByLabelText('כתובת ה-Worker')).toHaveValue('https://w.example.dev')
  })
})

describe('loading a map', () => {
  it('fetches KML through the worker with the token and shows the map', async () => {
    configure()
    const fetch = mockFetch(async () => new Response(fixture('hebrew-map.kml')))
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('קישור למפה'), `https://www.google.com/maps/d/viewer?mid=${MID}`)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))

    expect(await screen.findByText('טיול בירושלים', { selector: 'strong' })).toBeInTheDocument()
    // Default view is the real Google My Maps embed
    expect(screen.getByTitle('Google My Maps')).toHaveAttribute(
      'src',
      `https://www.google.com/maps/d/embed?mid=${MID}`,
    )
    await user.click(screen.getByRole('tab', { name: 'תצוגה עם שכבת AI' }))
    expect(screen.getByTestId('map')).toHaveTextContent('4/0')
    expect(screen.queryByTitle('Google My Maps')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'My Maps (Google)' }))
    expect(screen.getByTitle('Google My Maps')).toBeInTheDocument()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`https://w.example.dev/kml?mid=${MID}`)
    expect(init.headers['X-App-Token']).toBe('secret-token')
  })

  it('shows an error for a link without a map id', async () => {
    configure()
    const fetch = mockFetch(async () => new Response(''))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('קישור למפה'), 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    expect(screen.getByRole('alert')).toHaveTextContent('mid=')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains a wrong token', async () => {
    configure()
    mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('קישור למפה'), MID)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('APP_TOKEN')
  })
})

describe('My Maps shortcut', () => {
  it('links to the My Maps list in a new tab', () => {
    configure()
    render(<App />)
    const link = screen.getByRole('link', { name: 'פתח My Maps' })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/d/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })
})

describe('recent maps', () => {
  it('remembers loaded maps, reloads with one click, and can forget them', async () => {
    configure()
    const fetch = mockFetch(async () => new Response(fixture('hebrew-map.kml')))
    const user = userEvent.setup()
    render(<App />)
    expect(screen.queryByRole('list', { name: 'מפות אחרונות' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('קישור למפה'), MID)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    const chip = await screen.findByRole('button', { name: 'טיול בירושלים' })
    expect(JSON.parse(localStorage.getItem('mymaps-ai.recent'))).toEqual([{ mid: MID, name: 'טיול בירושלים' }])

    await user.click(chip)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe(`https://w.example.dev/kml?mid=${MID}`)

    await user.click(screen.getByRole('button', { name: 'הסר טיול בירושלים' }))
    expect(screen.queryByRole('list', { name: 'מפות אחרונות' })).not.toBeInTheDocument()
  })

  it('shows previously saved maps on startup', () => {
    configure()
    localStorage.setItem('mymaps-ai.recent', JSON.stringify([{ mid: MID, name: 'Rome 2025' }]))
    render(<App />)
    expect(screen.getByRole('button', { name: 'Rome 2025' })).toBeInTheDocument()
  })
})

describe('offline copy', () => {
  async function loadOnce(user) {
    await user.type(screen.getByLabelText('קישור למפה'), MID)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    await screen.findByText('טיול בירושלים', { selector: 'strong' })
  }

  it('opens a recent map from its saved copy when the network is down', async () => {
    configure()
    mockFetch(async () => new Response(fixture('hebrew-map.kml')))
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await loadOnce(user)
    unmount()

    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'טיול בירושלים' }))

    expect(await screen.findByText(/מוצג עותק שמור/)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveTextContent('4/0')
    expect(screen.queryByTitle('Google My Maps')).not.toBeInTheDocument()
  })

  it('shows the error when offline and nothing was saved', async () => {
    configure()
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('קישור למפה'), MID)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן להתחבר')
  })

  it('does not fall back to the copy on a wrong token', async () => {
    configure()
    mockFetch(async () => new Response(fixture('hebrew-map.kml')))
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await loadOnce(user)
    unmount()

    mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'טיול בירושלים' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('APP_TOKEN')
    expect(screen.queryByText(/מוצג עותק שמור/)).not.toBeInTheDocument()
  })

  it('forgets the saved copy when the map is removed from recents', async () => {
    configure()
    mockFetch(async () => new Response(fixture('hebrew-map.kml')))
    const user = userEvent.setup()
    render(<App />)
    await loadOnce(user)
    expect(localStorage.getItem(`mymaps-ai.kml.${MID}`)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'הסר טיול בירושלים' }))
    expect(localStorage.getItem(`mymaps-ai.kml.${MID}`)).toBeNull()
  })
})

describe('AI assistant', () => {
  const aiKml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>קפה</name>
<Placemark><name>קפה א</name><Point><coordinates>35.22,31.78</coordinates></Point></Placemark>
<Placemark><name>קפה ב</name><Point><coordinates>35.23,31.77</coordinates></Point></Placemark></Document></kml>`

  it('sends the conversation and shows a validated layer', async () => {
    configure()
    const fetch = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: `יצרתי שכבה.\n\`\`\`kml\n${aiKml}\n\`\`\`` } }] }),
    )
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('הודעה ל-AI'), 'צור שכבת בתי קפה')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    expect(await screen.findByText('יצרתי שכבה.')).toBeInTheDocument()
    expect(screen.getByText(/שכבה: קפה \(2 פריטים\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הורדת KML' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveTextContent('0/2')

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://w.example.dev/ai')
    const body = JSON.parse(init.body)
    expect(body.messages).toEqual([{ role: 'user', content: 'צור שכבת בתי קפה' }])
    expect(body.system).toContain('kml')
  })

  it('switches from the Google embed to our map when a layer arrives', async () => {
    configure()
    mockFetch(async (url) =>
      String(url).includes('/kml')
        ? new Response(fixture('hebrew-map.kml'))
        : jsonResponse({ choices: [{ message: { content: `ok\n\`\`\`kml\n${aiKml}\n\`\`\`` } }] }),
    )
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('קישור למפה'), MID)
    await user.click(screen.getByRole('button', { name: 'טעינה' }))
    expect(await screen.findByTitle('Google My Maps')).toBeInTheDocument()

    await user.type(screen.getByLabelText('הודעה ל-AI'), 'שכבה')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    expect(await screen.findByTestId('map')).toHaveTextContent('4/2')
    expect(screen.queryByTitle('Google My Maps')).not.toBeInTheDocument()
  })

  describe('near me', () => {
    const setGeo = (impl) =>
      Object.defineProperty(navigator, 'geolocation', { value: impl, configurable: true })
    afterEach(() => setGeo(undefined))

    it('asks the AI about places near the current position', async () => {
      configure()
      setGeo({ getCurrentPosition: (ok) => ok({ coords: { latitude: 31.7683, longitude: 35.2137 } }) })
      const fetch = mockFetch(async () =>
        jsonResponse({ choices: [{ message: { content: 'הנה כמה מקומות.' } }] }),
      )
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: /מה יש לידי/ }))

      expect(await screen.findByText('הנה כמה מקומות.')).toBeInTheDocument()
      const sent = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content
      expect(sent).toContain('31.76830,35.21370')
    })

    it('explains when location is denied and does not call the AI', async () => {
      configure()
      setGeo({ getCurrentPosition: (_ok, fail) => fail({ code: 1 }) })
      const fetch = mockFetch(async () => jsonResponse({}))
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: /מה יש לידי/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('מיקום')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('explains when the browser has no geolocation', async () => {
      configure()
      setGeo(undefined)
      const user = userEvent.setup()
      render(<App />)
      await user.click(screen.getByRole('button', { name: /מה יש לידי/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('לא תומך')
    })
  })

  it('does not display an invalid AI layer', async () => {
    configure()
    mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: '```kml\n<kml><Document><name>x</name></Document></kml>\n```' } }] }),
    )
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('הודעה ל-AI'), 'שכבה')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    expect(await screen.findByText(/לא תקינה/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הורדת KML' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveTextContent('0/0')
  })

  it('shows worker errors', async () => {
    configure()
    mockFetch(async () => jsonResponse({ error: 'upstream error' }, 502))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('הודעה ל-AI'), 'שלום')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('502: upstream error')
  })
})
