// HTTP API used by the Open WebUI tool (and usable as an OpenAPI tool server).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const express = require("express");
const multer = require("multer");
const { readBOQ } = require("./boq");
const { buildFinancial } = require("./financial");
const { exportBOQ } = require("./boq_export");
const decks = require("./decks");
const store = require("./store");

const PORT = Number(process.env.PORT || 8000);
const OUT = store.OUT;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const API_KEY = process.env.API_KEY || ""; // optional shared secret for the build endpoints
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 14);
const MAKE_PDF = process.env.MAKE_PDF !== "false";
fs.mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "25mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

function auth(req, res, next) {
  if (!API_KEY) return next();
  const got = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "unauthorized" });
  next();
}

const safeName = (s) => String(s || "deck").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "deck";
const fileUrl = (id, f) => `${PUBLIC_URL}/files/${id}/${encodeURIComponent(path.basename(f))}`;

function toPdf(file) {
  return new Promise((resolve) => {
    const profile = path.join("/tmp", "lo-" + crypto.randomBytes(4).toString("hex"));
    execFile("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--convert-to", "pdf", "--outdir", path.dirname(file), file], { timeout: 180000 }, (err) => {
      fs.rm(profile, { recursive: true, force: true }, () => {});
      const pdf = file.replace(/\.pptx$/, ".pdf");
      resolve(!err && fs.existsSync(pdf) ? pdf : null);
    });
  });
}

async function save(buffer, name, id = crypto.randomBytes(6).toString("hex")) {
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeName(name)}.pptx`);
  fs.writeFileSync(file, buffer);
  const pdf = MAKE_PDF ? await toPdf(file) : null;
  return { pptx_url: fileUrl(id, file), pdf_url: pdf ? fileUrl(id, pdf) : null };
}

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
const needFile = (req, what) => { if (!req.file) { const e = new Error(`attach the ${what} as multipart field 'file'`); e.status = 400; throw e; } return req.file; };

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/guide", (_req, res) => res.type("text/markdown").send(fs.readFileSync(path.join(__dirname, "../SPEC.md"), "utf8")));
app.get("/openapi.json", (_req, res) => res.json(require("./openapi")(PUBLIC_URL)));
app.use("/files", express.static(OUT, { index: false, dotfiles: "deny" }));

// New deck from a full spec. Optional based_on: deck id to check the new deck against.
app.post("/decks", auth, wrap(async (req) => {
  const body = req.body || {};
  const spec = body.spec ? (typeof body.spec === "string" ? JSON.parse(body.spec) : body.spec) : body;
  let base = null;
  if (body.based_on) {
    const rec = store.loadRecord(body.based_on);
    if (!rec) { const e = new Error(`deck ${body.based_on} not found`); e.status = 404; throw e; }
    base = { texts: rec.texts, timelines: {} };
  }
  return decks.buildVersion({ spec, base, parent: body.based_on || null, kind: "build", save });
}));

// Existing PowerPoint → editable deck (lossless for unchanged CoreBuild decks).
app.post("/import", auth, upload.single("file"), wrap(async (req) => {
  const f = needFile(req, "PowerPoint (.pptx) file");
  return decks.importDeck(f.buffer, f.originalname, save);
}));

app.get("/decks/:id", auth, wrap(async (req) => decks.getSlides(req.params.id, req.query.slides)));
app.post("/decks/:id/edit", auth, wrap(async (req) => decks.editDeck(req.params.id, req.body || {}, save)));

// Store a photo; returns a media: reference usable in slide specs (hero panel.image, picture.image, icon).
app.post("/media", auth, upload.single("file"), wrap(async (req) => {
  let buf, mime;
  if (req.file) { buf = req.file.buffer; mime = req.file.mimetype; }
  else if (req.body && req.body.data) {
    const m = /^(?:data:(image\/[\w+.-]+);base64,)?(.+)$/s.exec(req.body.data);
    buf = Buffer.from(m[2], "base64"); mime = m[1];
  } else { const e = new Error("send the image as multipart field 'file' or JSON {data: base64}"); e.status = 400; throw e; }
  const meta = await require("sharp")(buf).metadata();
  return { ref: store.saveMedia(buf, mime), width: meta.width, height: meta.height };
}));

app.post("/financial", auth, upload.single("file"), wrap(async (req) => {
  const f = needFile(req, "BOQ Excel file");
  const opts = req.body && req.body.options ? JSON.parse(req.body.options) : {};
  const boq = await readBOQ(f.buffer);
  const { buffer, warnings, summary } = await buildFinancial(boq, opts);
  const id = crypto.randomBytes(6).toString("hex");
  const links = await save(buffer, opts.file_name || "Financial_Proposal", id);
  const xlsx = await exportBOQ(boq, { project: opts.project, client: opts.client, vat_rate: summary.vat_rate, prices_include_vat: summary.prices_include_vat, labels: summary.parts.map((p) => p.label) });
  const xf = path.join(OUT, id, `${safeName((opts.file_name || "Financial_Proposal") + "_BOQ")}.xlsx`);
  fs.writeFileSync(xf, xlsx);
  return Object.assign({ summary, warnings, checks: boq.stats }, links, { xlsx_url: fileUrl(id, xf) });
}));

// Read and validate a BOQ without building anything (totals computed by code, plus a problem list).
app.post("/boq/read", auth, upload.single("file"), wrap(async (req) => readBOQ(needFile(req, "Excel file").buffer)));

// Priced BOQ workbook with formulas.
app.post("/boq/export", auth, upload.single("file"), wrap(async (req) => {
  const opts = req.body && req.body.options ? JSON.parse(req.body.options) : {};
  const boq = await readBOQ(needFile(req, "Excel file").buffer);
  const id = crypto.randomBytes(6).toString("hex");
  fs.mkdirSync(path.join(OUT, id), { recursive: true });
  const xf = path.join(OUT, id, `${safeName(opts.file_name || "BOQ_Priced")}.xlsx`);
  fs.writeFileSync(xf, await exportBOQ(boq, opts));
  return { xlsx_url: fileUrl(id, xf), checks: boq.stats, problems: boq.problems };
}));

// Remove old outputs once a day (deck records and media are kept longer, see store.js).
setInterval(() => {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const d of fs.readdirSync(OUT)) {
    if (d.startsWith(".")) continue;
    const p = path.join(OUT, d);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
  store.cleanup();
}, 864e5).unref();

if (require.main === module) app.listen(PORT, () => console.log(`deck-builder on :${PORT}, public ${PUBLIC_URL}`));
module.exports = app;
