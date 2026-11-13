// HTTP API used by the Open WebUI tool (and usable as an OpenAPI tool server).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const express = require("express");
const multer = require("multer");
const { renderDeck } = require("./render");
const { readBOQ } = require("./boq");
const { buildFinancial } = require("./financial");

const PORT = Number(process.env.PORT || 8000);
const OUT = process.env.OUTPUT_DIR || "/data/out";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const API_KEY = process.env.API_KEY || ""; // optional shared secret for the build endpoints
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 14);
const MAKE_PDF = process.env.MAKE_PDF !== "false";
fs.mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function auth(req, res, next) {
  if (!API_KEY) return next();
  const got = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (got !== API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

const safeName = (s) => String(s || "deck").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "deck";

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

async function save(buffer, name) {
  const id = crypto.randomBytes(6).toString("hex");
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeName(name)}.pptx`);
  fs.writeFileSync(file, buffer);
  const pdf = MAKE_PDF ? await toPdf(file) : null;
  const url = (f) => `${PUBLIC_URL}/files/${id}/${encodeURIComponent(path.basename(f))}`;
  return { pptx_url: url(file), pdf_url: pdf ? url(pdf) : null };
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/guide", (_req, res) => res.type("text/markdown").send(fs.readFileSync(path.join(__dirname, "../SPEC.md"), "utf8")));
app.get("/openapi.json", (_req, res) => res.json(require("./openapi")(PUBLIC_URL)));
app.use("/files", express.static(OUT, { index: false, dotfiles: "deny" }));

app.post("/decks", auth, async (req, res) => {
  try {
    const spec = req.body && req.body.spec ? (typeof req.body.spec === "string" ? JSON.parse(req.body.spec) : req.body.spec) : req.body;
    const { buffer, warnings, slides } = await renderDeck(spec);
    const links = await save(buffer, spec.file_name || spec.title);
    res.json(Object.assign({ slides, warnings }, links));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

app.post("/financial", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "attach the BOQ Excel file as multipart field 'file'" });
    const opts = req.body && req.body.options ? JSON.parse(req.body.options) : {};
    const boq = await readBOQ(req.file.buffer);
    const { buffer, warnings, summary } = await buildFinancial(boq, opts);
    const links = await save(buffer, opts.file_name || "Financial_Proposal");
    res.json(Object.assign({ summary, warnings }, links));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Read a BOQ without building anything (lets the model answer questions about prices).
app.post("/boq/read", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "attach the Excel file as multipart field 'file'" });
    res.json(await readBOQ(req.file.buffer));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Remove old outputs once a day.
setInterval(() => {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const d of fs.readdirSync(OUT)) {
    const p = path.join(OUT, d);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
}, 864e5).unref();

if (require.main === module) app.listen(PORT, () => console.log(`deck-builder on :${PORT}, public ${PUBLIC_URL}`));
module.exports = app;
