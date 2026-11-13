// Financial proposal built straight from a BOQ workbook. No model involved: every number
// comes from the spreadsheet, so totals are always exact.
const { createDeck, finalizeTheme } = require("./kit");
const { RENDERERS } = require("./slides");
const { riyalsInWords } = require("./boq");

const fmt = (n, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtQ = (n) => (Number.isInteger(n) ? fmt(n, 0) : fmt(n, 2));
const r2 = (n) => Math.round(n * 100) / 100;
const shortTitle = (t) => t.replace(/\s*\([^)]*[A-Za-z][^)]*\)\s*$/, "").trim();
const enTitle = (t) => { const m = t.match(/\(([^)]*[A-Za-z][^)]*)\)\s*$/); return m ? m[1] : ""; };
const PART_ICONS = ["FaCubes", "FaPaintRoller", "FaBolt", "FaGears", "FaRoad", "FaTree"];
const ORD = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];

async function sectionSummary(d, part, partIdx, grand, ctx) {
  const { T, COL, HEX, M, R } = d;
  const sl = d.contentSlide(ctx.section, ctx.kicker, `ملخص أسعار ${part.label}`);
  const secs = part.sections;
  d.darkPanel(sl, M, 1.65, 4.3, 5.0);
  await d.iconCircle(sl, PART_ICONS[partIdx % PART_ICONS.length], M + 4.3 - 0.95, 2.0, 0.6, { bg: COL.dark2 });
  T(sl, "إجمالي القسم", { x: M + 0.35, y: 2.95, w: 3.6, h: 0.4, fontSize: 14, bold: true, color: COL.gold });
  T(sl, fmt(part.total), { x: M + 0.35, y: 3.4, w: 3.6, h: 0.8, fontSize: part.total >= 1e8 ? 30 : 36, bold: true, color: COL.paper, rtlMode: false, align: "right" });
  T(sl, `ريال سعودي — ${ctx.vatIncluded ? "شامل" : "قبل"} ضريبة القيمة المضافة`, { x: M + 0.35, y: 4.2, w: 3.6, h: 0.4, fontSize: 13, color: COL.stone });
  const nItems = secs.reduce((a, x) => a + x.items.length, 0);
  [["من إجمالي المشروع", fmt((part.total / grand) * 100, 1) + "%"], ["عدد الأقسام / البنود", `${secs.length} / ${nItems}`]].forEach((l, i) => {
    const y = 5.1 + i * 0.6;
    T(sl, l[0], { x: M + 1.7, y, w: 2.25, h: 0.45, fontSize: 13, color: COL.stone, valign: "middle" });
    T(sl, l[1], { x: M + 0.35, y, w: 1.5, h: 0.45, fontSize: 18, bold: true, color: COL.gold, valign: "middle", align: "left", rtlMode: false });
  });
  const tx = M + 4.65, tw = R - tx;
  const hd = (t, al = "right") => ({ text: t, options: { bold: true, color: COL.paper, fill: { color: COL.ink }, fontSize: 12, align: al, rtlMode: true, valign: "middle" } });
  const data = [[hd("النسبة", "center"), hd("الإجمالي (ريال)", "center"), hd("عدد البنود", "center"), hd("القسم"), hd("م", "center")]];
  const fs = secs.length > 12 ? 10.5 : 12;
  secs.forEach((x, i) => {
    const fill = { color: i % 2 ? HEX.mist : HEX.paper };
    const c = (t, o = {}) => ({ text: t, options: Object.assign({ fill, fontSize: fs, color: COL.ink, align: "center", valign: "middle" }, o) });
    data.push([
      c(fmt((x.total / part.total) * 100, 1) + "%", { color: COL.goldDeep, bold: true }),
      c(fmt(x.total), { bold: true }),
      c(String(x.items.length), { color: COL.grey }),
      c(shortTitle(x.title), { align: "right", rtlMode: true }),
      c(String(i + 1).padStart(2, "0"), { color: COL.gold, bold: true }),
    ]);
  });
  const tot = (t, o = {}) => ({ text: t, options: Object.assign({ fill: { color: HEX.goldTint }, fontSize: 13, bold: true, color: COL.ink, align: "center", valign: "middle" }, o) });
  data.push([tot("100%"), tot(fmt(part.total)), tot(String(nItems)), tot("الإجمالي", { align: "right", rtlMode: true, colspan: 2 })]);
  const rh = Math.min(0.5, 4.5 / (data.length - 1));
  if (secs.length > 16) d.warn(`${secs.length} sections is a lot for one summary table`);
  sl.addTable(data, { x: tx, y: 1.65, w: tw, colW: [tw * 0.11, tw * 0.22, tw * 0.11, tw * 0.48, tw * 0.08], rowH: [0.5, ...Array(data.length - 1).fill(rh)], border: { type: "solid", color: HEX.line, pt: 0.75 }, margin: [0, 0.1, 0, 0.1] });
}

