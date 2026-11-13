// Deck lifecycle: import a pptx (lossless for CoreBuild decks, mechanical conversion otherwise),
// build, edit specific slides, and check every new version against the one before it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { readPptx } = require("./pptx_read");
const { convertDeck } = require("./convert");
const { renderDeck, validateSpec, flat } = require("./render");
const { RENDERERS } = require("./slides");
const { compareDecks, summarizeCheck, norm } = require("./facts");
const store = require("./store");

const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, Object.assign({ timeout: 240000 }, opts), (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

// Render chosen pages of a pptx to PNG (for slides kept as pictures).
async function renderPages(buffer, pages) {
  if (!pages.length) return {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pages-"));
  try {
    const src = path.join(dir, "src.pptx");
    fs.writeFileSync(src, buffer);
    await run("soffice", [`-env:UserInstallation=file://${dir}/lo`, "--headless", "--convert-to", "pdf", "--outdir", dir, src]);
    const out = {};
    for (const n of pages) {
      await run("pdftoppm", ["-r", "120", "-png", "-f", String(n), "-l", String(n), "-singlefile", path.join(dir, "src.pdf"), path.join(dir, `p${n}`)]);
      out[n] = fs.readFileSync(path.join(dir, `p${n}.png`));
    }
    return out;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const slideText = (ex) => ex.slides.map((s) => ({ n: s.n, texts: s.texts, notes: s.notes || "" }));
const timelinesOf = (spec, key = (s, n) => n) => {
  const out = {};
  flat(spec).forEach(({ s }, i) => { if (s.type === "timeline") out[key(s, i + 1)] = s.activities || []; });
  return out;
};

function outline(rec) {
  return flat(rec.spec).map(({ s, si }, i) => ({ n: i + 1, type: s.type, title: s.title || (s.panel && s.panel.value) || "", section: rec.spec.sections[si].title, ...(s.source != null ? { source: s.source } : {}) }));
}

// Build a version, save the files and the record, and check it against `base` (previous version or source deck).
async function buildVersion({ spec, parent = null, base = null, tags = null, rewritten = [], save, kind }) {
  const id = store.newId();
  const r = await renderDeck(spec, { deckId: id });
  const links = await save(r.buffer, r.spec.file_name || r.spec.title, id);
  const ex = await readPptx(r.buffer);
  const texts = slideText(ex);
  let check = null, report = null;
  if (base) {
    // tags[i] = which base slide the new slide i came from (falls back to `source` fields)
    const flatNew = flat(r.spec);
    const target = texts.map((t, i) => Object.assign({}, t, { source: tags ? tags(flatNew[i].s, i) : flatNew[i].s.source }));
    const tgtTl = {};
    flatNew.forEach(({ s }, i) => { if (s.type === "timeline") { const k = target[i].source; if (k != null) tgtTl[k] = s.activities || []; } });
    check = compareDecks(base.texts, target, { sourceTimelines: base.timelines || {}, targetTimelines: tgtTl });
    report = summarizeCheck(check, { overflow: r.overflow, autoFixes: r.autoFixes, rewritten });
  } else if (r.overflow.length || r.autoFixes.length) {
    report = summarizeCheck({ source_slides: r.slides, new_slides: r.slides, missing_numbers: [], moved_numbers: [], new_numbers: [], slides: [], timeline: [], dropped: [], ok: true }, { overflow: r.overflow, autoFixes: r.autoFixes });
  }
  flat(r.spec).forEach(({ s }) => { delete s._pn; });
  const rec = store.saveRecord({ id, kind, parent, created: new Date().toISOString(), spec: r.spec, texts, links });
  return Object.assign({ deck_id: id, slides: r.slides, warnings: r.warnings, auto_fixes: r.autoFixes, check, check_report: report }, links, { outline: outline(rec) });
}

async function importDeck(buffer, filename, save) {
  const ex = await readPptx(buffer, { withMedia: true });
  const m = /corebuild-deck:([0-9a-f]{12})/.exec(ex.keywords || "");
  const prev = m ? store.loadRecord(m[1]) : null;
  const same = (a, b) => norm(a.join("\n")).replace(/\s+/g, "") === norm(b.join("\n")).replace(/\s+/g, "");
  if (prev && prev.texts.length === ex.slides.length && ex.slides.every((s, i) => same(s.texts, prev.texts[i].texts))) {
    // Unchanged CoreBuild deck: continue from its saved spec, nothing re-typed.
    return Object.assign({ deck_id: prev.id, mode: "lossless", slides: prev.texts.length, note: "This is a CoreBuild deck that was not changed outside the system; its saved slides are used exactly." }, prev.links, { outline: outline(prev) });
  }
  const mediaRef = (p) => (ex.media[p] ? store.saveMedia(ex.media[p]) : undefined);
  const conv = convertDeck(ex, { mediaRef });
  // Slides that were not changed outside CoreBuild keep their saved spec.
  let reused = 0;
  if (prev && prev.texts.length === ex.slides.length) {
    const prevFlat = flat(prev.spec);
    for (const sec of conv.spec.sections) {
      sec.slides = sec.slides.flatMap((s) => {
        if (!same(ex.slides[s.source - 1].texts, prev.texts[s.source - 1].texts)) return [s];
        if (sec.slides.findIndex((x) => x.source === s.source) !== sec.slides.indexOf(s)) return [];
        reused++;
        return [Object.assign({}, prevFlat[s.source - 1].s, { source: s.source })];
      });
    }
  }
  if (conv.pictures.length) {
    const imgs = await renderPages(buffer, conv.pictures.map((p) => p.n));
    for (const p of conv.pictures) if (imgs[p.n]) p.slide.image = store.saveMedia(imgs[p.n]);
  }
  conv.spec.file_name = (filename || "deck").replace(/\.pptx$/i, "");
  const base = { texts: slideText(ex), timelines: conv.timelines };
  const out = await buildVersion({ spec: conv.spec, base, kind: "import", save });
  return Object.assign(out, {
    mode: prev ? "partly_reused" : "converted", reused_slides: reused, source_slides: ex.slides.length,
    kept_as_picture: conv.report.filter((r) => r.as === "picture").map((r) => ({ source: r.source, reason: r.reason })),
  });
}

// ---------- edits ----------
function setPath(obj, p, value) {
  const keys = String(p).split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = /^\d+$/.test(keys[i]) ? +keys[i] : keys[i];
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  }
  const last = /^\d+$/.test(keys[keys.length - 1]) ? +keys[keys.length - 1] : keys[keys.length - 1];
  if (value === null) Array.isArray(o) ? o.splice(last, 1) : delete o[last];
  else o[last] = value;
}

function applyEdits(spec, edits) {
  const entries = flat(spec).map(({ si, s }, i) => ({ n: i + 1, si, s: clone(s), pn: i + 1 }));
  const total = entries.length;
  const changes = [], rewritten = [], errors = [];
  const check = (n, op) => { if (!Number.isInteger(n) || n < 1 || n > total) { errors.push(`${op}: slide ${n} does not exist (the deck has ${total} slides)`); return false; } return true; };
  const typeOk = (s, op) => { if (!s || !RENDERERS[s.type]) { errors.push(`${op}: unknown slide type "${s && s.type}"`); return false; } return true; };
  const inserts = {}, deletes = new Set(), moves = [];
  for (const e of edits) {
    const op = e.op, n = Number(e.slide);
    if (op === "replace") {
      if (!check(n, op)) continue;
      const repl = [].concat(e.with || e.slides || []);
      if (!repl.length || !repl.every((s) => typeOk(s, op))) continue;
      const ent = entries[n - 1];
      const before = ent.s.title || "";
      ent.s = Object.assign({ source: ent.s.source }, repl[0]);
      if (repl.length > 1) inserts[n] = (inserts[n] || []).concat(repl.slice(1).map((s) => ({ si: ent.si, s: Object.assign({ source: ent.s.source }, s), pn: n })));
      if (e.rewrite) rewritten.push(n);
      changes.push(`الشريحة ${n}: استُبدلت${repl.length > 1 ? ` بـ ${repl.length} شرائح` : ""} («${before}» ← «${repl.map((s) => s.title || s.type).join("» + «")}»)`);
    } else if (op === "update") {
      if (!check(n, op)) continue;
      const ent = entries[n - 1];
      for (const [p, v] of Object.entries(e.set || {})) setPath(ent.s, p, v);
      if (!typeOk(ent.s, op)) continue;
      if (e.rewrite) rewritten.push(n);
      changes.push(`الشريحة ${n}: عُدّلت الحقول ${Object.keys(e.set || {}).join("، ")}`);
    } else if (op === "insert_after") {
      if (n !== 0 && !check(n, op)) continue;
      const add = [].concat(e.slides || e.with || []);
      if (!add.length || !add.every((s) => typeOk(s, op))) continue;
      const anchor = entries[Math.max(0, n - 1)];
      inserts[n] = (inserts[n] || []).concat(add.map((s) => ({ si: anchor.si, s: Object.assign(n ? { source: anchor.s.source } : {}, s), pn: n || null })));
      changes.push(`أُضيفت ${add.length > 1 ? `${add.length} شرائح` : "شريحة"} بعد الشريحة ${n}: «${add.map((s) => s.title || s.type).join("» + «")}»`);
    } else if (op === "delete") {
      if (!check(n, op)) continue;
      deletes.add(n);
      changes.push(`⚠️ حُذفت الشريحة ${n} («${entries[n - 1].s.title || entries[n - 1].s.type}»)`);
    } else if (op === "move") {
      const to = Number(e.after);
      if (!check(n, op) || (to !== 0 && !check(to, op))) continue;
      moves.push({ n, to });
      changes.push(`نُقلت الشريحة ${n} إلى ما بعد الشريحة ${to}`);
    } else errors.push(`unknown op "${op}" (use replace, update, insert_after, delete, move)`);
  }
  if (errors.length) { const err = new Error(errors.join("\n")); err.status = 400; throw err; }
  let list = [];
  for (const ins of inserts[0] || []) list.push(ins);
  for (const ent of entries) {
    if (!deletes.has(ent.n)) list.push(ent);
    for (const ins of inserts[ent.n] || []) list.push(ins);
  }
  for (const mv of moves) {
    const idx = list.findIndex((x) => x.n === mv.n);
    if (idx < 0) continue;
    const [item] = list.splice(idx, 1);
    let at = mv.to === 0 ? 0 : list.findIndex((x) => x.n === mv.to) + 1;
    if (mv.to !== 0 && at === 0) at = list.length;
    list.splice(at, 0, item);
  }
  const out = clone(spec);
  out.sections.forEach((sec) => { sec.slides = []; });
  // Keep each slide in its section; a moved slide joins the section of the slide before it.
  let lastSi = 0;
  list.forEach((x, k) => {
    const si = moves.some((m) => m.n === x.n) && k > 0 ? lastSi : x.si;
    out.sections[si].slides.push(x.s);
    lastSi = si;
  });
  out.sections = out.sections.filter((s) => s.slides.length);
  const pn = list.map((x) => x.pn);
  return { spec: out, changes, rewritten, pn, unchanged: total - new Set(changes.map((c) => (/الشريحة (\d+)/.exec(c) || [])[1]).filter(Boolean)).size - deletes.size };
}

async function editDeck(id, body, save) {
  const rec = store.loadRecord(id);
  if (!rec) { const e = new Error(`deck ${id} not found (it may be older than the retention period) — upload the PowerPoint again and call import_deck`); e.status = 404; throw e; }
  const edits = Array.isArray(body.edits) ? body.edits : typeof body.edits === "string" ? JSON.parse(body.edits) : [];
  const ap = applyEdits(rec.spec, edits);
  for (const k of ["title", "footer", "tagline", "file_name"]) if (body[k]) ap.spec[k] = body[k];
  const errs = validateSpec(ap.spec);
  if (errs.length) { const e = new Error(errs.join("\n")); e.status = 400; throw e; }
  // Each slide carries the number of the slide it came from in the previous version (_pn);
  // continuation slides made by auto-split inherit it.
  flat(ap.spec).forEach(({ s }, i) => { s._pn = ap.pn[i]; });
  const base = { texts: rec.texts, timelines: timelinesOf(rec.spec) };
  const out = await buildVersion({ spec: ap.spec, parent: id, base, rewritten: ap.rewritten, kind: "edit", save, tags: (s) => s._pn });
  const changeReport = ["**التغييرات المطبقة** (يكتبها الخادم):"].concat(ap.changes.map((c) => "- " + c), [`- بقية الشرائح (${Math.max(0, ap.unchanged)}) لم تتغير.`]).join("\n");
  return Object.assign(out, { parent: id, changes: ap.changes, change_report: changeReport });
}

function getSlides(id, which) {
  const rec = store.loadRecord(id);
  if (!rec) { const e = new Error(`deck ${id} not found`); e.status = 404; throw e; }
  const all = flat(rec.spec);
  const want = which === "all" ? all.map((_, i) => i + 1) : String(which || "").split(/[,\s]+/).filter(Boolean).flatMap((p) => {
    const m = /^(\d+)-(\d+)$/.exec(p); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, k) => +m[1] + k) : [+p];
  });
  return {
    deck_id: id, title: rec.spec.title, footer: rec.spec.footer, total: all.length,
    slides: want.filter((n) => all[n - 1]).map((n) => Object.assign({ n, section: rec.spec.sections[all[n - 1].si].title }, all[n - 1].s)),
    outline: which ? undefined : outline(rec),
  };
}

module.exports = { importDeck, editDeck, getSlides, buildVersion, applyEdits, outline };
