# MyMaps AI — Product Requirements

Status: living document · Owner: ilan · Last reviewed: 2026-10-08

## 1. Summary
MyMaps AI is a free, installable web app (PWA) for building personal maps: places, routes and areas organized in layers, trip itineraries by day, import/export compatible with Google My Maps and Google Earth, storage and sharing through the user's own Google Drive, and an AI assistant that can read and edit the map with the user's approval. It replaces Google My Maps for personal and trip planning use, and works on phone and desktop.

## 2. Goals and non-goals
**Goals**
- G1. Everything a typical Google My Maps user does daily: create a map, add/edit points, lines and areas, organize them in layers, style them, search places, share.
- G2. Lossless round-trip with Google My Maps through KML/KMZ, so users can move in and out freely.
- G3. Trip planning as a first-class feature: days, ordered stops, numbered markers, routes and distances.
- G4. An AI layer that saves real work (bulk organizing, describing, suggesting places, planning days), never edits silently.
- G5. Zero running cost for the owner beyond AI usage; zero backend database. Hosting free (GitHub Pages + Cloudflare Workers free tier).
- G6. Mobile-first usability: one-handed operation, works offline for already-opened maps.

**Non-goals (v1)**
- Real-time multi-user co-editing (Drive sharing with last-write-wins + conflict prompt is enough).
- Turn-by-turn navigation or road routing (route lines are straight segments; "Open in Google Maps" hands off navigation).
- Embedding or automating the Google My Maps website.
- Paid Google Maps Platform APIs.

## 3. Users and key scenarios
- **Trip planner** (primary): plans a 5-day trip, collects 40 places, splits them into days, orders stops, shares with a partner who views on a phone.
- **Collector**: keeps "places I want to visit" / "restaurants I liked" maps for years, imports old My Maps exports.
- **Field user**: on the go, adds a point at current location with a note, offline.

Scenarios that must work end to end:
1. Import a Google My Maps KML/KMZ export → layers, names, descriptions and colors appear as in My Maps.
2. Create a map on a phone, add 5 points by search and by long-press, edit name/color/icon, reorder them by dragging.
3. Create "Day 1…Day 3" layers, drag stops between days, see numbered markers and per-day distance.
4. Save to Drive, share a view link, open it on another device without signing in.
5. Export the itinerary as HTML, open it on the phone, tap *Navigate* on a stop → Google Maps opens with directions.
6. Ask the AI "split these places into 3 days by area" → preview of changes → apply → undo.
7. Export KML and import it into Google My Maps.

## 4. Functional requirements
Priority: **P0** = v1 must, **P1** = v1 should, **P2** = later.

### 4.1 Maps
- P0 Create, rename (title + description), open, delete maps. Recent maps list sorted by last edit.
- P0 Autosave locally (IndexedDB) on every change; no "save" button needed for local maps.
- P0 Undo/redo for every edit (≥100 steps), including AI-applied changes as a single step.
- P1 Duplicate a map.
- P0 Durability without Google: request persistent browser storage; **back up all maps** to one JSON file and **restore** from it (a restored map replaces a local copy only if newer). The maps list explains that local maps live only in this browser.

### 4.2 Base map and navigation
- P0 Base layers: streets (OSM), satellite (Esri World Imagery), terrain (OpenTopoMap), with attribution.
- P0 Current location (GPS) with accuracy circle; **live tracking** (blue dot follows the user) toggled from the map; long-press the button to stop.
- P0 "Distance from you" on a selected point and on every itinerary stop when location is known.
- P0 Place search (address, place name, or pasted coordinates "31.77, 35.23"); select result → fly there with "Add to map".
- P0 Zoom to a feature / layer / whole map.
- P0 Long-press (touch) or right-click on the map → "Add point here".
- P0 Per point: **Navigate** (Google Maps directions from the current location) and **Search in Google Maps** (search by the place name around its position → business page, reviews, hours).

