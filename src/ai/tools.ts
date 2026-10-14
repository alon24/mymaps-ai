/**
 * Tools the AI can call before it answers. The app runs them (from the browser) and returns the
 * results; the AI then refers to found places by `result_id`, so coordinates always come from
 * OpenStreetMap, never from the model.
 */
import { CATEGORIES, isCategory, searchNearby, type PlaceResult } from '../geo/places'
import { geocode } from '../geo/search'
import type { WebResult } from '../lib/api'

/** Tool rounds per question: e.g. web search → locate the places → (one spare) */
export const MAX_TOOL_STEPS = 4

/** Web searches allowed per question (each costs ~$0.02 on OpenRouter) */
export const MAX_WEB_SEARCHES = 1

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_places',
      description:
        'Find REAL places on OpenStreetMap around a location. Use it before suggesting any place to visit, eat, sleep etc. ' +
        'Returns places with result ids, distance, and when known cuisine, opening hours and website. ' +
        'Search by category (best for "restaurants near X"), optionally narrowed by query (e.g. "sushi"), or by name with query only.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(CATEGORIES), description: 'kind of place' },
          query: { type: 'string', description: 'a name, or a word to match such as a cuisine ("sushi", "hummus")' },
          near: { type: 'string', description: '"me" (the user\'s GPS), "map" (the map center), or a place/city name such as "Rehovot"' },
          radius_km: { type: 'number', description: 'search radius, 0.2–25 km (default 3)' },
          limit: { type: 'number', description: 'max results, 1–30 (default 12)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the web (reviews, "best of" lists) for RECOMMENDED places. Use it only when the user asks for recommendations, ' +
        'the best, popular or highly rated places; at most once per question. Returns place names with town, why and source. ' +
        'Then locate each chosen place with search_places (query = the name, near = the town) and reference it by result_id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'what to look for, in English or Hebrew, e.g. "best brunch cafes"' },
          near: { type: 'string', description: 'the town or area, e.g. "Rehovot"' },
        },
        required: ['query'],
      },
    },
  },
]

export interface ToolCall {
  id: string
  type?: 'function'
  function: { name: string; arguments: string }
}

export interface ToolContext {
  mapCenter: [number, number]
  userLocation?: [number, number] | null
  /** every place returned during the conversation, by id (used to resolve result_id) */
  registry: Map<string, PlaceResult>
  /** injectable for tests */
  search?: typeof searchNearby
  geocodeFn?: typeof geocode
  /** web search (Worker /web); absent = not available */
  web?: (query: string, near?: string) => Promise<WebResult>
  /** web searches used for the current question */
  webUsed?: number
  /** sources from web searches, shown under the answer */
  sources?: { url: string; title: string }[]
}

const LABEL: Record<string, string> = {
  restaurant: 'מסעדות', cafe: 'בתי קפה', bar: 'ברים', fast_food: 'אוכל מהיר', bakery: 'מאפיות', ice_cream: 'גלידריות',
  museum: 'מוזיאונים', attraction: 'אטרקציות', viewpoint: 'תצפיות', historic: 'אתרים היסטוריים', park: 'פארקים',
  nature: 'שמורות טבע', beach: 'חופים', playground: 'גני שעשועים', hotel: 'מקומות לינה', supermarket: 'סופרמרקטים',
  parking: 'חניונים', fuel: 'תחנות דלק', station: 'תחנות',
}

/** Hebrew progress line for the chat, e.g. "מחפש מסעדות ליד רחובות…" */
export function describeCall(call: ToolCall): string {
  let a: Record<string, unknown> = {}
  try {
    a = JSON.parse(call.function.arguments || '{}')
  } catch {
    /* shown generically */
  }
  if (call.function.name === 'web_search') return `מחפש המלצות ברשת: ${String(a.query ?? '')}${a.near ? ` (${String(a.near)})` : ''}…`
  const what = (typeof a.category === 'string' && LABEL[a.category]) || (typeof a.query === 'string' && a.query) || 'מקומות'
  const near = a.near === 'me' ? 'לידך' : a.near === 'map' || !a.near ? 'באזור המפה' : `ליד ${String(a.near)}`
  return `מחפש ${what} ${near}…`
}

/** Run one tool call; returns the JSON string sent back to the model. Never throws. */
export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  if (call.function.name === 'web_search') return runWebSearch(call, ctx)
  if (call.function.name !== 'search_places') return JSON.stringify({ error: `unknown tool ${call.function.name}` })
  let a: Record<string, unknown> = {}
  try {
    a = JSON.parse(call.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: 'arguments must be JSON' })
  }
  try {
    let center: [number, number] = ctx.mapCenter
    if (a.near === 'me' && ctx.userLocation) center = ctx.userLocation
    else if (typeof a.near === 'string' && a.near !== 'me' && a.near !== 'map' && a.near.trim()) {
      const hit = await (ctx.geocodeFn ?? geocode)(a.near)
      if (!hit) return JSON.stringify({ error: `could not find "${a.near}"`, results: [] })
      center = [hit.lat, hit.lng]
    }
    const results = await (ctx.search ?? searchNearby)({
      center,
      category: isCategory(a.category) ? a.category : undefined,
      query: typeof a.query === 'string' ? a.query : undefined,
      radiusKm: typeof a.radius_km === 'number' ? a.radius_km : undefined,
      limit: typeof a.limit === 'number' ? a.limit : undefined,
    })
    for (const r of results) ctx.registry.set(r.id, r)
    return JSON.stringify({
      results: results.map((r) => ({
        result_id: r.id,
        name: r.name,
        at: [Number(r.lat.toFixed(4)), Number(r.lng.toFixed(4))],
        distance_km: r.distance_km,
        ...(r.category ? { category: r.category } : {}),
        ...(r.cuisine ? { cuisine: r.cuisine } : {}),
        ...(r.opening_hours ? { opening_hours: r.opening_hours } : {}),
        ...(r.website ? { website: r.website } : {}),
        ...(r.address ? { address: r.address } : {}),
        ...(r.notable ? { notable: true } : {}),
      })),
      ...(results.length ? {} : { note: 'nothing found; try a larger radius or another category' }),
    })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'search failed', results: [] })
  }
}

async function runWebSearch(call: ToolCall, ctx: ToolContext): Promise<string> {
  if (!ctx.web) return JSON.stringify({ error: 'web search is not available; use search_places' })
  if ((ctx.webUsed ?? 0) >= MAX_WEB_SEARCHES) return JSON.stringify({ error: 'web search already used for this question; use search_places' })
  let a: Record<string, unknown> = {}
  try {
    a = JSON.parse(call.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: 'arguments must be JSON' })
  }
  const query = typeof a.query === 'string' ? a.query.trim() : ''
  if (!query) return JSON.stringify({ error: 'query is required' })
  ctx.webUsed = (ctx.webUsed ?? 0) + 1
  try {
    const r = await ctx.web(query, typeof a.near === 'string' ? a.near : undefined)
    if (ctx.sources) for (const s of r.sources) if (!ctx.sources.some((x) => x.url === s.url)) ctx.sources.push(s)
    return JSON.stringify({
      places: r.places,
      ...(r.places.length ? { next: 'locate the ones you choose with search_places (query = name, near = town)' } : { note: 'nothing found; use search_places by category' }),
    })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'web search failed; use search_places' })
  }
}
