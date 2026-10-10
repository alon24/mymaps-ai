import type { MapDoc } from '../model/types'
import { anchor } from '../geo/measure'
import { stripTags } from '../io/itineraryHtml'

const MAX_FEATURES = 400
const MAX_DESC = 160

/** Compact map context for the model: ids, names, types, positions, trimmed descriptions. */
export function mapContext(doc: MapDoc, view?: { center: [number, number]; userLocation?: [number, number] }): string {
  let budget = MAX_FEATURES
  const layers = doc.layers.map((l) => ({
    layer: l.name,
    color: l.color,
    style: l.style,
    ...(l.day ? { trip_day: l.day } : {}),
    ...(l.route ? { route: true } : {}),
    ...(l.visible ? {} : { hidden: true }),
    features: l.features.slice(0, Math.max(0, budget)).map((f) => {
      budget--
      const [lng, lat] = anchor(f.geometry)
      const desc = stripTags(f.properties.description).replace(/\s+/g, ' ')
      return {
        id: f.properties.id,
        name: f.properties.name,
        type: f.geometry.type,
        at: [Number(lat.toFixed(5)), Number(lng.toFixed(5))],
        ...(desc ? { description: desc.length > MAX_DESC ? `${desc.slice(0, MAX_DESC)}…` : desc } : {}),
        ...(f.properties.icon ? { icon: f.properties.icon } : {}),
        color: f.properties.color,
      }
    }),
  }))
  const total = doc.layers.reduce((n, l) => n + l.features.length, 0)
  return JSON.stringify({
    title: doc.title,
    description: doc.description,
    ...(total > MAX_FEATURES ? { note: `showing first ${MAX_FEATURES} of ${total} features` } : {}),
    ...(view ? { map_center: view.center.map((n) => Number(n.toFixed(4))) } : {}),
    ...(view?.userLocation ? { user_location: view.userLocation.map((n) => Number(n.toFixed(4))) } : {}),
    layers,
  })
}

export const SYSTEM_PROMPT = `You are the assistant inside "MyMaps AI", a personal map and trip-planning app.
The user writes in Hebrew (sometimes English). Reply in the user's language, short and practical.

You receive the current map as JSON: layers (some are trip days, ordered stops), features with ids, names, type, position "at" [lat, lng], descriptions.

ALWAYS answer with ONE JSON object and nothing else:
{"reply": "<message to the user>", "actions": [ ... ]}

"actions" is optional; include it only when the user asks to change the map or when highlighting helps. The app shows the actions to the user for approval before applying them.

Available actions:
- {"type":"add_layer","layer_name":"...","color":"#rrggbb"?,"style":"individual|uniform|numbered"?,"day":{"date":"YYYY-MM-DD"?,"route":true}?,"features":[PLACE...]}
- {"type":"add_places","layer_name":"<existing or new layer>","features":[PLACE...]}
- {"type":"update_features","updates":[{"id":"...","name"?,"description"?,"color"?,"icon"?}]}
- {"type":"move_features","ids":["..."],"layer_name":"<existing or new layer>"}
- {"type":"delete_features","ids":["..."]}
- {"type":"reorder_layer","layer_name":"...","ids":["<ids in the new order>"]}
- {"type":"set_layer","layer_name":"...","new_name"?,"color"?,"style"?,"day":{...}|null?,"route":true|false?}   (route = line through the layer's points in order)
- {"type":"highlight","ids":["..."],"note"?:"..."}   (no change, just points features out)

PLACE is either:
- {"place":"<precise search query for a REAL place: name + street/neighborhood + city>","name"?,"description"?,"icon"?}
- {"from_feature_id":"<existing id>","name"?,"description"?,"icon"?}   (copy an existing feature)

Example — user: "הצע 3 בתי קפה ליד הים בתל אביב והוסף לשכבה חדשה":
{"reply":"הנה 3 בתי קפה ליד הים. אשר כדי להוסיף אותם לשכבה \"בתי קפה\".","actions":[{"type":"add_layer","layer_name":"בתי קפה","features":[{"place":"Cafe Lanoir, Tel Aviv Port, Tel Aviv","name":"קפה לנואר","icon":"☕","description":"..."},{"place":"Mike's Place, Herbert Samuel St, Tel Aviv","name":"מייקס פלייס","icon":"☕"},{"place":"Gordon Beach, Tel Aviv","name":"חוף גורדון","icon":"🏖️"}]}]}

Rules:
- If your reply says you are adding/changing/moving anything, the SAME JSON must contain the matching "actions". Never promise a change without actions.
- NEVER invent coordinates. New places are found by the app from your "place" query, so make queries specific and real.
- Use only ids that exist in the map JSON.
- Trip days: one layer per day, "day" set, style "numbered"; stops in visiting order. To split places into days use add_layer for each day plus move_features, and order stops geographically to minimize backtracking.
- Icons: a single emoji such as 📍 ⭐ 🏠 🍽️ ☕ 🏨 🅿️ ⛽ 🏖️ ⛰️ 🌳 🏛️ 🛒 🚉 ❤️.
- Descriptions: plain text, 1–2 sentences, useful facts (what, why go, tips). No HTML.
- If the request is ambiguous, ask a short question in "reply" and return no actions.
- For questions (counts, distances, summaries), answer in "reply" using the map data.`

export const QUICK_PROMPTS = [
  { label: 'סכם את המפה', text: 'סכם בקצרה מה יש במפה הזו.' },
  { label: 'חלק לימי טיול', text: 'חלק את המקומות במפה לימי טיול לפי אזורים, וסדר את העצירות בכל יום כך שלא נחזור על עצמנו. שאל כמה ימים אם לא ברור.' },
  { label: 'הצע מקומות בסביבה', text: 'הצע 5 מקומות מומלצים לבקר בהם באזור המפה שעדיין לא נמצאים בה, והוסף אותם לשכבה חדשה בשם "הצעות".' },
  { label: 'כתוב תיאורים', text: 'כתוב תיאור קצר ושימושי לכל מקום שאין לו תיאור.' },
  { label: 'מה קרוב אליי?', text: 'מה המקומות הכי קרובים למיקום שלי במפה? תסמן אותם.' },
] as const
