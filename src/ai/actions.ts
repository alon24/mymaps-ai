/**
 * AI → map changes. The model returns JSON { reply, actions }. Actions are validated with zod,
 * described for a preview, and applied only after the user confirms — as one undo step.
 * New places are geocoded by the app from a search query; the model never supplies raw coordinates.
 */
import { z } from 'zod'
import * as ops from '../model/ops'
import type { MapDoc, MapFeature } from '../model/types'
import { PALETTE, ICONS } from '../model/types'
import { normalizeColor } from '../io/normalize'

const color = z
  .string()
  .transform((v) => normalizeColor(v))
  .refine((v): v is string => Boolean(v), 'color must be #rrggbb')
const ids = z.array(z.string()).min(1)
const day = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined), route: z.boolean().default(true).catch(true) })
// Optional details never sink a whole action: a bad value is just dropped
const optColor = color.optional().catch(undefined)
const optIcon = z.string().max(8).optional().catch(undefined)
const optText = z.string().optional().catch(undefined)
const optStyle = z.enum(['individual', 'uniform', 'numbered']).optional().catch(undefined)

const newPlace = z.union([
  z.object({
    place: z.string().min(2).describe('search query for a real place, e.g. "Café Landwer Dizengoff Tel Aviv"'),
    name: optText,
    description: optText,
    color: optColor,
    icon: optIcon,
  }),
  z.object({
    from_feature_id: z.string(),
    name: optText,
    description: optText,
    color: optColor,
    icon: optIcon,
  }),
])

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_layer'),
    layer_name: z.string().min(1),
    color: optColor,
    style: optStyle,
    day: day.optional().catch(undefined),
    features: z.array(newPlace).default([]),
  }),
  z.object({
    type: z.literal('add_places'),
    layer_name: z.string().min(1),
    features: z.array(newPlace).min(1),
  }),
  z.object({
    type: z.literal('update_features'),
    updates: z
      .array(
        z.object({
          id: z.string(),
          name: optText,
          description: optText,
          color: optColor,
          icon: optIcon,
        }),
      )
      .min(1),
  }),
  z.object({ type: z.literal('move_features'), ids, layer_name: z.string().min(1) }),
  z.object({ type: z.literal('delete_features'), ids }),
  z.object({ type: z.literal('reorder_layer'), layer_name: z.string().min(1), ids }),
  z.object({
    type: z.literal('set_layer'),
    layer_name: z.string().min(1),
    new_name: optText,
    color: optColor,
    style: optStyle,
    day: day.nullable().optional(),
    route: z.boolean().optional().catch(undefined),
  }),
  z.object({ type: z.literal('highlight'), ids, note: z.string().optional() }),
])

export type AiAction = z.infer<typeof actionSchema>

export interface AiResponse {
  reply: string
  actions: AiAction[]
  /** Actions the model sent that failed validation (shown as a warning) */
  rejected: number
}

/** Pull the JSON object out of a model reply (tolerates ```json fences and surrounding text). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

type Loose = Record<string, unknown>
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Map the place shapes models actually produce onto {place, ...}. */
function normalizePlace(p: unknown): unknown {
  if (typeof p === 'string') return { place: p }
  if (!isObj(p) || p.place || p.from_feature_id) return p
  const query = str(p.query) ?? str(p.search) ?? str(p.address_query)
  const name = str(p.name) ?? str(p.title)
  const where = str(p.address) ?? [str(p.city), str(p.area)].filter(Boolean).join(', ')
  const place = query ?? (name && where ? `${name}, ${where}` : name ?? where)
  return place ? { ...p, place } : p
}

/** Map common field-name slips (places/layer/name) onto the schema before validating. */
function normalizeAction(a: unknown): unknown {
  if (!isObj(a)) return a
  const out: Loose = { ...a }
  if (typeof out.type === 'string') out.type = out.type.trim().toLowerCase()
  if (out.type === 'add_layer' || out.type === 'add_places' || out.type === 'move_features' || out.type === 'reorder_layer' || out.type === 'set_layer') {
    out.layer_name ??= str(a.layer) ?? str(a.layerName) ?? (out.type === 'set_layer' ? undefined : str(a.name))
  }
  if (out.type === 'add_layer' || out.type === 'add_places') {
    const list = Array.isArray(a.features) ? a.features : Array.isArray(a.places) ? a.places : Array.isArray(a.items) ? a.items : undefined
    if (list) out.features = list.map(normalizePlace)
  }
  return out
}