function detailSlides(d, part, ctx) {
  const { COL, HEX, M, R } = d;
  const tw = R - M;
  const colW = [1.75, 1.45, 1.25, 0.85, tw - 1.75 - 1.45 - 1.25 - 0.85 - 0.65, 0.65]; // left→right
  const perLine = Math.floor(colW[4] * 17); // calibrated for 12.5pt Arial Arabic
  const lineH = 0.21, pad = 0.14, hdrH = 0.45, secH = 0.4, maxH = 5.05;
  const pages = []; let cur = [], h = hdrH;
  const pushPage = () => { if (cur.length) pages.push(cur); cur = []; h = hdrH; };
  part.sections.forEach((sc, si) => {
    const ih = sc.items.map((it) => Math.max(1, Math.ceil(it.desc.length / perLine)) * lineH + pad);
    if (h + secH + ih[0] > maxH) pushPage();
    cur.push({ type: "sec", sc, si }); h += secH;
    sc.items.forEach((it, ii) => {
      if (h + ih[ii] > maxH) { pushPage(); cur.push({ type: "sec", sc, si, cont: true }); h += secH; }
      cur.push({ type: "item", it, rh: ih[ii] }); h += ih[ii];
    });
  });
  pushPage();
  const hd = (t, al = "center") => ({ text: t, options: { bold: true, color: COL.paper, fill: { color: COL.ink }, fontSize: 12, align: al, rtlMode: true, valign: "middle" } });
  pages.forEach((pg, pi) => {
    const sl = d.contentSlide(ctx.section, ctx.kicker, `جدول الكميات — ${part.label}` + (pages.length > 1 ? `  (${pi + 1}/${pages.length})` : ""));
    const data = [[hd("الإجمالي (ريال)"), hd("سعر الوحدة"), hd("الكمية"), hd("الوحدة"), hd("البند والمواصفات", "right"), hd("م")]];
    const rowH = [hdrH];
    let zebra = 0;
    pg.forEach((b) => {
      if (b.type === "sec") {
        const f = { color: HEX.goldTint };
        const en = enTitle(b.sc.title);
        data.push([
          { text: b.cont ? "" : fmt(b.sc.total), options: { fill: f, bold: true, fontSize: 12, color: COL.goldDeep, align: "center", valign: "middle" } },
          { text: `${String(b.si + 1).padStart(2, "0")}. ${shortTitle(b.sc.title)}${en ? "  —  " + en : ""}${b.cont ? " (تابع)" : ""}`, options: { fill: f, bold: true, fontSize: 12.5, color: COL.ink, align: "right", rtlMode: true, valign: "middle", colspan: 5 } },
        ]);
        rowH.push(secH); zebra = 0;
      } else {
        const it = b.it, f = { color: zebra++ % 2 ? HEX.mist : HEX.paper };
        const c = (t, o = {}) => ({ text: t, options: Object.assign({ fill: f, fontSize: 12.5, color: COL.ink, align: "center", valign: "middle" }, o) });
        data.push([
          c(fmt(it.amount), { bold: true }), c(fmtQ(it.rate), { color: COL.grey }), c(fmtQ(it.qty), { color: COL.grey }),
          c(it.unit, { color: COL.grey, rtlMode: true }), c(it.desc, { align: "right", rtlMode: true }), c(it.no, { color: COL.gold, bold: true }),
        ]);
        rowH.push(b.rh);
      }
    });
    sl.addTable(data, { x: M, y: 1.55, w: tw, colW, rowH, border: { type: "solid", color: HEX.line, pt: 0.75 }, margin: [0.04, 0.1, 0.04, 0.1] });
  });
}

