// Priced BOQ workbook: one sheet per BOQ part with live formulas (qty × rate, section and part
// subtotals) and a summary sheet with VAT and the grand total, so the numbers can be audited in Excel.
const ExcelJS = require("exceljs");

const GOLD = "FFB8924A", INK = "FF151515", TINT = "FFF3ECDF", LINE = "FFE3E1DC";
const MONEY = '#,##0.00', QTY = '#,##0.##';

async function exportBOQ(boq, { project = "", client = "", vat_rate = 15, prices_include_vat = false, labels = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CoreBuild";
  const border = { top: { style: "thin", color: { argb: LINE } }, bottom: { style: "thin", color: { argb: LINE } }, left: { style: "thin", color: { argb: LINE } }, right: { style: "thin", color: { argb: LINE } } };
  const partTotals = [];

  boq.parts.forEach((p, pi) => {
    const name = String(labels[pi] || p.sheet || `Part ${pi + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 8 }, { width: 64 }, { width: 10 }, { width: 13 }, { width: 15 }, { width: 18 }];
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = `${project ? project + " — " : ""}${p.title}`;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: INK } };
    ws.mergeCells("A2:F2");
    ws.getCell("A2").value = p.subtitle || (client ? `مقدم إلى: ${client}` : "");
    ws.getCell("A2").font = { size: 11, color: { argb: "FF5C5C5C" } };
    const hdr = ws.getRow(3);
    hdr.values = ["م", "البند والمواصفات", "الوحدة", "الكمية", "سعر الوحدة (ريال)", "الإجمالي (ريال)"];
    hdr.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = border; });
    hdr.height = 24;
    const sectionTotalCells = [];
    let r = 4;
    p.sections.forEach((s, si) => {
      const sr = ws.getRow(r);
      sr.values = [String(si + 1).padStart(2, "0"), s.title];
      ws.mergeCells(`B${r}:E${r}`);
      sr.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true, color: { argb: INK } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }; c.border = border; });
      const sumRow = r;
      r++;
      const first = r;
      for (const it of s.items) {
        const row = ws.getRow(r);
        row.values = [it.no, it.desc, it.unit, it.qty, it.rate];
        row.getCell(6).value = { formula: `D${r}*E${r}`, result: Math.round(it.qty * it.rate * 100) / 100 };
        row.getCell(2).alignment = { wrapText: true, vertical: "top", horizontal: "right" };
        [1, 3].forEach((c) => (row.getCell(c).alignment = { horizontal: "center", vertical: "top" }));
        row.getCell(4).numFmt = QTY; row.getCell(5).numFmt = MONEY; row.getCell(6).numFmt = MONEY;
        row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
        r++;
      }
      ws.getCell(`F${sumRow}`).value = { formula: `SUM(F${first}:F${r - 1})`, result: s.total };
      ws.getCell(`F${sumRow}`).numFmt = MONEY;
      ws.getCell(`F${sumRow}`).font = { bold: true, color: { argb: "FF8A6A2C" } };
      sectionTotalCells.push(`F${sumRow}`);
    });
    const tr = ws.getRow(r);
    tr.values = ["", `إجمالي ${labels[pi] || p.title}`];
    ws.mergeCells(`B${r}:E${r}`);
    tr.getCell(6).value = { formula: sectionTotalCells.join("+") || "0", result: p.total };
    tr.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.numFmt = MONEY; c.border = border; });
    partTotals.push({ sheet: name, cell: `'${name}'!F${r}`, label: labels[pi] || p.title, total: p.total });
  });

  const sum = wb.addWorksheet("الملخص", { views: [{ rightToLeft: true }] });
  sum.columns = [{ width: 6 }, { width: 52 }, { width: 22 }];
  sum.mergeCells("A1:C1");
  sum.getCell("A1").value = `ملخص العرض المالي${project ? " — " + project : ""}`;
  sum.getCell("A1").font = { bold: true, size: 14 };
  sum.getRow(3).values = ["م", "البيان", "المبلغ (ريال سعودي)"];
  sum.getRow(3).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.border = border; c.alignment = { horizontal: "center" }; });
  let r = 4;
  partTotals.forEach((pt, i) => {
    sum.getRow(r).values = [i + 1, `إجمالي ${pt.label}`];
    sum.getCell(`C${r}`).value = { formula: pt.cell, result: pt.total };
    r++;
  });
  const sumCells = `SUM(C4:C${r - 1})`;
  const rate = Number(vat_rate) / 100;
  const rows = prices_include_vat
    ? [["الإجمالي شامل الضريبة (كما في الجدول)", sumCells], ["الإجمالي قبل ضريبة القيمة المضافة", `ROUND(${sumCells}/(1+${rate}),2)`], [`ضريبة القيمة المضافة (${vat_rate}%)`, `ROUND(${sumCells}-${sumCells}/(1+${rate}),2)`], ["الإجمالي النهائي شامل ضريبة القيمة المضافة", sumCells]]
    : [["الإجمالي قبل ضريبة القيمة المضافة", sumCells], [`ضريبة القيمة المضافة (${vat_rate}%)`, `ROUND(${sumCells}*${rate},2)`], ["الإجمالي النهائي شامل ضريبة القيمة المضافة", `ROUND(${sumCells}*(1+${rate}),2)`]];
  rows.forEach(([label, f], i) => {
    const row = sum.getRow(r);
    row.values = ["", label];
    sum.getCell(`C${r}`).value = { formula: f };
    const last = i === rows.length - 1;
    row.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true, color: { argb: last ? "FFFFFFFF" : INK } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: last ? INK : TINT } }; });
    r++;
  });
  for (let k = 4; k < r; k++) { sum.getCell(`C${k}`).numFmt = MONEY; ["A", "B", "C"].forEach((c) => (sum.getCell(`${c}${k}`).border = border)); }
  if (boq.problems.length) {
    r += 1;
    sum.getCell(`B${r}`).value = "ملاحظات التحقق من الجدول:";
    sum.getCell(`B${r}`).font = { bold: true, color: { argb: "FFB00020" } };
    for (const p of boq.problems) { r++; sum.getCell(`B${r}`).value = p; sum.getCell(`B${r}`).alignment = { wrapText: true }; }
  }
  // summary first
  sum.orderNo = 0;
  wb.worksheets.forEach((w, i) => { if (w !== sum) w.orderNo = i + 1; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { exportBOQ };
