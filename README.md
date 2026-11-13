# CoreBuild proposal decks for Open WebUI

Lets your Open WebUI (with DeepSeek or any other model) produce CoreBuild-branded Arabic
PowerPoint proposals, with a PDF copy, in the same design as the hand-made technical and
financial proposals.

**How it works:** the model never draws slides. It writes the *content* as a small JSON spec
(slide type, title, cards…) and a separate `deck-builder` service turns it into a finished deck
with the CoreBuild layouts, colours, right-to-left Arabic and page numbers. Because a text-only
model cannot look at the slides, the service measures every text box and returns `warnings`
("card text too long on slide 7"); the model shortens that text and rebuilds.

Financial proposals don't need the model at all: upload the BOQ Excel file and the service builds
the whole deck from the spreadsheet (section summaries, full BOQ tables, VAT, total in words), so
every number is exact.

```
Open WebUI  ──(tool call)──▶  deck-builder (Node + LibreOffice)  ──▶  .pptx + .pdf download links
   ▲  DeepSeek writes the content / passes the Excel file
```

## Repository layout

| Path | What it is |
|---|---|
| `deck-builder/` | The Docker service: slide types, BOQ reader, financial builder, HTTP API |
| `deck-builder/SPEC.md` | The deck JSON format the model follows (also served at `/guide`) |
| `deck-builder/examples/technical_proposal.json` | A full technical-proposal spec to copy from |
| `openwebui/corebuild_deck_tool.py` | Open WebUI Tool to paste into Workspace → Tools |
| `openwebui/system_prompt.md` | System prompt for the CoreBuild model in Open WebUI |
| `docker-compose.yml`, `.env.example` | Runs the service next to Open WebUI |

## Setup (about 15 minutes)

### 1. Start the deck builder on your server
```bash
git clone <this repo> corebuild && cd corebuild
cp .env.example .env
nano .env        # set PUBLIC_URL, API_KEY, OPENWEBUI_NETWORK
docker network ls   # find your Open WebUI network name, put it in OPENWEBUI_NETWORK
docker compose up -d --build
curl http://localhost:8010/health    # → {"ok":true}
```
- `PUBLIC_URL` is the address **your browser** uses to download files, e.g. `http://203.0.113.10:8010`
  or `https://decks.example.com` behind your reverse proxy.
- If Open WebUI was started with plain `docker run` (no compose network), either create a network
  and connect both containers (`docker network create corebuild && docker network connect corebuild open-webui`,
  then set `OPENWEBUI_NETWORK=corebuild`), or skip the network and use `http://<server-ip>:8010` in step 2.

### 2. Add the tool to Open WebUI
1. **Workspace → Tools → +** (Create), delete the sample code, paste all of `openwebui/corebuild_deck_tool.py`, save.
2. Click the tool's **⚙ Valves**:
   - `DECK_BUILDER_URL` = `http://deck-builder:8000` (same Docker network) or `http://<server-ip>:8010`
   - `API_KEY` = the value from `.env`

### 3. Create the CoreBuild model
1. **Workspace → Models → +**. Base model: your DeepSeek model. Name: e.g. *CoreBuild Proposals*.
2. **System Prompt**: paste `openwebui/system_prompt.md`.
3. **Tools**: tick *CoreBuild Deck Builder*.
4. **Advanced Params → Function Calling**: try **Native** first. If the model never calls the tool
   (common with DeepSeek-R1 distills), switch to **Default**.
5. Raise **Context Length** (`num_ctx`) to at least 16384 if you use Ollama; a full deck spec is long.
6. Save.

### 4. Use it
- *Financial:* upload the BOQ `.xlsx` and write «اعمل لي عرض مالي لمشروع … مقدم إلى …».
- *Technical:* paste or upload your content and write «اعمل عرض فني بنفس تصميم CoreBuild».
- Links to the PowerPoint and PDF appear in the chat. Files are kept for `KEEP_DAYS` days.

## What to expect from DeepSeek

| Model | Expectation |
|---|---|
| DeepSeek-V3 / V3.1 / R1 (full, 671B, or via DeepSeek API) | Good. Handles Arabic, tool calls and the JSON spec well. |
| DeepSeek-R1 distills 32B/70B (Ollama) | Usable. Use *Default* function calling; may need 2–3 rounds to fix warnings. |
| 7B/8B/14B distills | Financial decks work (no model skill needed). Technical decks will be weak: broken JSON, thin content. |

The design is always the same, because the model only supplies text. Quality differences show up
in the writing and in how well the model follows the facts you give it.

## Building decks without Open WebUI
```bash
curl -X POST http://localhost:8010/decks -H 'content-type: application/json' \
     -H 'Authorization: Bearer <API_KEY>' -d @deck-builder/examples/technical_proposal.json
curl -X POST http://localhost:8010/financial -H 'Authorization: Bearer <API_KEY>' \
     -F file=@boq.xlsx -F 'options={"project":"مشروع …","client":"…","vat_rate":15}'
```
`/openapi.json` describes the API, so it can also be added in Open WebUI as an OpenAPI tool server
(Admin Settings → Tools). The Python tool above is still needed for Excel uploads, because that is
the only way it can read files attached to a chat.

## BOQ spreadsheet format
One sheet per part (e.g. structural, finishes). In each sheet: title rows, then a header row
containing `الوحدة` and `الكمية` (plus `سعر` and `الإجمالي`), then section rows (first column `SEC`,
or a description with no numbers) and item rows (quantity and rate filled). A totals row is
optional; if present it is checked against the sum of the items.

## Development
```bash
cd deck-builder && npm install && npm test   # smoke tests, no LibreOffice needed
npm start                                     # http://localhost:8000 (needs /data/out or OUTPUT_DIR)
```
To change the look, edit `src/kit.js` (colours, fonts, frames) and `src/slides.js` (slide types);
logos are in `deck-builder/assets/`.
