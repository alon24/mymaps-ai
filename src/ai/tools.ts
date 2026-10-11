/**
 * Tools the AI can call before it answers. The app runs them (from the browser) and returns the
 * results; the AI then refers to found places by `result_id`, so coordinates always come from
 * OpenStreetMap, never from the model.
 */
import { CATEGORIES, isCategory, searchNearby, type PlaceResult } from '../geo/places'
import { geocode } from '../geo/search'

export const MAX_TOOL_STEPS = 3

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
  const what = (typeof a.category === 'string' && LABEL[a.category]) || (typeof a.query === 'string' && a.query) || 'מקומות'
  const near = a.near === 'me' ? 'לידך' : a.near === 'map' || !a.near ? 'באזור המפה' : `ליד ${String(a.near)}`
  return `מחפש ${what} ${near}…`
}

/** Run one tool call; returns the JSON string sent back to the model. Never throws. */
export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
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
