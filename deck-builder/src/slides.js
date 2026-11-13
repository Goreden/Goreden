// Slide renderers. Each takes (deck, spec, ctx) where spec is one entry of the deck JSON.
// The model only chooses a slide `type` and fills content; all geometry lives here.

const fmtNum = (n, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

async function cover(d, s, ctx) {
  const { T, TF, COL, IMG, LOGO_R, MARK_R, M, R } = d;
  const sl = d.darkSlide(ctx.section);
  sl.addImage({ path: IMG.logoLight, x: R - 0.82 * LOGO_R, y: 0.6, h: 0.82, w: 0.82 * LOGO_R, altText: "CoreBuild" });
  sl.addImage({ path: IMG.markLight, x: 0.9, y: 1.3, h: 4.9, w: 4.9 * MARK_R, altText: "CoreBuild mark" });
  if (s.kicker) T(sl, s.kicker, { x: 6.0, y: 2.1, w: R - 6.0, h: 0.4, fontSize: 13, bold: true, color: COL.gold, charSpacing: 3, rtlMode: false });
  TF(sl, s.title || "", { x: 6.0, y: 2.55, w: R - 6.0, h: 1.0, bold: true, color: COL.paper }, { size: 48, min: 34, label: "cover title" });
  if (s.subtitle) TF(sl, s.subtitle, { x: 6.0, y: 3.65, w: R - 6.0, h: 1.2, color: COL.paper, lineSpacingMultiple: 1.15 }, { size: 24, min: 18, label: "cover subtitle" });
  if (s.meta) TF(sl, s.meta, { x: 6.0, y: 4.9, w: R - 6.0, h: 0.5, color: COL.stone }, { size: 13, min: 11, label: "cover meta" });
  if (s.submitted_to) T(sl, [
    { text: (s.submitted_label || "مقدم إلى:") + " ", options: { color: COL.gold, bold: true } },
    { text: s.submitted_to, options: { color: COL.stone } },
  ], { x: 6.0, y: 5.55, w: R - 6.0, h: 0.4, fontSize: 14 });
  T(sl, "COREBUILD INVESTMENTS ESTABLISHMENT", { x: M, y: 6.85, w: 6, h: 0.3, fontSize: 9, bold: true, color: COL.warm, charSpacing: 1, align: "left", rtlMode: false });
  return sl;
}

async function agenda(d, s, ctx) {
  const { TF, COL } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title || "محتويات العرض");
  const items = (s.items || []).slice(0, 6);
  if ((s.items || []).length > 6) d.warn("agenda holds at most 6 items");
  const cols = items.length <= 4 ? 2 : 3;
  const boxes = d.grid(items.length, cols, { y0: 1.7, h: 4.95 });
  for (let i = 0; i < items.length; i++) {
    const { x, y, w, h } = boxes[i], it = items[i];
    d.panel(sl, x, y, w, h);
    await d.iconCircle(sl, it.icon, x + 0.3, y + 0.3, 0.6);
    d.T(sl, it.number || String(i + 1).padStart(2, "0"), { x: x + 1.2, y: y + 0.28, w: w - 1.5, h: 0.65, fontSize: 30, bold: true, color: COL.gold, valign: "middle" });
    TF(sl, it.title || "", { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: 0.45, bold: true }, { size: 19, min: 15, label: "agenda title" });
    if (it.subtitle) TF(sl, it.subtitle, { x: x + 0.3, y: y + 1.6, w: w - 0.6, h: h - 1.8, color: COL.grey }, { size: 14, min: 12, label: "agenda subtitle" });
  }
  return sl;
}

async function divider(d, s, ctx) {
  return d.dividerSlide(ctx.section, s.number, s.title, s.subtitle);
}

// 1–3 cards side by side, each with icon, heading, "Label: text" items and optional tag chip.
async function cards(d, s, ctx) {
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const cs = (s.cards || []).slice(0, 3);
  if ((s.cards || []).length > 3) d.warn("a cards slide holds at most 3 cards");
  const boxes = d.grid(cs.length, cs.length);
  for (let i = 0; i < cs.length; i++) await d.card(sl, Object.assign({}, boxes[i], cs[i]));
  return sl;
}

