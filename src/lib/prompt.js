import { summarizeFeatures } from './kml.js'

export function buildSystemPrompt(map) {
  const context = map
    ? `The user's map is "${map.name || 'untitled'}". Its features:\n${summarizeFeatures(map.geojson)}`
    : 'No map is loaded yet.'
  return `You are an assistant for a Google My Maps user. Reply in the user's language (usually Hebrew).
${context}

When the user asks to create a new layer (places, route, area), reply with a short explanation followed by exactly one fenced code block tagged \`kml\` containing a complete, valid KML 2.2 document with a <Document><name> and Placemarks with accurate coordinates (longitude,latitude). Do not include scripts or external links. The user will import it into My Maps via "Add layer → Import".`
}
