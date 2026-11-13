// Deck JSON → .pptx buffer. Every text box is measured with real fonts after the build:
// boxes that overflow are first shrunk (within each box's minimum size), then the slide is split
// into a continuation slide «(تابع)». Content is never cut. What still does not fit is reported.
const JSZip = require("jszip");
const { createDeck, finalizeTheme } = require("./kit");
const { RENDERERS } = require("./slides");
const { measureBoxes, measureTables } = require("./measure");
const { loadMedia } = require("./store");

const MAX_SLIDES = 80;
const clone = (o) => JSON.parse(JSON.stringify(o));
const cont = (t) => (/\(تابع\)\s*$/.test(t || "") ? t : `${t || ""} (تابع)`);

function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["spec must be a JSON object"];
  if (!Array.isArray(spec.sections) || !spec.sections.length) errors.push('spec.sections must be a non-empty array of {"title", "slides": [...]}');
  let n = 0;
  (spec.sections || []).forEach((sec, si) => {
    if (!Array.isArray(sec.slides)) { errors.push(`sections[${si}].slides must be an array`); return; }
    sec.slides.forEach((s, i) => {
      n++;
      if (!s || !RENDERERS[s.type]) errors.push(`sections[${si}].slides[${i}] (slide ${n}): unknown type "${s && s.type}". Valid types: ${Object.keys(RENDERERS).join(", ")}`);
    });
  });
  if (n > MAX_SLIDES) errors.push(`too many slides (${n}); the limit is ${MAX_SLIDES}`);
  return errors;
}

const flat = (spec) => spec.sections.flatMap((sec, si) => sec.slides.map((s, i) => ({ si, i, s })));

async function renderOnce(spec, fit, mediaData) {
  const d = createDeck({ title: spec.title, footer: spec.footer, tagline: spec.tagline, fit, mediaData });
  for (const sec of spec.sections) {
    const section = sec.title || "القسم";
    d.pres.addSection({ title: section });
    for (const s of sec.slides) {
      const sl = await RENDERERS[s.type](d, s, { section });
      if (s.notes && sl) sl.addNotes(String(s.notes));
    }
  }
  return d;
}

// Split slides whose body still overflows after shrinking. Returns notes for the reply.
function autoSplit(spec, over) {
  const notes = [];
  const slides = flat(spec);
  const bySlide = {};
  for (const o of over) if (!/title|label|value|heading|kicker/.test(o.label)) (bySlide[o.slide] = bySlide[o.slide] || []).push(o);
  const nums = Object.keys(bySlide).map(Number).sort((a, b) => b - a); // from the end so indices stay valid
  for (const n of nums) {
    const ref = slides[n - 1];
    if (!ref) continue;
    const s = ref.s;
    let parts = null;
    if (s.type === "cards" && (s.cards || []).length >= 2) {
      const h = Math.ceil(s.cards.length / 2);
      parts = [Object.assign({}, s, { cards: s.cards.slice(0, h) }), Object.assign({}, s, { title: cont(s.title), subtitle: undefined, notes: undefined, cards: s.cards.slice(h) })];
    } else if ((s.type === "cards" || s.type === "hero") && (s.cards || []).length === 1 && (s.cards[0].items || []).length >= 2) {
      const c = s.cards[0], h = Math.ceil(c.items.length / 2);
      const first = Object.assign({}, s, { cards: [Object.assign({}, c, { items: c.items.slice(0, h), tag: undefined })] });
      const second = { type: "cards", source: s.source, _pn: s._pn, kicker: s.kicker, title: cont(s.title), cards: [Object.assign({}, c, { items: c.items.slice(h) })] };
      parts = [first, second];
    } else if (s.type === "hero" && (s.cards || []).length >= 2) {
      parts = [Object.assign({}, s, { cards: s.cards.slice(0, 1) }), { type: "cards", source: s.source, _pn: s._pn, kicker: s.kicker, title: cont(s.title), cards: s.cards.slice(1) }];
    } else if (s.type === "tiles" && (s.tiles || []).length > 4) {
      const h = Math.ceil(s.tiles.length / 2);
      parts = [Object.assign({}, s, { tiles: s.tiles.slice(0, h) }), Object.assign({}, s, { title: cont(s.title), notes: undefined, tiles: s.tiles.slice(h).map((t, i) => (s.numbered && !t.number ? Object.assign({ number: String(h + i + 1).padStart(2, "0") }, t) : t)), numbered: false })];
    } else if (s.type === "table" && (s.rows || []).length >= 2) {
      const h = Math.ceil(s.rows.length / 2);
      parts = [Object.assign({}, s, { rows: s.rows.slice(0, h), note: undefined }), Object.assign({}, s, { title: cont(s.title), notes: undefined, rows: s.rows.slice(h) })];
    }
    if (!parts) continue;
    spec.sections[ref.si].slides.splice(ref.i, 1, ...parts);
    notes.push(`الشريحة ${n} لم يتسع نصها فقُسِّمت إلى شريحتين («${cont(s.title)}»)`);
  }
  return notes;
}

