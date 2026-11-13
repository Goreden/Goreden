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

### 3b. Photos (optional)
Add `openwebui/corebuild_photos_filter.py` as a **Function** (filter), set its valves like the tool's,
attach it to the model (**Filters**) and turn on the model's **Vision** capability. Each photo a user
attaches is stored in the deck builder and replaced by a `media:` reference before the text reaches
the model, so text-only models work.

### 4. Use it
- *Financial:* upload the BOQ `.xlsx` and write «اعمل لي عرض مالي لمشروع … مقدم إلى …». You get the deck,
  a PDF and a priced Excel workbook with formulas; problems in the spreadsheet are listed in the chat.
- *Existing deck:* upload the `.pptx` and say what to change. The tool imports it slide by slide
  (`import_deck`: every line, number and schedule bar carried over by code), the model changes only the
  slides asked for (`edit_deck`), and the server posts its own change list and fact check in the chat.
- *New technical deck:* paste your content and write «اعمل عرض فني بنفس تصميم CoreBuild».
- Links appear in the chat. Files are kept for `KEEP_DAYS` days; deck records (for later edits) for a year.

## How mistakes are prevented
- **Nothing is re-typed.** Uploaded decks are converted by code (`src/pptx_read.js`, `src/convert.js`);
  decks built here carry their id, so a later upload continues from the saved slides exactly.
- **Fact check on every version** (`src/facts.js`): numbers per slide, every line, schedule bars, slide count.
- **Measured text fit** (`src/measure.js`): every text box is measured with the fonts LibreOffice uses;
  overflow is shrunk within limits, then split onto a «(تابع)» slide. Content is never cut.
- **Excel maths in code** (`src/boq.js`): totals, mismatches, items without a rate, duplicates.

## Operations
- `ops/regression.sh` — smoke tests plus real documents kept in `regression/` (not in git) with
  `regression/expected.json`. Run after any change or image update.
- `ops/healthcheck.sh` — every 10 minutes from cron; ntfy alert when the deck builder, Tika, Open WebUI
  or the public hostnames break, and when they recover.
- Pin Open WebUI, Tika and cloudflared images by digest and keep them out of automatic updaters:
  a Tika major version change silently broke PowerPoint and Excel reading once
  (Open WebUI's Tika server version setting must match: `4` for Tika 4.x).

## What to expect from DeepSeek

| Model | Expectation |
|---|---|
| DeepSeek V4.1 Flash | Good fit: supports tool calling and a very long context. Use *Native* function calling. |
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