### 4.3 Layers
- P0 Multiple layers per map; add, rename, delete (with confirm), show/hide.
- P0 Quick layer on/off from the map (popover with a checkbox per layer, show all / hide all), also for viewers of shared maps (not saved).
- P0 New features go to the active layer; move features between layers.
- P0 Layer style, as in My Maps:
  - *Individual*: each feature keeps its own color and icon.
  - *Uniform*: all features use the layer color.
  - *Sequence numbers*: point markers show 1, 2, 3… in list order, in the layer's color. Only points are numbered; lines and areas keep their place in the list but get no number.
- P0 Each layer has a color (used for uniform style, numbers and route line).
- P0 **Route layer**: any layer can draw a route line through its points in list order (turning it on switches the layer to sequence numbers), shows total straight-line distance, and opens the route in Google Maps for real directions (split into parts above 9 waypoints).
- P1 Reorder layers.
- P1 Collapse/expand a layer in the list; feature count per layer.

### 4.4 Features (points, lines, areas)
- P0 Draw points (tap), lines and polygons (tap vertices, finish), on touch and mouse.
- P0 Edit: name, description (multi-line, links clickable), color (palette), icon (emoji set) for points.
- P0 Move points by dragging; edit line/polygon vertices.
- P0 Delete with undo.
- P0 Feature list per layer with text filter; tap → select and fly to it. Each row shows its position in the layer (1, 2, 3…) and an always-visible drag handle. Layer cards are compact (no item counts).
- P0 Adding from the map does not open the editor: the item gets a default name ("נקודה 3"), flashes in its layer, and a toast offers *Edit*.
- P0 Show measurements: line length, polygon area and perimeter.
- P0 **Reorder by drag** within a layer (works with touch), and drag to another layer.
- P1 Add point at current location in one tap.
- P2 Photos on features (stored in Drive).