// Dark hero panel (a big number or statement) beside 1–2 cards or 2–4 tiles.
async function hero(d, s, ctx) {
  const { T, TF, COL, M, R, CONTENT_Y, CONTENT_H } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const p = s.panel || {};
  const pw = 4.3, px = s.panel_side === "right" ? R - pw : M;
  d.darkPanel(sl, px, CONTENT_Y, pw, CONTENT_H);
  await d.iconCircle(sl, p.icon, px + pw - 0.95, 2.0, 0.6, { bg: COL.dark2 });
  if (p.label) TF(sl, p.label, { x: px + 0.35, y: 2.95, w: pw - 0.7, h: 0.4, bold: true, color: COL.gold }, { size: 14, min: 11, label: "panel label" });
  if (p.value) {
    const isNum = /^[\d.,%+\- ]+$/.test(p.value);
    TF(sl, p.value, { x: px + 0.35, y: 3.4, w: pw - 0.7, h: 1.15, bold: true, color: COL.paper, rtlMode: !isNum, valign: "middle" }, { size: isNum ? 60 : 30, min: 22, label: "panel value", lineMult: 1.1 });
  }
  if (p.unit) T(sl, p.unit, { x: px + 0.35, y: 4.6, w: pw - 0.7, h: 0.45, fontSize: 18, color: COL.stone });
  if (p.text) TF(sl, p.text, { x: px + 0.35, y: 5.2, w: pw - 0.7, h: 1.2, color: COL.stone, lineSpacingMultiple: 1.15 }, { size: 14, min: 12, label: "panel text" });
  const x0 = s.panel_side === "right" ? M : M + pw + 0.35, w = R - M - pw - 0.35;
  if (s.tiles && s.tiles.length) {
    const n = Math.min(4, s.tiles.length);
    const boxes = d.grid(n, n === 3 ? 3 : 2, { x0, w });
    for (let i = 0; i < n; i++) await tile(d, sl, boxes[i], s.tiles[i]);
  } else {
    const cs = (s.cards || []).slice(0, 2);
    const boxes = d.grid(cs.length, cs.length, { x0, w });
    for (let i = 0; i < cs.length; i++) await d.card(sl, Object.assign({}, boxes[i], cs[i]));
  }
  return sl;
}

async function tile(d, sl, { x, y, w, h }, t) {
  const { T, TF, COL } = d;
  d.panel(sl, x, y, w, h);
  await d.iconCircle(sl, t.icon, x + w - 0.9, y + 0.3, 0.6);
  if (t.number) T(sl, t.number, { x: x + 0.3, y: y + 0.3, w: 1.2, h: 0.6, fontSize: 26, bold: true, color: COL.gold, valign: "middle", align: "left", rtlMode: false });
  const headY = y + Math.min(1.1, h * 0.4);
  TF(sl, t.heading || "", { x: x + 0.3, y: headY, w: w - 0.6, h: 0.45, bold: true }, { size: 18, min: 14, label: "tile heading" });
  if (t.text) TF(sl, t.text, { x: x + 0.3, y: headY + 0.5, w: w - 0.6, h: y + h - (headY + 0.5) - 0.2, color: COL.grey, lineSpacingMultiple: 1.1 }, { size: 15, min: 12, label: "tile text" });
}

// 2–8 tiles (icon + heading + short text), optional subtitle line.
async function tiles(d, s, ctx) {
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const ts = (s.tiles || []).slice(0, 8);
  let y0 = d.CONTENT_Y, h = d.CONTENT_H;
  if (s.subtitle) { d.TF(sl, s.subtitle, { x: d.M, y: 1.45, w: d.R - d.M, h: 0.35, color: d.COL.grey }, { size: 14, min: 12, label: "subtitle" }); y0 = 2.0; h = 4.65; }
  const cols = ts.length <= 2 ? 2 : ts.length === 3 ? 3 : ts.length === 4 ? (s.columns || 2) : ts.length <= 6 ? 3 : 4;
  const boxes = d.grid(ts.length, cols, { y0, h });
  for (let i = 0; i < ts.length; i++) await tile(d, sl, boxes[i], Object.assign({ number: s.numbered ? String(i + 1).padStart(2, "0") : undefined }, ts[i]));
  return sl;
}

