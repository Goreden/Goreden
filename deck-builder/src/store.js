// Deck records (spec + rendered slide text) and media (photos, icons, slide renderings), kept on the
// output volume under dot-folders so /files never serves them.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = process.env.OUTPUT_DIR || "/data/out";
const SPECS = path.join(OUT, ".specs");
const MEDIA = path.join(OUT, ".media");
const SPEC_KEEP_DAYS = Number(process.env.SPEC_KEEP_DAYS || 365);
for (const d of [SPECS, MEDIA]) fs.mkdirSync(d, { recursive: true });

const newId = () => crypto.randomBytes(6).toString("hex");
const validId = (id) => /^[0-9a-f]{12}$/.test(String(id));

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif" };
function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(0, 3).toString() === "GIF") return "gif";
  return null;
}
function saveMedia(buf, mime) {
  const ext = sniff(buf) || EXT[mime];
  if (!ext) throw new Error("unsupported image type (use PNG, JPEG or WebP)");
  const name = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 20) + "." + ext;
  const p = path.join(MEDIA, name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, buf);
  return "media:" + name;
}
function mediaPath(ref) {
  const m = /^media:([0-9a-f]{20}\.(png|jpg|webp|gif))$/.exec(String(ref));
  return m ? path.join(MEDIA, m[1]) : null;
}
// All media: refs in a spec → { ref: "image/png;base64,..." } for pptxgenjs. Missing ones are reported.
async function loadMedia(spec) {
  const refs = new Set();
  const walk = (v) => { if (typeof v === "string") { if (v.startsWith("media:")) refs.add(v); } else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(spec);
  const data = {}, missing = [];
  const sharp = require("sharp");
  for (const ref of refs) {
    const p = mediaPath(ref);
    if (!p || !fs.existsSync(p)) { missing.push(ref); continue; }
    let buf = fs.readFileSync(p);
    let mime = "image/" + (p.endsWith(".jpg") ? "jpeg" : p.split(".").pop());
    if (mime === "image/gif") { buf = await sharp(buf).png().toBuffer(); mime = "image/png"; }
    data[ref] = `${mime};base64,${buf.toString("base64")}`;
    try { const now = new Date(); fs.utimesSync(p, now, now); } catch (_) {}
  }
  return { data, missing };
}

function saveRecord(rec) {
  fs.writeFileSync(path.join(SPECS, rec.id + ".json"), JSON.stringify(rec));
  return rec;
}
function loadRecord(id) {
  if (!validId(id)) return null;
  const p = path.join(SPECS, id + ".json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

function cleanup() {
  const cutoff = Date.now() - SPEC_KEEP_DAYS * 864e5;
  for (const dir of [SPECS, MEDIA]) for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); } catch (_) {}
  }
}

module.exports = { OUT, newId, validId, saveMedia, mediaPath, loadMedia, saveRecord, loadRecord, cleanup };
