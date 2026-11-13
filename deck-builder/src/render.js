// Deck JSON → .pptx buffer (+ warnings the model should act on).
const { createDeck, finalizeTheme } = require("./kit");
const { RENDERERS } = require("./slides");

const MAX_SLIDES = 80;

function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["spec must be a JSON object"];
  if (!Array.isArray(spec.sections) || !spec.sections.length) errors.push('spec.sections must be a non-empty array of {"title", "slides": [...]}');
  let n = 0;
  (spec.sections || []).forEach((sec, si) => {
    if (!Array.isArray(sec.slides)) { errors.push(`sections[${si}].slides must be an array`); return; }
    sec.slides.forEach((s, i) => {
      n++;
      if (!s || !RENDERERS[s.type]) errors.push(`sections[${si}].slides[${i}]: unknown type "${s && s.type}". Valid types: ${Object.keys(RENDERERS).join(", ")}`);
    });
  });
  if (n > MAX_SLIDES) errors.push(`too many slides (${n}); the limit is ${MAX_SLIDES}`);
  return errors;
}

async function renderDeck(spec) {
  const errors = validateSpec(spec);
  if (errors.length) { const e = new Error(errors.join("\n")); e.status = 400; throw e; }
  const d = createDeck({ title: spec.title, footer: spec.footer, tagline: spec.tagline });
  for (const sec of spec.sections) {
    const section = sec.title || "القسم";
    d.pres.addSection({ title: section });
    for (const s of sec.slides) {
      const sl = await RENDERERS[s.type](d, s, { section });
      if (s.notes && sl) sl.addNotes(String(s.notes));
    }
  }
  const buffer = await finalizeTheme(await d.pres.write({ outputType: "nodebuffer" }));
  return { buffer, warnings: d.warnings, slides: d.slideNo };
}

module.exports = { renderDeck, validateSpec };