// 2–4 big numbers, optional fact strip underneath.
async function stats(d, s, ctx) {
  const { T, TF, COL, M, R } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const st = (s.stats || []).slice(0, 4);
  const facts = s.facts || [];
  const boxes = d.grid(st.length, st.length, { h: facts.length ? 3.0 : 5.0 });
  for (let i = 0; i < st.length; i++) {
    const { x, y, w, h } = boxes[i], it = st[i], dark = i === 0;
    dark ? d.darkPanel(sl, x, y, w, h) : d.panel(sl, x, y, w, h);
    await d.iconCircle(sl, it.icon, x + w - 0.92, y + 0.3, 0.62, dark ? { bg: COL.dark2 } : {});
    TF(sl, it.label || "", { x: x + 0.3, y: y + 0.3, w: w - 1.4, h: 0.62, bold: true, color: COL.gold, valign: "middle" }, { size: 14, min: 11, label: "stat label" });
    const isNum = /^[\d.,%+\- ]+$/.test(it.value || "");
    T(sl, [
      { text: String(it.value || ""), options: { fontSize: isNum ? (st.length > 3 ? 44 : 56) : 32, bold: true, color: dark ? COL.paper : COL.ink } },
      ...(it.unit ? [{ text: "  " + it.unit, options: { fontSize: 18, color: dark ? COL.stone : COL.grey } }] : []),
    ], { x: x + 0.3, y: y + 1.15, w: w - 0.6, h: h - 1.4, valign: "middle" });
  }
  if (facts.length) {
    d.panel(sl, M, 5.0, R - M, 1.65);
    const fw = (R - M - 0.6) / facts.length;
    facts.forEach((f, i) => {
      const x = R - 0.3 - fw - i * fw;
      T(sl, f.label || "", { x: x + 0.15, y: 5.3, w: fw - 0.3, h: 0.35, fontSize: 12, bold: true, color: COL.gold });
      TF(sl, f.value || "", { x: x + 0.15, y: 5.68, w: fw - 0.3, h: 0.75, bold: true }, { size: 18, min: 13, label: "fact value" });
    });
  }
  return sl;
}

// Numbered steps (2–5) with arrows, optional dark band of 2–4 items below.
async function processSlide(d, s, ctx) {
  const { T, TF, COL, M, R } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const steps = (s.steps || []).slice(0, 5);
  let y = 1.65;
  if (s.subtitle) { TF(sl, s.subtitle, { x: M, y: 1.55, w: R - M, h: 0.4, bold: true, valign: "middle" }, { size: 16, min: 13, label: "subtitle" }); y = 2.05; }
  const band = s.band && s.band.items && s.band.items.length;
  const h = band ? 2.2 : 6.65 - y;
  const gap = 0.45, n = steps.length, w = (R - M - (n - 1) * gap) / n;
  for (let i = 0; i < n; i++) {
    const x = R - w - i * (w + gap), st = steps[i];
    d.panel(sl, x, y, w, h);
    await d.iconCircle(sl, st.icon, x + w - 0.85, y + 0.25, 0.55);
    T(sl, String(i + 1).padStart(2, "0"), { x: x + 0.25, y: y + 0.25, w: 1, h: 0.55, fontSize: 20, bold: true, color: COL.gold, valign: "middle", align: "left", rtlMode: false });
    TF(sl, st.heading || "", { x: x + 0.25, y: y + 0.95, w: w - 0.5, h: 0.4, bold: true }, { size: 16, min: 13, label: "step heading" });
    if (st.text) TF(sl, st.text, { x: x + 0.25, y: y + 1.35, w: w - 0.5, h: h - 1.5, color: COL.grey }, { size: band ? 13 : 15, min: 11.5, label: "step text" });
    if (i < n - 1) sl.addImage({ data: await d.iconData("FaChevronLeft", d.HEX.gold), x: x - gap / 2 - 0.12, y: y + h / 2 - 0.12, w: 0.24, h: 0.24, altText: "" });
  }
  if (band) {
    const by = y + h + 0.3, bh = 6.65 - by, items = s.band.items.slice(0, 4);
    d.darkPanel(sl, M, by, R - M, bh);
    if (s.band.heading) T(sl, s.band.heading, { x: R - 4.3, y: by + 0.22, w: 4.0, h: 0.4, fontSize: 16, bold: true, color: COL.gold });
    const iw = (R - M - 0.6) / items.length;
    items.forEach((it, i) => {
      const x = R - 0.3 - iw - i * iw;
      TF(sl, it.heading || "", { x: x + 0.1, y: by + 0.72, w: iw - 0.3, h: 0.35, bold: true, color: COL.paper }, { size: 14, min: 12, label: "band heading" });
      TF(sl, it.text || "", { x: x + 0.1, y: by + 1.1, w: iw - 0.3, h: bh - 1.25, color: COL.stone }, { size: 12.5, min: 11, label: "band text" });
    });
  }
  return sl;
}