### 4.5 Trip itinerary
- P0 A layer can be marked as a **trip day** with an optional date. Day layers default to sequence numbers.
- P0 Route line connecting the day's points in order (toggle per day), in the layer color.
- P0 Itinerary view: day layers sorted by date (days without a date follow, in layer order); each stop with its number, name, and straight-line distance from the previous stop; total per day. Stops = the day's points; lines and areas in a day layer are listed but not part of the route.
- P0 Drag stops to reorder within a day and between days.
- P1 "Open day in Google Maps" (directions URL with the day's stops as waypoints, up to the URL limit).
- P1 Unscheduled bucket: non-day layers' points can be dragged into a day.
- P0 **Travel companion export**: one self-contained HTML file (works offline, prints well, opens on any phone) with the trip title, each day (date, total distance), and each stop (number, name, description, icon). Every stop has links: *Navigate* (Google Maps directions to the stop), *Search in Google Maps*, *Show on map* (opens the stop in the app when the map is in Drive). Each day has *Open day route in Google Maps* (waypoints). A *Show distance from me* button uses the phone's location to show the distance to each stop and the nearest stop.
- P0 In-app itinerary view has the same links, so the app itself is the companion on the road.
- P1 Print-friendly itinerary (browser print of the same view).
- P2 Time per stop, travel time estimates.

### 4.6 Import
- P0 KML and KMZ, including Google My Maps exports: top-level folders → layers (nested folders merged), names, descriptions, colors from styles and from My Maps style ids, MultiGeometry split, Hebrew text.
- P0 GeoJSON (Feature/FeatureCollection; `layer` property → layers; simplestyle colors).
- P0 CSV/TSV: lat/lng columns, WKT column (My Maps CSV export), or address column (geocoded, rate-limited, with progress); name/description/color/layer columns; Hebrew headers.
- P1 GPX (tracks and waypoints).
- P1 Import from a Google My Maps link shared as "anyone with the link" (via the Worker `/kml` proxy).
- P0 Import into the current map (as new layers) or as a new map. Clear error messages for unsupported or malformed files.

### 4.7 Export
- P0 KML (Folders per layer, shared styles, colors, emoji in ExtendedData) — re-importable into Google My Maps and Google Earth.
- P0 KMZ, GeoJSON (with simplestyle), CSV (WKT + lat/lng, BOM for Excel Hebrew).
- P0 Itinerary HTML (see 4.5).
- P0 Round-trip guarantee: export → import keeps layers, names, descriptions, colors, icons and geometry (tested).

- P0 Feature editor (phone-friendly): header pinned with name (✎ → rename with ✓/✕), Delete (undo in toast) and Close. Points: *Fix location* — search an address or paste coordinates, pick a result, the point moves (one undo step); dragging the pin also works. Feature rows rename on long press, like layers.
- P0 Touch: renaming the map or a layer is a long press (click on desktop), with ✓ / ✕ buttons; a plain tap never starts a rename. The phone sheet drags from its whole header; the app disables pull-to-refresh so dragging never reloads it.

### 4.8 Google Drive storage and sharing
- P0 Sign in with Google (scope `drive.file` only — the app sees only files it created or the user opened with it).
- P0 **Drive-first when signed in**: a "Sign in" button in the panel header (Google). Once signed in, every map with content is stored in Drive automatically (local-only maps are uploaded on sign-in; new maps on their first edit), so any device signed in to the same Google account sees the same maps. A "My maps" button in the header lists the Drive maps first, then maps that exist only on this device.
- P0 Sign-in survives a reload until the Google access token expires (~1 hour; drive.file only). After that, one click on the sync badge or "Sign in" reconnects — no popup ever opens without a click.
- P0 On startup while signed in, the open Drive map is refreshed from Drive (picks up edits made on another device).
- P0 Save map to Drive (`<title>.mymap.json` in a "MyMaps AI" folder); autosave to Drive after edits (debounced).
- P0 List and open the user's Drive maps. Delete a map the user owns: moves the Drive file to the Drive trash (recoverable 30 days), removes the local copy, switches away if it was open; the toast offers Undo.
- P0 Conflict detection: before writing, compare the Drive content revision (`headRevisionId`; `version` only as fallback, since it also changes on metadata/indexing) with the last synced one; saves run strictly one at a time; on conflict ask: keep mine / load theirs / save mine as a copy.
- P0 Share:
  - view link: "anyone with the link can view" → app URL `#/m/<fileId>` opens read-only without sign-in;
  - invite people by email as editors or viewers (Drive permissions, Drive sends the email).
- P0 Opening a link to a map the user can access but the app has no `drive.file` grant for → "Open with Google" button using Google Picker pre-selected to that file.
- P1 Show sync status (saved / saving / offline / error).
- P0 App works fully without Google config or sign-in (local maps only); Drive UI hidden when not configured.

### 4.9 AI assistant
- P0 Chat panel with the current map as context (layers, features, ids, coordinates/centroids, descriptions truncated).
- P0 The assistant answers questions and may propose **actions**; actions are validated (schema), shown as a readable preview, and applied only when the user taps Apply, as one undo step.
- P0 Supported actions: create layer with places (by search query — geocoded by the app, never raw AI coordinates — or copies of existing features), update features (name, description, color, icon), move features to a layer (creating it if needed), delete features, set layer style / color / trip day, reorder a layer's stops, highlight features (no change).
- P0 Quick prompts: summarize map, split into trip days, suggest places near the map / near me, write short descriptions.
- P0 **No per-user key.** Users signed in with Google use the AI on the owner's OpenRouter account: the app sends their Google access token and the Worker verifies with Google that it was issued to this app and that the account is on the `ALLOWED_EMAILS` list (in `worker/wrangler.toml`, stored as SHA-256 hashes). While the OAuth app is in Testing, only Google test users can sign in at all. Signed-out users see "Sign in with Google" in the AI tab. The owner can still use an admin `APP_TOKEN`.
- P0 Clear setup message when the Worker URL is missing; errors shown in the chat.
- P1 Model switch without code change (Cloudflare `MODEL` variable); default `openai/gpt-4o-mini` via OpenRouter.
- P2 Decision-only engine (e.g. TypeSafe Jev) for cheap classification once available.

### 4.10 Settings
- P0 Worker URL (default from build config) and an optional admin app token (stored locally).
- P0 Menu: sign in / sign out with Google, About (version, commit, build time, account, *Check for updates*, credits). Version = `major.minor` from package.json + CI run number, shown at the bottom of the menu. On phones the menu opens as a bottom action sheet.
- P1 Default base layer, units.

## 5. Non-functional requirements
- **Platforms**: latest Chrome, Safari (iOS ≥ 16), Firefox, Edge. Phone (≥ 360px wide) and desktop.
- **UI language**: Hebrew, RTL. Map controls stay LTR internally.
- **Performance**: 1,000 features render and pan smoothly on a mid-range phone; app shell loads < 2 s on 4G after first visit.
- **Offline**: app shell and opened maps available offline; tiles for viewed areas cached (bounded cache); edits queue to Drive when back online.
- **Accessibility**: keyboard reachable controls, visible focus, labels on icon buttons, 4.5:1 text contrast, touch targets ≥ 44px.
- **Privacy & security**: no backend DB; maps live in IndexedDB and the user's Drive. AI requests send map content to OpenRouter through the Worker; the Worker requires a verified Google sign-in for this app (or the admin token), holds the only API key, limits body size. No secrets in the repo or bundle. `drive.file` scope only.
- **Cost**: GitHub Pages and Cloudflare free tiers; AI cost ≈ cents per day of use with gpt-4o-mini. Nominatim within its usage policy (≤ 1 req/s, attribution).
- **Quality**: end-to-end tests (Playwright, desktop + phone viewport) for scenarios 1–3 and 7; unit tests for all import/export, model operations, itinerary math, AI action validation/application, Drive sync logic; CI runs tests and build on every push; deploy only from green `main`.

## 6. Data model
```
MapDoc  { schema: 1, id, title, description, layers[], updatedAt, driveFileId?, driveVersion? }
Layer   { id, name, visible, color, style: 'individual'|'uniform'|'numbered',
          day?: { date?: 'YYYY-MM-DD', route: boolean }, route?: boolean }
Feature GeoJSON Feature<Point|LineString|Polygon> with
        properties { id, name, description, color, icon? }
```
Order of `layer.features` is the sequence order (numbers, itinerary, route). `MapDoc.schema = 1` for future migrations; loading migrates older/missing fields (e.g. layers without `color`/`style`). Stored in Drive as JSON (`.mymap.json`). KML is import/export only; layer style/day info is written to Folder `ExtendedData` so our own exports round-trip it.

## 7. Architecture
- Frontend: React + TypeScript + Vite + vite-plugin-pwa, Leaflet + Leaflet-Geoman (chosen over MapLibre: simpler editing on touch, raster tiles are enough, smaller learning curve), Zustand store with undo history, IndexedDB via `idb`.
- Worker (Cloudflare): `POST /ai` → OpenRouter, `GET /kml?mid=` → My Maps KML proxy. Protected by Google sign-in (tokeninfo `aud` check, cached) or admin token.
- Google: Identity Services token client + Drive REST v3 + Picker, from the browser.
- Hosting: GitHub Pages via GitHub Actions; Worker deploy via Actions when `CLOUDFLARE_API_TOKEN` is set.

## 8. Milestones
1. M1 Core map: layers, draw/edit, styles, numbers, reorder, search, measure, local storage, undo. 
2. M2 Import/export with round-trip tests.
3. M3 Itinerary days and routes.
4. M4 Drive storage, sharing, conflict handling.
5. M5 AI assistant with action preview.
6. M6 Polish: offline, accessibility, performance pass, onboarding empty states.

## 9. Success metrics
- The seven scenarios in §3 pass manually on phone and desktop and (where possible) in automated tests.
- A real Google My Maps export with ≥ 100 places imports with correct layers and colors.
- Owner uses it instead of My Maps for the next trip.

## 10. Risks and mitigations
| Risk | Mitigation |
|---|---|
| `drive.file` can't read maps shared by others | Google Picker pre-selected to the file grants access; public view links use the API key without sign-in. |
| Nominatim rate limits / quality for Hebrew | 1 req/s queue, map-view bias, coordinates paste; module is swappable. |
| AI hallucinated places/coordinates | Places are geocoded by the app; actions are schema-validated and previewed. |
| Touch drawing conflicts with map panning | Explicit tool modes with a visible "finish" control; select mode is default. |
| Google OAuth setup is complex for the owner | Step-by-step guide in README; app fully usable without it. |
| Concurrent edits on a shared map | Version check before every Drive write; conflict dialog. |

## 11. Open questions
- Should shared editors also be able to share onward? (Default: Drive's own setting.)
- Photos on features (P2): store in Drive folder next to the map?