async function stampId(buffer, id) {
  if (!id) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file("docProps/core.xml");
  if (!f) return buffer;
  let x = await f.async("string");
  const kw = `<cp:keywords>corebuild-deck:${id}</cp:keywords>`;
  x = /<cp:keywords>[^<]*<\/cp:keywords>|<cp:keywords\/>/.test(x) ? x.replace(/<cp:keywords>[^<]*<\/cp:keywords>|<cp:keywords\/>/, kw) : x.replace("</cp:coreProperties>", kw + "</cp:coreProperties>");
  zip.file("docProps/core.xml", x);
  for (const n of Object.keys(zip.files)) if (zip.files[n].dir) delete zip.files[n]; // some viewers refuse folder entries
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function renderDeck(input, { deckId, autoFix = true } = {}) {
  const errors = validateSpec(input);
  if (errors.length) { const e = new Error(errors.join("\n")); e.status = 400; throw e; }
  const spec = clone(input);
  const { data: mediaData, missing } = await loadMedia(spec);
  let fit = {}, d, over = [], shrinkRounds = 0;
  const autoFixes = [];
  for (let pass = 0; pass < 12; pass++) {
    d = await renderOnce(spec, fit, mediaData);
    over = (await measureBoxes(d.boxes)).concat(await measureTables(d.tables));
    if (!over.length || !autoFix) break;
    const shrinkable = over.filter((o) => !o.table && (fit[o.key] || 1) < 3);
    if (shrinkRounds < 3 && shrinkable.length) {
      for (const o of shrinkable) fit[o.key] = (fit[o.key] || 1) * o.ratio * 1.04;
      shrinkRounds++;
      continue;
    }
    const notes = autoSplit(spec, over);
    if (!notes.length) break;
    autoFixes.push(...notes);
    fit = {}; shrinkRounds = 0;
  }
  const warnings = d.warnings.slice();
  for (const m of missing) warnings.push(`image ${m} not found — upload it again with list_chat_photos`);
  for (const o of over) {
    warnings.push(o.table
      ? `slide ${o.slide}: the table is taller than the slide (needs ${Math.round(o.ratio * 100)}% of the space) — split its rows across two slides`
      : `slide ${o.slide}: ${o.label} does not fit its box (needs ${Math.round(o.ratio * 100)}% of the space): "${o.text}…" — split the slide or move detail to notes; do not delete content`);
  }
  const buffer = await stampId(await finalizeTheme(await d.pres.write({ outputType: "nodebuffer" })), deckId);
  return { buffer, warnings, slides: d.slideNo, spec, overflow: over.map((o) => ({ slide: o.slide, label: o.label, ratio: Math.round(o.ratio * 100) })), autoFixes };
}

module.exports = { renderDeck, validateSpec, flat };