// Generic table. Columns are given in reading order (first column = rightmost).
async function table(d, s, ctx) {
  const { COL, HEX, M, R } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const cols = s.columns || [];
  const rows = s.rows || [];
  const tw = R - M;
  const weights = s.column_widths && s.column_widths.length === cols.length ? s.column_widths : cols.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((x) => (x / sum) * tw).reverse();
  const numeric = cols.map((_, ci) => rows.every((r) => /^[\d.,%\- ]*$/.test(String(r[ci] ?? ""))));
  const avail = (s.note ? 4.55 : 5.0) - 0.5;
  const fontSize = rows.length > 9 ? 11 : rows.length > 6 ? 12 : 13;
  const rh = Math.min(0.85, avail / Math.max(1, rows.length));
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    if (d.estLines(String(c ?? ""), (weights[ci] / sum) * tw - 0.3, fontSize) * fontSize * 1.15 / 72 > rh) d.warn(`table cell row ${ri + 1} col ${ci + 1} is too long — shorten it or split the table`);
  }));
  if (rows.length * 0.3 > avail) d.warn(`table has ${rows.length} rows; split it across slides (max ~${Math.floor(avail / 0.3)})`);
  const hd = cols.map((c, ci) => ({ text: String(c), options: { bold: true, color: COL.paper, fill: { color: COL.ink }, fontSize: fontSize + 0.5, align: numeric[ci] ? "center" : "right", rtlMode: true, valign: "middle" } })).reverse();
  const body = rows.map((r, ri) => cols.map((_, ci) => {
    const fill = { color: ri % 2 ? HEX.mist : HEX.paper };
    return { text: String(r[ci] ?? ""), options: { fill, fontSize, color: ci === 0 ? COL.ink : COL.grey, bold: ci === 0 || (numeric[ci] && s.bold_numbers !== false), align: numeric[ci] ? "center" : "right", rtlMode: !numeric[ci], valign: "middle" } };
  }).reverse());
  sl.addTable([hd, ...body], { x: M, y: d.CONTENT_Y, w: tw, colW, rowH: [0.5, ...rows.map(() => rh)], border: { type: "solid", color: HEX.line, pt: 0.75 }, margin: [0, 0.15, 0, 0.15] });
  if (s.note) d.TF(sl, s.note, { x: M, y: 6.3, w: tw, h: 0.4, color: COL.grey }, { size: 11, min: 10, label: "table note" });
  return sl;
}

