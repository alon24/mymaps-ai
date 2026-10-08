import { describe, expect, it, vi } from 'vitest'
import { ConflictError, decideSync, loadMap, saveMap, serialize, setLinkSharing, shareUrl, shareWith } from './drive'
import { createMap } from '../model/ops'

type Call = { url: URL; init: RequestInit }

/** Fake Drive: routes by method + path, records calls. */
function fakeDrive(routes: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const call = { url, init }
    calls.push(call)
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    const handler = Object.entries(routes).find(([k]) => key.startsWith(k))?.[1]
    if (!handler) return new Response(JSON.stringify({ error: { message: `no route ${key}` } }), { status: 404 })
    const out = handler(call)
    return out instanceof Response ? out : Response.json(out)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe('decideSync', () => {
  it('creates, updates, or reports conflicts based on Drive version', () => {
    expect(decideSync({}, null)).toBe('create')
    expect(decideSync({ driveFileId: 'f', driveVersion: '5' }, null)).toBe('create') // deleted remotely
    expect(decideSync({ driveFileId: 'f', driveVersion: '5' }, '5')).toBe('update')
    expect(decideSync({ driveFileId: 'f', driveVersion: '5' }, '6')).toBe('conflict')
    expect(decideSync({ driveFileId: 'f', driveVersion: '9' }, '10')).toBe('conflict') // numeric, not string compare
    expect(decideSync({ driveFileId: 'f' }, '1')).toBe('conflict')
  })
})

describe('saveMap', () => {
  it('first save: finds/creates the app folder and uploads JSON without sync fields', async () => {
    const { fetch, calls } = fakeDrive({
      'GET /drive/v3/files': () => ({ files: [] }),
      'POST /drive/v3/files': () => ({ id: 'FOLDER' }),
      'POST /upload/drive/v3/files': () => ({ id: 'NEW', version: '1' }),
    })
    const doc = createMap('טיול')
    const res = await saveMap({ token: 'T', fetch }, doc)
    expect(res).toEqual({ fileId: 'NEW', version: '1' })
    const upload = calls.at(-1)!
    expect(new Headers(upload.init.headers).get('Authorization')).toBe('Bearer T')
    const body = String(upload.init.body)
    expect(body).toContain('"parents":["FOLDER"]')
    expect(body).toContain('"name":"טיול.mymap.json"')
    expect(body).toContain(serialize(doc))
  })

  it('updates when versions match and refuses on conflict unless forced', async () => {
    let remote = '3'
    const { fetch, calls } = fakeDrive({
      'GET /drive/v3/files/F': () => ({ id: 'F', version: remote, name: 'x', modifiedTime: '' }),
      'PATCH /upload/drive/v3/files/F': () => ({ id: 'F', version: String(Number(remote) + 1) }),
    })
    const doc = { ...createMap('x'), driveFileId: 'F', driveVersion: '3' }
    expect(await saveMap({ token: 'T', fetch }, doc)).toEqual({ fileId: 'F', version: '4' })

    remote = '7'
    await expect(saveMap({ token: 'T', fetch }, doc)).rejects.toBeInstanceOf(ConflictError)
    const before = calls.length
    expect(await saveMap({ token: 'T', fetch }, doc, { force: true })).toEqual({ fileId: 'F', version: '8' })
    expect(calls.length).toBe(before + 2)
  })
})

describe('loadMap', () => {
  it('reads public files anonymously with the API key, read-only', async () => {
    const stored = createMap('ציבורי')
    const { fetch, calls } = fakeDrive({
      'GET /drive/v3/files/P': (c) =>
        c.url.searchParams.get('alt') === 'media'
          ? JSON.parse(serialize(stored))
          : { id: 'P', version: '12', name: 'n', modifiedTime: '', capabilities: { canEdit: false } },
    })
    const loaded = await loadMap({ apiKey: 'KEY', fetch }, 'P')
    expect(loaded.canEdit).toBe(false)
    expect(loaded.doc).toMatchObject({ title: 'ציבורי', driveFileId: 'P', driveVersion: '12' })
    expect(calls.every((c) => c.url.searchParams.get('key') === 'KEY')).toBe(true)
  })

  it('reports non-map files clearly', async () => {
    const { fetch } = fakeDrive({
      'GET /drive/v3/files/X': (c) =>
        c.url.searchParams.get('alt') === 'media' ? new Response('not json') : { id: 'X', version: '1' },
    })
    await expect(loadMap({ token: 'T', fetch }, 'X')).rejects.toThrow(/אינו מפה/)
  })
})

describe('sharing', () => {
  it('turns link sharing on/off and invites by email', async () => {
    const { fetch, calls } = fakeDrive({
      'POST /drive/v3/files/F/permissions': () => ({ id: 'p1' }),
      'GET /drive/v3/files/F/permissions': () => ({ permissions: [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }] }),
      'DELETE /drive/v3/files/F/permissions/anyoneWithLink': () => new Response(null, { status: 204 }),
    })
    await setLinkSharing({ token: 'T', fetch }, 'F', true)
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ type: 'anyone', role: 'reader' })
    await setLinkSharing({ token: 'T', fetch }, 'F', false)
    expect(calls.at(-1)!.init.method).toBe('DELETE')
    await shareWith({ token: 'T', fetch }, 'F', ' a@b.com ', 'writer', 'הצטרף')
    const invite = calls.at(-1)!
    expect(JSON.parse(String(invite.init.body))).toEqual({ type: 'user', role: 'writer', emailAddress: 'a@b.com' })
    expect(invite.url.searchParams.get('emailMessage')).toBe('הצטרף')
  })

  it('builds app share links', () => {
    expect(shareUrl('https://a.io/app/', 'ID')).toBe('https://a.io/app/#/m/ID')
  })
})
