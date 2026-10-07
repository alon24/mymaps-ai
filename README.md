# MyMaps AI

PWA that reads a shared Google My Maps map, displays it, and adds an AI assistant that can generate new layers (KML) to import back into My Maps.

See `CLAUDE.md` for architecture and commands.

## Setup
1. Share the map in My Maps as "Anyone with the link".
2. Deploy the Worker (`worker/`) and set its secrets:
   `npx wrangler secret put APP_TOKEN` and `npx wrangler secret put OPENROUTER_API_KEY`.
3. Open the app → Settings → enter the Worker URL and the same APP_TOKEN.
4. Paste a My Maps link and click Load.

## Importing an AI layer
Download the KML from the assistant panel, then in My Maps: Add layer → Import → choose the file.