/** The reply says it is changing the map (Hebrew/English), e.g. "מוסיף", "הוספתי", "adding". */
const PROMISES_CHANGE = /(מוסיף|אוסיף|הוספתי|נוסיף|הוספת|יצרתי|אצור|יוצר|מעביר|העברתי|מחקתי|אמחק|עדכנתי|אעדכן|\badd(ed|ing)?\b|\bcreat(ed|ing)\b|\bmov(ed|ing)\b|\bupdat(ed|ing)\b)/i

/**
 * True when the model should be asked again for the actions: it promised a change but sent none
 * (a common gpt-4o-mini slip), or everything it sent failed validation.
 */
export function needsRepair(_userText: string, res: AiResponse): boolean {
  if (res.actions.length) return false
  return res.rejected > 0 || PROMISES_CHANGE.test(res.reply)
}

export const REPAIR_PROMPT =
  'Your last reply said you would change the map, but it contained no valid "actions". Reply again with the same JSON object, ' +
  'this time including the "actions" array exactly in the documented format (e.g. add_layer with "layer_name" and "features": [{"place": "<name, street, city>"}]). JSON only.'

export function parseAiResponse(text: string): AiResponse {
  const data = extractJson(text) as { reply?: unknown; actions?: unknown } | null
  if (!data || typeof data !== 'object') return { reply: text.trim(), actions: [], rejected: 0 }
  const rawActions = Array.isArray(data.actions) ? data.actions : []
  const actions: AiAction[] = []
  let rejected = 0
  for (const a of rawActions) {
    const r = actionSchema.safeParse(normalizeAction(a))
    if (r.success) actions.push(r.data)
    else rejected++
  }
  return { reply: typeof data.reply === 'string' ? data.reply : '', actions, rejected }
}

/** True when actions would change the map (highlight-only does not). */
export const changesMap = (actions: AiAction[]) => actions.some((a) => a.type !== 'highlight')

const nameOf = (doc: MapDoc, id: string) => ops.findFeature(doc, id)?.feature.properties.name || 'פריט'

/** Human-readable Hebrew preview lines for the confirm card. */
export function describeActions(doc: MapDoc, actions: AiAction[]): string[] {
  return actions.map((a) => {
    switch (a.type) {
      case 'add_layer':
        return `שכבה חדשה "${a.layer_name}"${a.day ? ' (יום בטיול)' : ''}${a.features.length ? ` עם ${a.features.length} מקומות` : ''}`
      case 'add_places':
        return `הוספת ${a.features.length} מקומות לשכבה "${a.layer_name}"`
      case 'update_features':
        return `עדכון ${a.updates.length} פריטים: ${a.updates.slice(0, 4).map((u) => nameOf(doc, u.id)).join(', ')}${a.updates.length > 4 ? '…' : ''}`
      case 'move_features':
        return `העברת ${a.ids.length} פריטים לשכבה "${a.layer_name}"`
      case 'delete_features':
        return `מחיקת ${a.ids.length} פריטים: ${a.ids.slice(0, 4).map((id) => nameOf(doc, id)).join(', ')}${a.ids.length > 4 ? '…' : ''}`
      case 'reorder_layer':
        return `סידור מחדש של "${a.layer_name}"`
      case 'set_layer':
        return `עדכון השכבה "${a.layer_name}"${a.new_name ? ` → "${a.new_name}"` : ''}${a.day === null ? ' (ביטול יום)' : a.day ? ' (יום בטיול)' : ''}`
      case 'highlight':
        return `סימון ${a.ids.length} פריטים`
    }
  })
}

export type Geocoder = (query: string) => Promise<{ lat: number; lng: number; name: string } | null>

export interface ApplyResult {
  doc: MapDoc
  /** Place queries that could not be found */
  notFound: string[]
}

const findLayer = (doc: MapDoc, name: string) =>
  doc.layers.find((l) => l.name.trim() === name.trim()) ?? doc.layers.find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase())

function ensureLayer(doc: MapDoc, name: string): { doc: MapDoc; layerId: string } {
  const existing = findLayer(doc, name)
  if (existing) return { doc, layerId: existing.id }
  const layer = ops.createLayer(name, [], { color: ops.nextLayerColor(doc) })
  return { doc: ops.addLayer(doc, layer), layerId: layer.id }
}

