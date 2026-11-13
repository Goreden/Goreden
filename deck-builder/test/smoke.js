// End-to-end check: renders the example spec, a spec with problems, and a generated BOQ workbook.
// Run with `npm test` (no LibreOffice needed: PDF export and picture fallbacks are skipped).
process.env.MAKE_PDF = "false";
process.env.OUTPUT_DIR = require("path").join(require("os").tmpdir(), "deck-builder-test");
const assert = require("assert");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const app = require("../src/server");
const { riyalsInWords } = require("../src/boq");

async function makeBOQ() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("جدول الخرسانات");
  ws.addRow(["جدول الكميات والأسعار التقديرية"]);
  ws.addRow(["م", "البنود والمواصفات", "الوحدة", "الكمية التقديرية", "سعر الوحدة (ريال)", "الإجمالي التقديري (ريال)"]);
  ws.addRow(["SEC", "1. تجهيزات الموقع"]);
  ws.addRow(["1-1", "تخطيط الموقع", "مقطوع", 1, 2000, 2000]);
  ws.addRow(["1-2", "حفر التربة", "م³", 100.5, 55, 5527.5]);
  ws.addRow(["SEC", "2. الخرسانات"]);
  ws.addRow(["2-1", "خرسانة مسلحة للبشة", "م³", 10, 800, 8000]);
  ws.addRow(["الإجمالي", null, null, null, null, 15527.5]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1. example spec builds with no warnings
    let r = await fetch(`${base}/decks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(require("../examples/technical_proposal.json")) });
    let j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.ok(j.slides >= 20, "example deck should have 20+ slides");
    assert.deepEqual(j.warnings, [], "example deck should have no warnings");
    const pptx = await (await fetch(j.pptx_url.replace(/^https?:\/\/[^/]+/, base))).arrayBuffer();
    const zip = await JSZip.loadAsync(Buffer.from(pptx));
    const theme = await zip.file("ppt/theme/theme1.xml").async("string");
    assert.ok(theme.includes('val="B8924A"'), "theme carries brand gold");
    assert.ok(!Object.values(zip.files).some((f) => f.dir), "no folder entries in zip");

    // 2. bad type is rejected with a helpful message
    r = await fetch(`${base}/decks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sections: [{ title: "x", slides: [{ type: "bullets" }] }] }) });
    j = await r.json();
    assert.equal(r.status, 400);
    assert.match(j.error, /unknown type "bullets"/);

    // 3. over-long card text is split onto a continuation slide, never cut
    const item = (k) => `البند ${k}: ` + "نص تفصيلي طويل يصف نطاق الأعمال والمواصفات المطلوبة ".repeat(3);
    r = await fetch(`${base}/decks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sections: [{ title: "x", slides: [{ type: "cards", title: "اختبار", cards: [{ heading: "بطاقة", icon: "FaBuilding", items: [1, 2, 3, 4, 5, 6, 7, 8].map(item) }] }] }] }) });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.ok(j.slides >= 2 && j.auto_fixes.length, "long card should be split: " + JSON.stringify(j.auto_fixes));
    const longDeck = j.deck_id;
    r = await fetch(`${base}/decks/${longDeck}?slides=all`);
    j = await r.json();
    const allItems = j.slides.flatMap((x) => x.cards.flatMap((c) => c.items));
    assert.equal(allItems.length, 8, "every item survives the split");

    // 3b. import the example deck back: unchanged CoreBuild decks import losslessly
    r = await fetch(`${base}/decks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(require("../examples/technical_proposal.json")) });
    const built = await r.json();
    const file = await (await fetch(built.pptx_url.replace(/^https?:\/\/[^/]+/, base))).arrayBuffer();
    let fdi = new FormData();
    fdi.append("file", new Blob([Buffer.from(file)]), "deck.pptx");
    r = await fetch(`${base}/import`, { method: "POST", body: fdi });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.mode, "lossless");
    assert.equal(j.deck_id, built.deck_id);

    // 3c. edit one slide: the rest stays, and a dropped number is reported
    r = await fetch(`${base}/decks/${built.deck_id}?slides=all`);
    const all = (await r.json()).slides;
    const statsIdx = all.findIndex((x) => x.type === "stats");
    const edited = JSON.parse(JSON.stringify(all[statsIdx]));
    const droppedValue = edited.stats.shift().value; // "1,255"
    r = await fetch(`${base}/decks/${built.deck_id}/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits: [{ op: "replace", slide: statsIdx + 1, with: edited }] }) });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.slides, built.slides);
    assert.ok(j.check.missing_numbers.some((x) => x.value === droppedValue.replace(/,/g, "")), "dropped number is reported: " + JSON.stringify(j.check.missing_numbers));
    assert.match(j.check_report, /مفقودة/);
    // and a converted (non-CoreBuild) deck keeps every word: strip the id so it goes through conversion
    const JSZip2 = require("jszip");
    const z = await JSZip2.loadAsync(Buffer.from(file));
    z.file("docProps/core.xml", (await z.file("docProps/core.xml").async("string")).replace(/<cp:keywords>[^<]*<\/cp:keywords>/, ""));
    fdi = new FormData();
    fdi.append("file", new Blob([await z.generateAsync({ type: "nodebuffer" })]), "foreign.pptx");
    r = await fetch(`${base}/import`, { method: "POST", body: fdi });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.mode, "converted");
    assert.deepEqual(j.check.missing_numbers, [], "conversion keeps every number");
    assert.ok(!j.check.slides.some((x) => x.missing.length), "conversion keeps every line: " + JSON.stringify(j.check.slides));

    // 4. financial deck from a BOQ workbook
    const fd = new FormData();
    fd.append("file", new Blob([await makeBOQ()]), "boq.xlsx");
    fd.append("options", JSON.stringify({ project: "مشروع اختبار", client: "جهة اختبار" }));
    r = await fetch(`${base}/financial`, { method: "POST", body: fd });
    j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.summary.net, 15527.5);
    assert.equal(j.summary.vat, 2329.13);
    assert.equal(j.summary.gross, 17856.63);
    assert.deepEqual(j.warnings, []);
    assert.ok(j.xlsx_url, "priced BOQ workbook is produced");
    const wbx = new ExcelJS.Workbook();
    await wbx.xlsx.load(Buffer.from(await (await fetch(j.xlsx_url.replace(/^https?:\/\/[^/]+/, base))).arrayBuffer()));
    assert.equal(wbx.worksheets[0].name, "الملخص");

    // 4b. BOQ problems are reported, not hidden
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet("بنود");
    ws2.addRow(["م", "البند", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي"]);
    ws2.addRow(["1", "حفر", "م³", 10, 50, 500]);
    ws2.addRow(["2", "ردم", "م³", 5, null, null]);
    const fd2 = new FormData();
    fd2.append("file", new Blob([Buffer.from(await wb2.xlsx.writeBuffer())]), "b.xlsx");
    r = await fetch(`${base}/boq/read`, { method: "POST", body: fd2 });
    j = await r.json();
    assert.equal(j.stats.total, 500);
    assert.ok(j.problems.some((p) => /NOT included/.test(p)), "missing rate is reported");

    // 5. amount in words
    assert.equal(riyalsInWords(8056653.33), "فقط ثمانية ملايين وستة وخمسون ألفًا وستمائة وثلاثة وخمسون ريال سعودي وثلاث وثلاثون هللة لا غير");
    console.log("all smoke tests passed");
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