async function buildFinancial(boq, opts = {}) {
  const parts = boq.parts.map((p, i) => Object.assign({}, p, { label: (opts.part_labels && opts.part_labels[i]) || guessLabel(p, i) }));
  if (!parts.length) throw new Error("No priced items were found in the workbook.");
  const vatRate = opts.vat_rate == null ? 15 : Number(opts.vat_rate);
  const vatIncluded = !!opts.prices_include_vat;
  const sum = r2(parts.reduce((a, p) => a + p.total, 0));
  const net = vatIncluded ? r2(sum / (1 + vatRate / 100)) : sum;
  const vat = vatIncluded ? r2(sum - net) : r2(net * vatRate / 100);
  const gross = vatIncluded ? sum : r2(net + vat);
  const project = opts.project || "مشروع إنشاء عمارة سكنية";
  const d = createDeck({ title: `العرض المالي — ${project}`, footer: opts.footer || project, tagline: "COREBUILD  |  FINANCIAL PROPOSAL" });
  const S = (title) => { d.pres.addSection({ title }); return title; };

  // cover + contents
  let section = S("المقدمة");
  await RENDERERS.cover(d, { kicker: "FINANCIAL PROPOSAL", title: "العرض المالي", subtitle: opts.subtitle || project, meta: opts.meta || shortMeta(parts[0].subtitle), submitted_to: opts.client }, { section });
  const agendaItems = [{ number: "00", title: "ملخص العرض المالي", subtitle: "القيمة الإجمالية وتوزيعها على أقسام الأعمال", icon: "FaChartPie" }]
    .concat(parts.map((p, i) => ({ number: ORD[i], title: p.label, subtitle: `${p.sections.length} أقسام — ${p.sections.reduce((a, s) => a + s.items.length, 0)} بندًا`, icon: PART_ICONS[i % PART_ICONS.length] })))
    .concat([{ number: ORD[parts.length], title: "الملخص النهائي وأسس التسعير", subtitle: "الإجمالي شامل ضريبة القيمة المضافة وأسس التسعير", icon: "FaFileInvoiceDollar" }]);
  await RENDERERS.agenda(d, { title: "محتويات العرض", kicker: "جدول الكميات والأسعار", items: agendaItems.slice(0, 6) }, { section });

  // executive summary
  {
    const { T, COL, M, R } = d;
    const sl = d.contentSlide(section, "ملخص العرض المالي", "القيمة الإجمالية للعرض المالي");
    d.darkPanel(sl, M, 1.65, 5.2, 5.0);
    await d.iconCircle(sl, "FaFileInvoiceDollar", M + 5.2 - 0.95, 2.0, 0.6, { bg: COL.dark2 });
    T(sl, "الإجمالي شامل ضريبة القيمة المضافة", { x: M + 0.35, y: 2.95, w: 4.5, h: 0.4, fontSize: 14, bold: true, color: COL.gold });
    T(sl, fmt(gross), { x: M + 0.35, y: 3.4, w: 4.5, h: 0.9, fontSize: gross >= 1e8 ? 36 : 44, bold: true, color: COL.paper, rtlMode: false, align: "right" });
    T(sl, "ريال سعودي", { x: M + 0.35, y: 4.3, w: 4.5, h: 0.4, fontSize: 16, color: COL.stone });
    [["الإجمالي قبل الضريبة", net], [`ضريبة القيمة المضافة ${vatRate}%`, vat]].forEach((l, i) => {
      const y = 5.05 + i * 0.6;
      T(sl, l[0], { x: M + 2.4, y, w: 2.45, h: 0.45, fontSize: 13, color: COL.stone, valign: "middle" });
      T(sl, fmt(l[1]), { x: M + 0.35, y, w: 2.1, h: 0.45, fontSize: 16, bold: true, color: COL.paper, valign: "middle", align: "left", rtlMode: false });
    });
    const x0 = M + 5.55, w = R - x0, shown = parts.slice(0, 3);
    const gap = 0.3, ch = (5.0 - gap * (shown.length - 1)) / shown.length;
    const barCols = [COL.ink, COL.gold, COL.goldLight];
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i], y = 1.65 + i * (ch + gap), pct = p.total / sum;
      d.panel(sl, x0, y, w, ch);
      await d.iconCircle(sl, PART_ICONS[i], R - 0.92, y + 0.25, 0.6);
      d.TF(sl, p.label, { x: x0 + 2.0, y: y + 0.25, w: w - 3.1, h: 0.6, bold: true, valign: "middle" }, { size: 18, min: 13, label: "part label" });
      T(sl, fmt(pct * 100, 1) + "%", { x: x0 + 0.3, y: y + 0.25, w: 1.7, h: 0.6, fontSize: 26, bold: true, color: COL.gold, valign: "middle", align: "left", rtlMode: false });
      T(sl, [{ text: fmt(p.total), options: { fontSize: 26, bold: true } }, { text: "  ريال", options: { fontSize: 11, color: COL.grey } }], { x: x0 + 0.3, y: y + ch - 1.15, w: w - 0.6, h: 0.55, valign: "middle" });
      const bw = w - 0.6;
      sl.addShape(d.pres.shapes.ROUNDED_RECTANGLE, { x: x0 + 0.3, y: y + ch - 0.45, w: bw, h: 0.18, rectRadius: 0.09, fill: { color: COL.mist }, line: { type: "none" } });
      sl.addShape(d.pres.shapes.ROUNDED_RECTANGLE, { x: x0 + 0.3 + bw * (1 - pct), y: y + ch - 0.45, w: Math.max(0.05, bw * pct), h: 0.18, rectRadius: 0.09, fill: { color: barCols[i] }, line: { type: "none" } });
    }
    if (parts.length > 3) d.warn("only the first 3 parts are shown on the executive summary");
  }

  // one section per BOQ part
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    section = S(`${ORD[i]} ${p.label}`);
    await RENDERERS.divider(d, { number: ORD[i], title: p.label, subtitle: `${p.sections.length} أقسام — ${p.sections.reduce((a, s) => a + s.items.length, 0)} بندًا — ${fmt(p.total)} ريال` }, { section });
    const ctx = { section, kicker: `${ORD[i]} / ${p.label}`, vatIncluded };
    await sectionSummary(d, p, i, sum, ctx);
    detailSlides(d, p, ctx);
  }

  // final summary
  section = S("الملخص النهائي");
  const nf = ORD[parts.length];
  await RENDERERS.divider(d, { number: nf, title: "الملخص النهائي", subtitle: "القيمة الإجمالية للعرض شاملة ضريبة القيمة المضافة، وأسس التسعير" }, { section });
  {
    const { T, COL, HEX, M, R } = d;
    const sl = d.contentSlide(section, `${nf} / الملخص النهائي`, "ملخص العرض المالي");
    const tw = R - M;
    const hd = (t, al = "right") => ({ text: t, options: { bold: true, color: COL.paper, fill: { color: COL.ink }, fontSize: 14, align: al, rtlMode: true, valign: "middle" } });
    const c = (t, o = {}) => ({ text: t, options: Object.assign({ fontSize: 15, color: COL.ink, align: "right", rtlMode: true, valign: "middle", fill: { color: HEX.paper } }, o) });
    const n = (v, o = {}) => c(fmt(v), Object.assign({ align: "center", rtlMode: false, bold: true }, o));
    const data = [[hd("المبلغ (ريال سعودي)", "center"), hd("البيان"), hd("م", "center")]];
    parts.forEach((p, i) => {
      const f = { fill: { color: i % 2 ? HEX.mist : HEX.paper } };
      data.push([n(p.total, f), c(`إجمالي ${p.label}`, f), c(String(i + 1), Object.assign({ align: "center", color: COL.gold, bold: true }, f))]);
    });
    if (vatIncluded) {
      data.push([n(net, { fill: { color: HEX.goldTint } }), c("الإجمالي قبل ضريبة القيمة المضافة", { bold: true, colspan: 2, fill: { color: HEX.goldTint } })]);
    } else {
      data.push([n(net, { fill: { color: HEX.goldTint } }), c("الإجمالي قبل ضريبة القيمة المضافة", { bold: true, colspan: 2, fill: { color: HEX.goldTint } })]);
    }
    data.push([n(vat), c(`ضريبة القيمة المضافة (${vatRate}%)`, { colspan: 2 })]);
    data.push([n(gross, { fill: { color: COL.ink }, color: COL.gold, fontSize: 20 }), c("الإجمالي النهائي شامل ضريبة القيمة المضافة", { bold: true, colspan: 2, fill: { color: COL.ink }, color: COL.paper, fontSize: 16 })]);
    const rh = Math.min(0.62, 3.4 / (data.length - 1));
    sl.addTable(data, { x: M, y: 1.65, w: tw, colW: [3.6, tw - 4.5, 0.9], rowH: [0.55, ...Array(data.length - 2).fill(rh), 0.8], border: { type: "solid", color: HEX.line, pt: 0.75 }, margin: [0, 0.2, 0, 0.2] });
    d.panel(sl, M, 5.75, tw, 0.9, { fill: { color: HEX.goldTint }, line: { type: "none" }, shadow: undefined });
    d.TF(sl, [{ text: "المبلغ كتابةً: ", options: { bold: true, color: COL.goldDeep } }, { text: riyalsInWords(gross), options: { color: COL.ink } }], { x: M + 0.3, y: 5.75, w: tw - 0.6, h: 0.9, valign: "middle" }, { size: 15, min: 11, label: "amount in words" });
  }
  const basis = opts.basis || [
    { heading: "العملة", text: "جميع الأسعار بالريال السعودي.", icon: "FaCoins" },
    { heading: "الكميات", text: "الكميات الواردة تقديرية وفق جدول الكميات والمواصفات المرفق.", icon: "FaRulerCombined" },
    { heading: "الضريبة", text: vatIncluded ? `أسعار البنود شاملة ضريبة القيمة المضافة ${vatRate}%.` : `ضريبة القيمة المضافة ${vatRate}% محتسبة بشكل منفصل عن أسعار البنود.`, icon: "FaReceipt" },
    { heading: "المرجعية الفنية", text: "طبقًا للكود السعودي المحدث (SBC) والمواصفات الفنية في العرض الفني.", icon: "FaBookOpen" },
  ].concat(opts.extra_basis || []);
  await RENDERERS.tiles(d, { kicker: `${nf} / الملخص النهائي`, title: "أسس التسعير", tiles: basis.slice(0, 6) }, { section });

  section = S("الختام");
  await RENDERERS.closing(d, { title: "شكرًا لكم", text: opts.closing_text || `نتطلع إلى شراكة ناجحة في تنفيذ ${project}، وفق أعلى معايير الجودة والسلامة.`, contacts: opts.contacts || {} }, { section });

  const buf = await finalizeTheme(await d.pres.write({ outputType: "nodebuffer" }));
  return {
    buffer: buf,
    warnings: d.warnings.concat(boq.problems),
    summary: { parts: parts.map((p) => ({ label: p.label, total: p.total, sections: p.sections.length, items: p.sections.reduce((a, s) => a + s.items.length, 0) })), net, vat_rate: vatRate, vat, gross, prices_include_vat: vatIncluded, amount_in_words: riyalsInWords(gross), slides: d.slideNo },
  };
}

function shortMeta(t) {
  if (!t) return "";
  const first = t.split(/[|:]/).map((x) => x.trim()).filter(Boolean);
  return first.slice(0, 2).join(" — ").slice(0, 110);
}

function guessLabel(p, i) {
  const t = `${p.sheet} ${p.title}`;
  if (/تشطيب/.test(t)) return "أعمال التشطيبات";
  if (/خرسان|إنشائ|انشائ|هيكل/.test(t)) return "الأعمال الإنشائية والخرسانية";
  if (/كهرب|ميكانيك|MEP/i.test(t)) return "الأعمال الكهروميكانيكية";
  if (/موقع|طرق|رصف/.test(t)) return "أعمال الموقع العام";
  return p.sheet || `القسم ${i + 1}`;
}

module.exports = { buildFinancial };