const validIcon = (icon?: string) => (icon && (ICONS as readonly string[]).includes(icon) ? icon : icon && icon.length <= 4 ? icon : undefined)

async function resolvePlaces(
  doc: MapDoc,
  places: z.infer<typeof newPlace>[],
  geocode: Geocoder,
  defaultColor: string,
  notFound: string[],
): Promise<MapFeature[]> {
  const out: MapFeature[] = []
  for (const p of places) {
    if ('from_feature_id' in p) {
      const src = ops.findFeature(doc, p.from_feature_id)?.feature
      if (!src) continue
      out.push(
        ops.createFeature(src.geometry, {
          name: p.name ?? src.properties.name,
          description: p.description ?? src.properties.description,
          color: p.color ?? src.properties.color,
          icon: validIcon(p.icon) ?? src.properties.icon,
        }),
      )
      continue
    }
    const hit = await geocode(p.place)
    if (!hit) {
      notFound.push(p.place)
      continue
    }
    out.push(
      ops.createFeature(
        { type: 'Point', coordinates: [hit.lng, hit.lat] },
        { name: p.name ?? hit.name, description: p.description ?? '', color: p.color ?? defaultColor, icon: validIcon(p.icon) },
      ),
    )
  }
  return out
}

/** Apply validated actions to a document. Pure apart from the injected geocoder. */
export async function applyActions(doc: MapDoc, actions: AiAction[], geocode: Geocoder): Promise<ApplyResult> {
  let d = doc
  const notFound: string[] = []
  for (const a of actions) {
    switch (a.type) {
      case 'add_layer': {
        const layerColor = a.color ?? ops.nextLayerColor(d)
        const features = await resolvePlaces(d, a.features, geocode, layerColor, notFound)
        d = ops.addLayer(
          d,
          ops.createLayer(a.layer_name, features, {
            color: layerColor,
            style: a.style ?? (a.day ? 'numbered' : 'individual'),
            day: a.day,
          }),
        )
        break
      }
      case 'add_places': {
        const r = ensureLayer(d, a.layer_name)
        d = r.doc
        const layer = d.layers.find((l) => l.id === r.layerId)!
        for (const f of await resolvePlaces(d, a.features, geocode, layer.color ?? PALETTE[0], notFound)) d = ops.addFeature(d, r.layerId, f)
        break
      }
      case 'update_features':
        for (const u of a.updates) {
          if (!ops.findFeature(d, u.id)) continue
          const { id, icon, ...patch } = u
          d = ops.updateFeature(d, id, { ...patch, ...(icon !== undefined ? { icon: validIcon(icon) } : {}) })
        }
        break
      case 'move_features': {
        const r = ensureLayer(d, a.layer_name)
        d = r.doc
        for (const id of a.ids) {
          const target = d.layers.find((l) => l.id === r.layerId)!
          d = ops.placeFeature(d, id, r.layerId, target.features.length)
        }
        break
      }
      case 'delete_features':
        for (const id of a.ids) d = ops.removeFeature(d, id)
        break
      case 'reorder_layer': {
        const layer = findLayer(d, a.layer_name)
        if (!layer) break
        a.ids
          .filter((id) => layer.features.some((f) => f.properties.id === id))
          .forEach((id, i) => {
            d = ops.placeFeature(d, id, layer.id, i)
          })
        break
      }
      case 'set_layer': {
        const layer = findLayer(d, a.layer_name)
        if (!layer) break
        if (a.new_name) d = ops.renameLayer(d, layer.id, a.new_name)
        if (a.day !== undefined) d = ops.setLayerDay(d, layer.id, a.day)
        if (a.route !== undefined) d = ops.setLayerRoute(d, layer.id, a.route)
        if (a.color || a.style) d = ops.setLayerStyle(d, layer.id, { ...(a.color ? { color: a.color } : {}), ...(a.style ? { style: a.style } : {}) })
        break
      }
      case 'highlight':
        break
    }
  }
  return { doc: d, notFound }
}

export const highlightedIds = (actions: AiAction[]): string[] =>
  actions.flatMap((a) => (a.type === 'highlight' ? a.ids : []))
