// Bill-of-quantities reader: turns an Excel BOQ (one or more sheets) into sections and items.
// Expected per sheet: title row(s), a header row with الوحدة / الكمية / سعر / الإجمالي, then
// section rows (first column "SEC", or a description with no numbers) and item rows.
const ExcelJS = require("exceljs");

function cellValue(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return v.result ?? null;
    if (v.text) return v.text;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.error) return null;
  }
  return v;
}
const isNum = (v) => typeof v === "number" && isFinite(v);
const toNum = (v) => (isNum(v) ? v : typeof v === "string" && /^[\d.,\s]+$/.test(v.trim()) ? Number(v.replace(/[,\s]/g, "")) : null);
const clean = (s) => String(s).replace(/\s+/g, " ").trim();

function findColumns(header) {
  const col = { no: null, desc: null, unit: null, qty: null, rate: null, amount: null };
  header.forEach((h, i) => {
    const t = clean(h || "");
    if (!t) return;
    if (col.unit == null && /الوحدة|unit/i.test(t)) col.unit = i;
    else if (col.qty == null && /الكمية|qty|quantity/i.test(t)) col.qty = i;
    else if (col.rate == null && /سعر|rate|unit price/i.test(t)) col.rate = i;
    else if (col.amount == null && /الإجمالي|الاجمالي|المبلغ|total|amount/i.test(t)) col.amount = i;
    else if (col.desc == null && /البن|الوصف|description|item/i.test(t)) col.desc = i;
    else if (col.no == null && /^(م|رقم|no\.?|#)$/i.test(t)) col.no = i;
  });
  return col;
}

async function readBOQ(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [], problems = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= Math.max(ws.columnCount, 6); c++) vals.push(cellValue(row.getCell(c).value));
      if (vals.some((v) => v != null && String(v).trim() !== "")) rows.push(vals);
    });
    const hi = rows.findIndex((r) => r.some((v) => /الوحدة|unit/i.test(String(v ?? ""))) && r.some((v) => /الكمية|qty|quantity/i.test(String(v ?? ""))));
    if (hi < 0) { problems.push(`sheet "${ws.name}": no header row with الوحدة and الكمية — skipped`); return; }
    const col = findColumns(rows[hi]);
    if (col.desc == null) col.desc = col.no == null ? 0 : col.no + 1;
    if (col.no == null) col.no = col.desc > 0 ? 0 : null;
    const titles = rows.slice(0, hi).map((r) => r.filter((v) => v != null).map(clean).join(" ")).filter(Boolean);
    const sections = [];
    let declaredTotal = null;
    for (const r of rows.slice(hi + 1)) {
      const no = r[col.no] != null ? clean(r[col.no]) : "";
      const desc = r[col.desc] != null ? clean(r[col.desc]) : "";
      const qty = toNum(r[col.qty]), rate = toNum(r[col.rate]), amount = toNum(r[col.amount]);
      if (/^sec$/i.test(no) || (desc && qty == null && rate == null && amount == null)) {
        sections.push({ title: (desc || no).replace(/^\d+\s*[.\-)]\s*/, ""), items: [] });
        continue;
      }
      if (qty != null && rate != null) {
        if (!sections.length) sections.push({ title: ws.name, items: [] });
        const amt = amount != null ? amount : qty * rate;
        if (Math.abs(qty * rate - amt) > 0.05) problems.push(`sheet "${ws.name}" item ${no}: quantity × rate (${(qty * rate).toFixed(2)}) ≠ total (${amt.toFixed(2)})`);
        sections[sections.length - 1].items.push({ no, desc, unit: r[col.unit] != null ? clean(r[col.unit]) : "", qty, rate, amount: Math.round(amt * 100) / 100 });
        continue;
      }
      if (amount != null) declaredTotal = amount; // a totals row
    }
    const used = sections.filter((s) => s.items.length);
    used.forEach((s) => { s.total = Math.round(s.items.reduce((a, i) => a + i.amount, 0) * 100) / 100; });
    const total = Math.round(used.reduce((a, s) => a + s.total, 0) * 100) / 100;
    if (declaredTotal != null && Math.abs(declaredTotal - total) > 0.05) problems.push(`sheet "${ws.name}": sheet total ${declaredTotal.toFixed(2)} ≠ sum of items ${total.toFixed(2)}`);
    if (used.length) parts.push({ sheet: ws.name, title: titles[0] || ws.name, subtitle: titles[1] || "", sections: used, total });
  });
  return { parts, problems };
}

// ---------- Saudi riyal amount in Arabic words ----------
const ONES_M = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const ONES_F = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع"];
const TEENS_M = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TEENS_F = ["عشر", "إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function below1000(n, fem = false) {
  const ones = fem ? ONES_F : ONES_M, teens = fem ? TEENS_F : TEENS_M;
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 10) parts.push(ones[r]);
    else if (r < 20) parts.push(teens[r - 10]);
    else parts.push((r % 10 ? ones[r % 10] + " و" : "") + TENS[Math.floor(r / 10)]);
  }
  return parts.join(" و");
}
function scaleWords(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  const r = n % 100;
  if (n >= 3 && n <= 10) return below1000(n) + " " + few;
  if (r >= 11) return below1000(n) + " " + many;
  return below1000(n) + " " + one; // e.g. مائة ألف، مائة وثلاثة آلاف handled above via r<11
}
function integerWords(n) {
  if (n === 0) return "صفر";
  const scales = [
    [1e9, ["مليار", "ملياران", "مليارات", "مليارًا"]],
    [1e6, ["مليون", "مليونان", "ملايين", "مليونًا"]],
    [1e3, ["ألف", "ألفان", "آلاف", "ألفًا"]],
  ];
  const parts = [];
  for (const [v, names] of scales) {
    const q = Math.floor(n / v);
    if (q) {
      const r = q % 100;
      parts.push(q > 100 && r >= 3 && r <= 10 ? below1000(q) + " " + names[2] : scaleWords(q, names));
    }
    n %= v;
  }
  if (n) parts.push(below1000(n));
  return parts.join(" و");
}
function riyalsInWords(amount) {
  const halalas = Math.round(amount * 100);
  const sar = Math.floor(halalas / 100), h = halalas % 100;
  let s = `فقط ${integerWords(sar)} ريال سعودي`;
  if (h) s += ` و${below1000(h, true)} هللة`;
  return s + " لا غير";
}

module.exports = { readBOQ, riyalsInWords, integerWords };
