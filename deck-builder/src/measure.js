// Measures text with real fonts (Pango via sharp, the same fontconfig fonts LibreOffice uses for the PDF)
// instead of estimating from character counts. Used after a build to find text that overflows its box.
const sharp = require("sharp");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cache = new Map();

async function inkHeight(markup, widthPt, sizePt, bold) {
  const key = `${widthPt}|${sizePt}|${bold}|${markup}`;
  if (cache.has(key)) return cache.get(key);
  const font = `Liberation Sans,Noto Kufi Arabic${bold ? " Bold" : ""} ${sizePt}`; // the fonts LibreOffice uses for Arial + Arabic
  const { info } = await sharp({ text: { text: markup, font, width: Math.max(10, Math.round(widthPt)), dpi: 72, wrap: "word-char" } })
    .png().toBuffer({ resolveWithObject: true });
  if (cache.size > 5000) cache.clear();
  cache.set(key, info.height);
  return info.height;
}

// Line pitch for a font size: height of two marked lines minus one.
async function pitch(sizePt, bold) {
  const one = await inkHeight("|اج", 2000, sizePt, bold);
  const two = await inkHeight("|اج\n|اج", 2000, sizePt, bold);
  return { L: two - one, first: one };
}

// Number of wrapped lines of one paragraph (markup may hold <b> spans).
async function lineCount(markup, widthPt, sizePt, bold) {
  const { L, first } = await pitch(sizePt, bold);
  const h = await inkHeight("|" + markup, widthPt, sizePt, bold);
  return { lines: Math.max(1, Math.round((h - first) / L) + 1), L };
}

// Pango gives the line breaks; the height uses PowerPoint/LibreOffice line pitch (1.2 × size × spacing).
// box: { paras: [{ markup, size, bold, gapPt }], w, h (inches), lineMult }
const PITCH = 1.2;
async function neededHeight(box) {
  let pt = 0;
  for (let i = 0; i < box.paras.length; i++) {
    const p = box.paras[i];
    const { lines } = await lineCount(p.markup, box.w * 72, p.size, p.bold);
    pt += lines * PITCH * p.size * (box.lineMult || 1) + (i < box.paras.length - 1 ? p.gapPt || 0 : 0);
  }
  return pt / 72;
}

async function measureBoxes(boxes) {
  const over = [];
  for (const b of boxes) {
    if (!b.paras.length || b.w <= 0 || b.h <= 0) continue;
    const need = await neededHeight(b);
    if (need > b.h * 1.02 + 0.02) over.push({ key: b.key, slide: b.slide, label: b.label, need, have: b.h, ratio: need / b.h, text: b.paras.map((p) => p.plain).join(" ").slice(0, 60) });
  }
  return over;
}

// Tables grow downwards in PowerPoint; check the grown table still fits above `bottom`.
async function measureTables(tables) {
  const over = [];
  for (const t of tables) {
    let total = 0;
    for (let r = 0; r < t.rows.length; r++) {
      let need = t.rowH[r];
      for (let c = 0; c < t.rows[r].length; c++) {
        const cell = t.rows[r][c];
        if (!cell.text) continue;
        const { lines } = await lineCount(esc(cell.text), (t.colW[c] - t.padX) * 72, cell.size, cell.bold);
        need = Math.max(need, (lines * PITCH * cell.size) / 72 + 0.08);
      }
      total += need;
    }
    if (t.y + total > t.bottom + 0.05) over.push({ key: t.key, slide: t.slide, label: "table", need: total, have: t.bottom - t.y, ratio: total / (t.bottom - t.y), table: true });
  }
  return over;
}

module.exports = { measureBoxes, measureTables, esc };
