// Fact checker: compares the text of a source deck with a new deck, slide by slide.
// Reports missing numbers, numbers that appear from nowhere, text that was dropped, schedule changes.
// Works on extracted text, so it checks what is actually on the slides, not what the model claims.

const DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const STOP = new Set(["في", "من", "على", "الى", "إلى", "عن", "مع", "او", "أو", "ثم", "و", "هي", "هو", "ان", "أن", "إن", "لا", "ما", "كل", "قد", "تم", "the", "and", "of", "to", "in", "for", "a", "an"]);

function norm(s) {
  return String(s || "")
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d])
    .replace(/[ً-ٰٟـ]/g, "") // tashkeel + tatweel
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[‌-‏‪-‮]/g, "")
    .toLowerCase();
}
function tokens(s) {
  return norm(s).split(/[^\p{L}\p{N}%]+/u).filter((w) => w.length >= 2 && !STOP.has(w));
}
function numbers(s) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?%?/g;
  let m;
  // unit powers are not numbers: م2 / م² / m3 / M2 …
  const t = norm(s).replace(/²/g, "2").replace(/³/g, "3").replace(/([مm])\s?[23](?!\d)/g, "$1");
  while ((m = re.exec(t))) {
    let v = m[0].replace(/,(?=\d{3}\b)/g, "").replace(/,$/, "");
    v = v.replace(/^0+(?=\d)/, "");
    out.push(v);
  }
  return out;
}

// source / target: [{ n, texts: [...], notes, source?: n }]
function compareDecks(source, target, { sourceTimelines = {}, targetTimelines = {} } = {}) {
  const visTxt = (sl) => sl.texts.join("\n");
  const srcAll = new Set();
  for (const s of source) for (const v of numbers(visTxt(s)).concat(numbers(s.notes))) srcAll.add(v);
  const poolOf = (n) => { const tagged = target.filter((t) => [].concat(t.source || []).includes(n)); return tagged.length ? tagged : target; };

  // Every number of a source slide must appear on the slide(s) it became (or anywhere, if untagged).
  const missing_numbers = [], moved_numbers = [];
  for (const s of source) {
    const pool = poolOf(s.n);
    const vis = new Set(pool.flatMap((t) => numbers(visTxt(t))));
    const notes = new Set(pool.flatMap((t) => numbers(t.notes)));
    for (const v of new Set(numbers(visTxt(s)))) {
      if (vis.has(v)) continue;
      (notes.has(v) ? moved_numbers : missing_numbers).push({ value: v, source_slide: s.n });
    }
  }
  const new_numbers = [];
  for (const t of target) for (const v of numbers(visTxt(t))) if (!srcAll.has(v) && !new_numbers.some((x) => x.value === v)) new_numbers.push({ value: v, slide: t.n });

  const slides = [];
  for (const s of source) {
    const tagged = target.filter((t) => [].concat(t.source || []).includes(s.n));
    const pool = tagged.length ? tagged : target;
    const have = new Set(tokens(pool.map(visTxt).join("\n")));
    const haveNotes = new Set(tokens(pool.map((t) => t.notes || "").join("\n")));
    const src = tokens(visTxt(s));
    if (!src.length) continue;
    const kept = src.filter((w) => have.has(w)).length / src.length;
    const missing = [], moved = [];
    for (const para of s.texts) {
      const tk = tokens(para);
      if (!tk.length) continue;
      const hit = tk.filter((w) => have.has(w)).length / tk.length;
      if (hit >= 0.7) continue;
      const inNotes = tk.filter((w) => have.has(w) || haveNotes.has(w)).length / tk.length >= 0.7;
      (inNotes ? moved : missing).push(para.length > 140 ? para.slice(0, 140) + "…" : para);
    }
    if (kept < 0.999 || missing.length || moved.length) slides.push({ source: s.n, kept: Math.round(kept * 100), new_slides: tagged.map((t) => t.n), missing, moved_to_notes: moved });
  }

  const timeline = [];
  for (const [n, acts] of Object.entries(sourceTimelines)) {
    const now = targetTimelines[n];
    if (!now) { timeline.push({ source: +n, change: "removed" }); continue; }
    for (const a of acts) {
      const b = now.find((x) => norm(x.name) === norm(a.name));
      if (!b) timeline.push({ source: +n, activity: a.name, change: "removed" });
      else if (a.start !== b.start || a.end !== b.end) timeline.push({ source: +n, activity: a.name, change: `${a.start}–${a.end} → ${b.start}–${b.end}` });
    }
    for (const b of now) if (!acts.some((a) => norm(a.name) === norm(b.name))) timeline.push({ source: +n, activity: b.name, change: "added" });
  }

  const dropped = source.filter((s) => !target.some((t) => [].concat(t.source || []).includes(s.n)) && tokens(visTxt(s)).length).map((s) => s.n);
  const anyTagged = target.some((t) => t.source != null);
  return {
    source_slides: source.length, new_slides: target.length,
    missing_numbers, moved_numbers, new_numbers, slides: slides.filter((x) => x.missing.length || x.moved_to_notes.length || x.kept < 95),
    timeline, dropped: anyTagged ? dropped : [],
    ok: !missing_numbers.length && !new_numbers.length && !timeline.length && !(anyTagged && dropped.length) && !slides.some((x) => x.missing.length),
  };
}