// Gantt chart: months 1..N right-to-left, activities with start/end month and a category.
async function timeline(d, s, ctx) {
  const { T, COL, HEX, M, R } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const months = s.months || Math.max(...(s.activities || []).map((a) => a.end || 1));
  const acts = (s.activities || []).slice(0, 12);
  const palette = [COL.ink, COL.gold, COL.goldLight, COL.warm, COL.stone];
  const cats = Object.keys(s.categories || {});
  const colorOf = (c) => palette[Math.max(0, cats.indexOf(c)) % palette.length];
  const labW = 3.0, gx1 = R - labW - 0.1, mw = (gx1 - M) / months;
  const y0 = 1.55, hh = 0.38, rh = Math.min(0.42, 4.4 / Math.max(1, acts.length));
  const tblH = hh + acts.length * rh;
  d.panel(sl, M, y0, R - M, tblH, { rectRadius: 0.04, shadow: undefined });
  sl.addShape(d.pres.shapes.RECTANGLE, { x: M, y: y0, w: R - M, h: hh, fill: { color: COL.ink }, line: { type: "none" } });
  T(sl, s.activity_label || "النشاط", { x: R - labW, y: y0, w: labW - 0.15, h: hh, fontSize: 11, bold: true, color: COL.paper, valign: "middle" });
  for (let m = 1; m <= months; m++) {
    const x = gx1 - m * mw;
    T(sl, String(m), { x, y: y0, w: mw, h: hh, fontSize: months > 18 ? 8 : 10, bold: true, color: COL.paper, align: "center", valign: "middle", rtlMode: false });
    if (m > 1) sl.addShape(d.pres.shapes.LINE, { x: x + mw, y: y0 + hh, w: 0, h: acts.length * rh, line: { color: HEX.line, width: 0.5 } });
  }
  acts.forEach((a, i) => {
    const y = y0 + hh + i * rh;
    if (i % 2) sl.addShape(d.pres.shapes.RECTANGLE, { x: M + 0.01, y, w: R - M - 0.02, h: rh, fill: { color: COL.mist, transparency: 30 }, line: { type: "none" } });
    d.TF(sl, a.name || "", { x: R - labW, y, w: labW - 0.15, h: rh, valign: "middle" }, { size: 11, min: 9, label: "activity name" });
    const st = Math.max(1, a.start || 1), en = Math.min(months, Math.max(st, a.end || st));
    sl.addShape(d.pres.shapes.ROUNDED_RECTANGLE, { x: gx1 - en * mw + 0.04, y: y + rh * 0.22, w: (en - st + 1) * mw - 0.08, h: rh * 0.56, rectRadius: 0.05, fill: { color: colorOf(a.category) }, line: { type: "none" } });
  });
  sl.addShape(d.pres.shapes.LINE, { x: gx1, y: y0, w: 0, h: tblH, line: { color: HEX.line, width: 0.75 } });
  const ly = y0 + tblH + 0.2;
  cats.forEach((c, i) => {
    const x = R - 0.25 - i * 2.35;
    sl.addShape(d.pres.shapes.ROUNDED_RECTANGLE, { x, y: ly + 0.06, w: 0.25, h: 0.18, rectRadius: 0.03, fill: { color: colorOf(c) }, line: { type: "none" } });
    T(sl, s.categories[c], { x: x - 2.0, y: ly, w: 1.92, h: 0.3, fontSize: 10, color: COL.grey, valign: "middle" });
  });
  if (s.note) d.TF(sl, s.note, { x: M, y: ly, w: Math.max(2, R - M - cats.length * 2.35 - 0.2), h: 0.55, color: COL.grey }, { size: 10, min: 9, label: "timeline note" });
  return sl;
}

