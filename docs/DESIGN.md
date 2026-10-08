# MyMaps AI — Design

Direction: **"Field notebook, sticker-fast."** A trip-planning map that feels like a well-used field notebook — spruce ink, paper-white surfaces, a highlighter yellow for whatever is active — with the quick, tactile delight of putting stickers on a map. Modern and calm at rest, playful in response to touch. Hebrew-first (RTL).

## Principles
1. **The map is the hero.** Chrome floats over it; nothing permanent covers more than it must. On phones, the panel is a bottom sheet with three snap heights.
2. **Highlighter = active.** Yellow (`--mark`) marks exactly one kind of thing: the current tool, the selected item, AI highlights. Never decoration.
3. **Motion answers touch.** Things animate because the user did something: a pin drops when placed, the sheet springs when dragged, a proposal card unfolds when the AI answers. No idle/looping animation except the AI-highlight ping.
4. **Fast first.** Every animation ≤ 280 ms, transform/opacity only, interruptible. `prefers-reduced-motion` turns all of it off.
5. **Numbers are the brand.** Sequence-numbered pins in the layer color are the most characteristic visual; give them the best type (tabular, bold) and the nicest motion.

## Tokens
| Token | Light | Dark | Use |
|---|---|---|---|
| `--ink` | `#17302a` | `#e4ece9` | text, primary dark surfaces (active tab, user bubble) |
| `--panel` | `#ffffff` | `#15211e` | sheets, cards |
| `--bg` | `#eef3f1` | `#101a17` | app background |
| `--raise` | `#f6f9f8` | `#1b2a26` | hover, nested areas |
| `--line` | `#d9e2df` | `#2c3d38` | borders |
| `--accent` | `#1f6f5c` | `#4fb397` | primary actions, links |
| `--mark` | `#f2c14e` | same | active / selected / highlight |
| `--danger` | `#b3261e` | — | destructive |
| Layer palette | `#1f6f5c #d1495b #edae49 #00798c #30638e #7b2d8e #e07a1f #3d9a3d #5c5c5c #c2185b` | | layer & feature colors |

Type: **Secular One** (map title, dialog titles — the display voice), **Assistant** 400/600/700 (everything else). Scale: 13 / 15 / 16 / 18 / 22 / 26 px. Numbers on pins: Assistant 700, tabular.

Shape: radius 12 for cards/sheets, 10 for buttons and inputs, full pill for tabs/chips. Shadow: one soft elevation for floating chrome only.

## Layout
```
Desktop ≥ 900px                         Phone
┌───────────────────────────┬─────────┐ ┌───────────────────┐
│ [search......] [tools][⋯] │ Title   │ │ [search.........] │
│                           │ sync    │ │ [tools]  [view]   │
│            MAP            │ tabs    │ │       MAP         │
│                           │ list /  │ │                   │
│ zoom                      │ editor  │ ├──── grabber ──────┤
└───────────────────────────┴─────────┘ │ Title · tabs      │ ← sheet: peek 148 / half 52% / full
                                         └───────────────────┘
```
RTL: the panel sits on the right (inline start). Text right-aligned; map controls stay LTR internally.

## Components
- **Floating toolbar** — pill groups: tools (select, point, line, area, measure), history (undo/redo), view (my location, layers on/off, fit all, base map). Active tool = yellow fill.
- **Pin** — teardrop in the effective color (feature or layer), white outline; content = sequence number, emoji, or empty. Selected: larger + yellow outline. AI-highlighted: yellow ping ring.
- **Layer card** — visibility eye, title (+ calendar icon for trip days, route icon for route layers), count, settings (⋯). Active layer: colored inline-start bar.
- **Feature row** — drag grip, color mark (circle / bar / rounded square for point / line / area) showing the number when numbered, name.
- **Editor** — name, description, measurements + distance from me, Navigate / Search in Google Maps, color swatches, emoji grid, layer select, delete.
- **Itinerary** — day cards with color bar, date, stops, distance; stops numbered; unscheduled bucket.
- **AI chat** — user bubbles (ink), assistant bubbles (raise), proposal card with action list and Apply / Ignore.
- **Toast** — ink pill with an optional action (Undo).

## Motion
| Moment | Animation | Duration / easing |
|---|---|---|
| Pin placed (new feature) | drop from −18px + squash on land | 260 ms, `cubic-bezier(.2,1.4,.4,1)` |
| Pin selected | scale 1 → 1.25 | 160 ms ease-out |
| Sheet snap (phone) | height spring | 240 ms `cubic-bezier(.2,.9,.3,1.15)` |
| Sheet drag | follows finger, snaps on release by velocity | — |
| Tab change | yellow/ink indicator slides under tabs | 200 ms ease-out |
| Panel content swap (list ↔ editor) | fade + 8px slide | 180 ms |
| AI proposal card | unfold (scaleY .96 → 1 + fade), list items stagger 40 ms | 220 ms |
| Toast | slide up + fade | 200 ms |
| Drag reorder | lifted row (shadow + 2° tilt), drop marker | — |
| Layer hidden | pins fade out | 150 ms |
| Highlight ping | ring scale .6 → 1.4, fade | 1.6 s loop (only while highlighted) |

All motion is disabled under `prefers-reduced-motion: reduce`.

## Copy
Hebrew, short, sentence case, verbs on buttons ("הוסף יום", "החל שינויים", "שמור ב-Drive ושתף"). Empty states say what to do next. Errors say what happened and how to fix it.

## Prompt for Google Stitch
> Design a mobile-first Hebrew (RTL) map app called "MyMaps AI" for planning trips. Full-screen map with floating rounded toolbars at the top: a search field, a pill of drawing tools (select, add point, line, area, measure), undo, and view buttons (my location, layers on/off, fit, base map). A bottom sheet (peek / half / full) holds the map title in a bold rounded display font (Secular One), a sync status line, three pill tabs — Layers, Itinerary, AI — and content: layer cards with an eye toggle, colored bar, and rows of places with drag handles and numbered colored circles. Trip-day cards show date, number of stops, distance, and numbered stops with navigate buttons. AI tab is a chat with a "proposed changes" card that has Apply / Ignore buttons. Style: field-notebook — deep spruce green ink (#17302a), white paper surfaces, soft mint-gray background (#eef3f1), spruce accent (#1f6f5c), and highlighter yellow (#f2c14e) used only for the active tool and the selected item. Map pins are teardrops in layer colors with bold white numbers. Rounded corners 12px, one soft shadow for floating chrome. Modern, playful, fast. Also show a desktop layout with the panel docked on the right.