// Arabic summary written by the server (the model cannot soften it).
function summarizeCheck(c, { overflow = [], autoFixes = [], rewritten = [] } = {}) {
  const L = ["**تقرير التحقق الآلي** (يُكتب تلقائيًا من الخادم):"];
  L.push(`- عدد الشرائح: الأصل ${c.source_slides} ← العرض الجديد ${c.new_slides}.`);
  if (c.dropped.length) L.push(`- ⚠️ شرائح من الأصل لا يقابلها شيء في العرض الجديد: ${c.dropped.join("، ")}.`);
  L.push(c.missing_numbers.length ? `- ⚠️ أرقام موجودة في الأصل ومفقودة الآن: ${c.missing_numbers.slice(0, 15).map((x) => `${x.value} (شريحة ${x.source_slide})`).join("، ")}.` : "- الأرقام: كل أرقام الأصل موجودة في العرض الجديد.");
  if (c.new_numbers.length) L.push(`- ⚠️ أرقام جديدة لا توجد في الأصل (تحقق منها): ${c.new_numbers.slice(0, 15).map((x) => `${x.value} (شريحة ${x.slide})`).join("، ")}.`);
  if (c.moved_numbers.length) L.push(`- أرقام نُقلت إلى ملاحظات المتحدث: ${c.moved_numbers.map((x) => x.value).join("، ")}.`);
  if (c.timeline.length) L.push(`- ⚠️ تغييرات في الجدول الزمني: ${c.timeline.map((t) => (t.activity ? `«${t.activity}» ${t.change === "removed" ? "حُذف" : t.change === "added" ? "أُضيف" : t.change}` : "حُذف الجدول")).join("؛ ")}.`);
  else L.push("- الجدول الزمني: بدون تغيير.");
  const lost = c.slides.filter((s) => s.missing.length && !rewritten.includes(s.source));
  for (const s of lost.slice(0, 8)) L.push(`- ⚠️ نص من الشريحة ${s.source} غير موجود: ${s.missing.slice(0, 3).map((m) => `«${m}»`).join("، ")}${s.missing.length > 3 ? ` (+${s.missing.length - 3})` : ""}.`);
  const rw = c.slides.filter((s) => rewritten.includes(s.source));
  for (const s of rw) L.push(`- الشريحة ${s.source} أُعيدت صياغتها بطلبك: بقي ${s.kept}% من كلماتها الأصلية${s.missing.length ? `؛ راجع: ${s.missing.slice(0, 2).map((m) => `«${m}»`).join("، ")}` : ""}.`);
  const moved = c.slides.filter((s) => s.moved_to_notes.length);
  if (moved.length) L.push(`- نصوص نُقلت إلى ملاحظات المتحدث: ${moved.map((s) => `شريحة ${s.source}`).join("، ")}.`);
  if (autoFixes.length) L.push(`- إصلاحات تلقائية للمساحة: ${autoFixes.join("؛ ")}.`);
  L.push(overflow.length ? `- ⚠️ نصوص لا تتسع لمكانها: ${overflow.slice(0, 6).map((o) => `شريحة ${o.slide} (${o.label})`).join("، ")}.` : "- كل النصوص داخل حدود مربعاتها (فُحصت بالقياس الفعلي للخط).");
  if (c.ok && !overflow.length && !lost.length) L.push("✅ لم يُفقد أي محتوى.");
  return L.join("\n");
}

module.exports = { norm, tokens, numbers, compareDecks, summarizeCheck };