// Org chart: one root, up to 3 in level 2 (middle one connects down), up to 3 in level 3.
async function org(d, s, ctx) {
  const { T, COL, HEX, W, M, R } = d;
  const sl = d.contentSlide(ctx.section, s.kicker, s.title);
  const bw = 3.35, bh = 1.12, cx = W / 2, rows = [1.6, 3.25, 4.95];
  const gapX = (R - M - 3 * bw) / 2, colX = [R - bw, R - 2 * bw - gapX, M];
  const line = (x1, y1, x2, y2) => sl.addShape(d.pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color: HEX.stone, width: 1.25 } });
  const box = (x, y, p, dark) => {
    d.panel(sl, x, y, bw, bh, dark ? { fill: { color: COL.ink }, line: { type: "none" } } : {});
    T(sl, p.dept || "", { x: x + 0.25, y: y + 0.14, w: bw - 0.5, h: 0.26, fontSize: 11, bold: true, color: COL.gold });
    d.TF(sl, p.name || "", { x: x + 0.25, y: y + 0.42, w: bw - 0.5, h: 0.34, bold: true, color: dark ? COL.paper : COL.ink }, { size: 15, min: 12, label: "org name" });
    T(sl, p.role || "", { x: x + 0.25, y: y + 0.76, w: bw - 0.5, h: 0.26, fontSize: 11, color: dark ? COL.stone : COL.grey });
  };
  const lv2 = (s.level2 || []).slice(0, 3), lv3 = (s.level3 || []).slice(0, 3);
  const place = (n) => (n === 1 ? [1] : n === 2 ? [0, 2] : [0, 1, 2]);
  const drawLevel = (people, row, darkMid) => {
    const pos = place(people.length);
    const yMid = rows[row] - 0.25;
    if (people.length > 1) line(colX[pos[0]] + bw / 2, yMid, colX[pos[pos.length - 1]] + bw / 2, yMid);
    pos.forEach((p) => line(colX[p] + bw / 2, yMid, colX[p] + bw / 2, rows[row]));
    people.forEach((pp, i) => box(colX[pos[i]], rows[row], pp, darkMid && pos[i] === 1));
  };
  if (s.root) { box(cx - bw / 2, rows[0], s.root, true); if (lv2.length) line(cx, rows[0] + bh, cx, rows[1] - 0.25); }
  if (lv2.length) drawLevel(lv2, 1, true);
  if (lv3.length) { line(cx, rows[1] + bh, cx, rows[2] - 0.25); drawLevel(lv3, 2, false); }
  return sl;
}

async function closing(d, s, ctx) {
  const { T, TF, COL, IMG, LOGO_R, MARK_R, M, R } = d;
  const sl = d.darkSlide(ctx.section);
  sl.addImage({ path: IMG.markLight, x: 0.9, y: 1.3, h: 4.9, w: 4.9 * MARK_R, altText: "CoreBuild mark" });
  TF(sl, s.title || "شكرًا لكم", { x: 6.0, y: 1.5, w: R - 6.0, h: 1.0, bold: true, color: COL.paper }, { size: 48, min: 32, label: "closing title" });
  if (s.text) TF(sl, s.text, { x: 6.0, y: 2.65, w: R - 6.0, h: 1.4, color: COL.stone, lineSpacingMultiple: 1.2 }, { size: 17, min: 13, label: "closing text" });
  const icons = { phone: "FaPhone", email: "FaEnvelope", address: "FaLocationDot", website: "FaGlobe" };
  const contacts = s.contacts || {};
  const keys = Object.keys(icons).filter((k) => contacts[k]);
  for (let i = 0; i < keys.length; i++) {
    const y = 4.25 + i * 0.6;
    await d.iconCircle(sl, icons[keys[i]], R - 0.45, y, 0.45, { bg: COL.dark2 });
    T(sl, contacts[keys[i]], { x: 6.0, y, w: R - 6.6, h: 0.45, fontSize: 16, bold: keys[i] !== "address", color: COL.paper, valign: "middle", rtlMode: keys[i] === "address" });
  }
  sl.addImage({ path: IMG.logoLight, x: R - 0.7 * LOGO_R, y: 6.25, h: 0.7, w: 0.7 * LOGO_R, altText: "CoreBuild" });
  T(sl, "COREBUILD INVESTMENTS ESTABLISHMENT", { x: M, y: 6.85, w: 6, h: 0.3, fontSize: 9, bold: true, color: COL.warm, charSpacing: 1, align: "left", rtlMode: false });
  return sl;
}

const RENDERERS = { cover, agenda, divider, cards, hero, tiles, stats, process: processSlide, table, timeline, org, closing };
module.exports = { RENDERERS, fmtNum };
