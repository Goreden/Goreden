// CoreBuild deck kit: brand, slide layouts and drawing helpers shared by every slide type.
// All text is right-to-left Arabic by default (rtlMode + right alignment).
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa6");

const ASSETS = process.env.ASSETS_DIR || path.join(__dirname, "../assets");
const IMG = {
  logoLight: path.join(ASSETS, "logo-light.png"), // wordmark for dark backgrounds
  logoDark: path.join(ASSETS, "logo-dark.png"), // wordmark for light backgrounds
  markLight: path.join(ASSETS, "mark-light.png"),
  markDark: path.join(ASSETS, "mark-dark.png"),
};
const LOGO_R = 900 / 359; // logo width / height
const MARK_R = 900 / 1166;

const HEX = {
  ink: "151515", dark2: "2B2B2B", gold: "B8924A", goldDeep: "8A6A2C", goldLight: "D9C49C", goldTint: "F3ECDF",
  paper: "FFFFFF", mist: "F4F4F2", grey: "5C5C5C", stone: "CFCAC0", warm: "6E6A62", line: "E3E1DC",
};
const THEME_COLORS = {
  dk1: HEX.ink, lt1: HEX.paper, dk2: HEX.dark2, lt2: HEX.mist,
  accent1: HEX.gold, accent2: HEX.goldDeep, accent3: HEX.goldLight, accent4: HEX.grey,
  accent5: HEX.stone, accent6: HEX.warm, hlink: HEX.goldDeep, folHlink: HEX.grey,
};
const FONT = "Arial"; // ships with Office and has full Arabic coverage

const W = 13.333, H = 7.5, M = 0.6, R = W - M;
const CONTENT_Y = 1.65, CONTENT_H = 5.0; // body area on content slides

// ---------- text fitting (the model cannot see slides, so we measure instead) ----------
// Conservative width estimate for Arial (Arabic + Latin mix): ~0.42 em per character.
function estLines(text, widthIn, sizePt) {
  const perLine = Math.max(8, Math.floor((widthIn * 72) / (0.42 * sizePt)));
  return String(text).split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}
function estHeight(paragraphs, widthIn, sizePt, { lineMult = 1.15, paraGapPt = 0 } = {}) {
  const lines = paragraphs.reduce((n, p) => n + estLines(p, widthIn, sizePt), 0);
  return (lines * sizePt * lineMult + Math.max(0, paragraphs.length - 1) * paraGapPt) / 72;
}

function createDeck(meta = {}) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.rtlMode = true;
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pres.title = meta.title || "CoreBuild";
  pres.author = meta.author || "CoreBuild";
  pres.company = "CoreBuild Investments Establishment";
  const C = pres.SchemeColor;
  const COL = {
    ink: C.text1, paper: C.background1, mist: C.background2, dark2: C.text2,
    gold: C.accent1, goldDeep: C.accent2, goldLight: C.accent3, grey: C.accent4, stone: C.accent5, warm: C.accent6,
  };
  const footer = meta.footer || "";
  const tag = (meta.tagline || "COREBUILD  |  PROPOSAL").toUpperCase();
  const warnings = [];
  let slideNo = 0, boxIdx = 0;
  const boxes = [], tables = [];
  const fit = meta.fit || {}; // measured shrink factors from an earlier pass, keyed "slide:box"
  const mediaData = meta.mediaData || {};
  const nextKey = () => `${slideNo}:${boxIdx}`;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Paragraphs of a text (string or runs) as measured by measure.js.
  function recordBox(text, opts, label) {
    const key = nextKey(); boxIdx++;
    if (!(opts.w > 0 && opts.h > 0)) return key;
    const paras = [];
    const base = { size: opts.fontSize || 18, bold: !!opts.bold };
    if (Array.isArray(text)) {
      let cur = null;
      for (const r of text) {
        const o = r.options || {};
        if (!cur) cur = { runs: [], size: o.fontSize || base.size, gapPt: 0, lineMult: o.lineSpacingMultiple };
        cur.runs.push({ t: String(r.text ?? ""), b: o.bold ?? base.bold, sz: o.fontSize || base.size });
        cur.size = Math.max(cur.size, o.fontSize || base.size);
        if (o.paraSpaceAfter) cur.gapPt = o.paraSpaceAfter;
        if (o.lineSpacingMultiple) cur.lineMult = o.lineSpacingMultiple;
        if (o.breakLine) { paras.push(cur); cur = null; }
      }
      if (cur) paras.push(cur);
    } else {
      for (const line of String(text ?? "").split("\n")) paras.push({ runs: [{ t: line, b: base.bold }], size: base.size, gapPt: 0 });
    }
    const out = paras.filter((p) => p.runs.some((r) => r.t.trim())).map((p) => {
      const allBold = p.runs.every((r) => r.b);
      const span = (r) => { let t = esc(r.t); if (r.b && !allBold) t = `<b>${t}</b>`; if (r.sz && r.sz !== p.size) t = `<span size="${Math.round(r.sz * 1024)}">${t}</span>`; return t; };
      return { markup: p.runs.map(span).join(""), plain: p.runs.map((r) => r.t).join(""), size: p.size, bold: allBold, gapPt: p.gapPt };
    });
    const lm = opts.lineSpacingMultiple || (paras[0] && paras[0].lineMult) || 1;
    if (out.length) boxes.push({ key, slide: slideNo, label: label || opts._label || "text", w: opts.w, h: opts.h, lineMult: lm, paras: out });
    return key;
  }

  pres.defineSlideMaster({
    title: "CB_CONTENT",
    background: { color: COL.mist },
    objects: [
      { image: { path: IMG.logoDark, x: M, y: 0.42, h: 0.5, w: 0.5 * LOGO_R, altText: "CoreBuild" } },
      { text: { text: footer, options: { x: 5.5, y: 6.98, w: R - 5.5, h: 0.3, fontSize: 9, color: COL.grey, align: "right", rtlMode: true, margin: 0 } } },
      { text: { text: tag, options: { x: 1.15, y: 6.98, w: 4, h: 0.3, fontSize: 8, color: COL.stone, bold: true, charSpacing: 1, align: "left", margin: 0 } } },
      { placeholder: { options: { name: "title", type: "title", x: 3.2, y: 0.68, w: R - 3.2, h: 0.62, fontSize: 28, bold: true, color: COL.ink, align: "right", valign: "middle", rtlMode: true, margin: 0 }, text: "" } },
    ],
    slideNumber: { x: M, y: 6.98, w: 0.5, h: 0.3, fontSize: 9, color: COL.gold, bold: true, margin: 0 },
  });
  pres.defineSlideMaster({
    title: "CB_DIVIDER",
    background: { color: COL.ink },
    objects: [
      { image: { path: IMG.markLight, x: 1.0, y: 1.25, h: 5.0, w: 5.0 * MARK_R, altText: "CoreBuild mark" } },
      { text: { text: tag, options: { x: M, y: 6.85, w: 5, h: 0.3, fontSize: 9, color: COL.warm, bold: true, charSpacing: 1, align: "left", margin: 0 } } },
      { placeholder: { options: { name: "title", type: "title", x: 5.6, y: 2.85, w: R - 5.6, h: 1.3, fontSize: 40, bold: true, color: COL.paper, align: "right", valign: "middle", rtlMode: true, margin: 0 }, text: "" } },
    ],
    slideNumber: { x: R - 0.5, y: 6.85, w: 0.5, h: 0.3, fontSize: 9, color: COL.gold, bold: true, align: "right", margin: 0 },
  });
  pres.defineSlideMaster({ title: "CB_DARK", background: { color: COL.ink }, objects: [] });

  // ---------- primitives ----------
  function warn(msg) { warnings.push(`slide ${slideNo}: ${msg}`); }
  function T(slide, text, o) {
    const opts = Object.assign({ isTextBox: true, align: "right", rtlMode: true, margin: 0, valign: "top", color: COL.ink }, o);
    recordBox(text, opts, o && o._label);
    delete opts._label;
    if (Array.isArray(text)) text = text.map((r) => ({ text: r.text, options: Object.assign({ align: opts.align, rtlMode: opts.rtlMode }, r.options) }));
    slide.addText(text, opts);
  }
  // Fit-checked text: shrinks from `size` toward `min` and warns if it still overflows.
  function TF(slide, text, o, { size, min = size, label = "text", lineMult = 1.15 } = {}) {
    const paras = Array.isArray(text) ? [text.map((r) => r.text).join("")] : [String(text)];
    const k = fit[nextKey()] || 1;
    // measured overflow k → text height scales with size², so start from size / √k
    let s = k > 1 ? Math.max(min, Math.floor((size / Math.sqrt(k)) * 2) / 2) : size;
    while (s > min && estHeight(paras, o.w, s, { lineMult }) > o.h) s -= 0.5;
    T(slide, text, Object.assign({ fontSize: s, _label: label }, o));
    return s;
  }
  const shadow = () => ({ type: "outer", color: "000000", opacity: 0.07, blur: 10, offset: 2, angle: 90 });
  function panel(slide, x, y, w, h, o = {}) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, Object.assign({ x, y, w, h, rectRadius: 0.08, fill: { color: COL.paper }, line: { color: HEX.line, width: 0.75 }, shadow: shadow() }, o));
  }
  function darkPanel(slide, x, y, w, h) { panel(slide, x, y, w, h, { fill: { color: COL.ink }, line: { type: "none" } }); }

  const iconCache = {};
  async function iconData(name, color) {
    let comp = fa[name];
    if (!comp) { if (name) warn(`unknown icon "${name}" — using FaCircleCheck`); comp = fa.FaCircleCheck; name = "FaCircleCheck"; }
    const key = name + color;
    if (!iconCache[key]) {
      const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(comp, { color: "#" + color, size: 256 }));
      const buf = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
      iconCache[key] = "image/png;base64," + buf.toString("base64");
    }
    return iconCache[key];
  }
  async function iconCircle(slide, name, x, y, d, o = {}) {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: o.bg || COL.ink }, line: { type: "none" } });
    if (typeof name === "string" && name.startsWith("media:") && mediaData[name]) {
      const p = d * 0.27;
      slide.addImage({ data: mediaData[name], x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, altText: "" });
      return;
    }
    const p = d * 0.27;
    slide.addImage({ data: await iconData(name, o.fg || HEX.gold), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, altText: "" });
  }

  // "Label: text" items → bold label + grey text, one paragraph each.
  function itemRuns(items, size) {
    return items.map((it, i) => {
      const last = i === items.length - 1;
      const base = { fontSize: size, paraSpaceAfter: last ? 0 : 14, lineSpacingMultiple: 1.1, rtlMode: true, align: "right" };
      const k = it.indexOf(":");
      if (k < 0 || k > 40) return { text: it, options: Object.assign({ color: COL.grey, breakLine: !last }, base) };
      return [
        { text: it.slice(0, k).trim() + ": ", options: Object.assign({ bold: true, color: COL.ink }, base) },
        { text: it.slice(k + 1).trim(), options: Object.assign({ color: COL.grey, breakLine: !last }, base) },
      ];
    }).flat();
  }
  function fitItems(items, w, h, sizes = [15.5, 15, 14.5, 14, 13.5, 13, 12.5]) {
    const k = fit[nextKey()] || 1;
    const cap = sizes[0] / Math.sqrt(k);
    for (const s of sizes) if (s <= cap + 0.01 && estHeight(items, w, s, { lineMult: 1.1, paraGapPt: 14 }) <= h) return s;
    return sizes[sizes.length - 1];
  }

  async function card(slide, { x, y, w, h, icon, heading, items = [], tag: tg, dark = false }) {
    dark ? darkPanel(slide, x, y, w, h) : panel(slide, x, y, w, h);
    await iconCircle(slide, icon, x + w - 0.3 - 0.62, y + 0.3, 0.62, dark ? { bg: COL.dark2 } : {});
    TF(slide, heading || "", { x: x + 0.3, y: y + 0.3, w: w - 1.4, h: 0.62, bold: true, valign: "middle", color: dark ? COL.paper : COL.ink }, { size: 18, min: 14, label: "card heading" });
    const tagH = tg ? 0.5 : 0;
    const bodyH = h - 1.25 - 0.25 - (tg ? tagH + 0.15 : 0);
    if (items.length) {
      const s = fitItems(items, w - 0.6, bodyH);
      T(slide, itemRuns(items, s), { x: x + 0.3, y: y + 1.25, w: w - 0.6, h: bodyH, _label: "card items" });
    }
    if (tg) {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.3, y: y + h - 0.3 - tagH, w: w - 0.6, h: tagH, rectRadius: 0.06, fill: { color: HEX.goldTint }, line: { type: "none" } });
      const k = tg.indexOf(":");
      const runs = k > 0 && k < 40
        ? [{ text: tg.slice(0, k + 1) + " ", options: { bold: true, color: COL.goldDeep } }, { text: tg.slice(k + 1).trim(), options: { color: COL.ink } }]
        : [{ text: tg, options: { color: COL.ink } }];
      TF(slide, runs, { x: x + 0.45, y: y + h - 0.3 - tagH, w: w - 0.9, h: tagH, valign: "middle" }, { size: 12.5, min: 10.5, label: "card tag", lineMult: 1.05 });
    }
  }

  // ---------- slide frames ----------
  function contentSlide(section, kicker, title) {
    slideNo++; boxIdx = 0;
    const s = pres.addSlide({ masterName: "CB_CONTENT", sectionTitle: section });
    if (kicker) T(s, kicker, { x: 3.2, y: 0.36, w: R - 3.2, h: 0.3, fontSize: 11, bold: true, color: COL.gold });
    const tk = fit[nextKey()] || 1, tsize = tk > 1 ? Math.max(20, Math.floor(28 / tk)) : 28;
    recordBox(title || "", { w: R - 3.2, h: 0.62, fontSize: tsize, bold: true }, "title");
    s.addText(title || "", tsize < 28 ? { placeholder: "title", fontSize: tsize } : { placeholder: "title" });
    return s;
  }
  function darkSlide(section) { slideNo++; boxIdx = 0; return pres.addSlide({ masterName: "CB_DARK", sectionTitle: section }); }
  function dividerSlide(section, number, title, subtitle) {
    slideNo++; boxIdx = 0;
    recordBox(title || "", { w: R - 5.6, h: 1.3, fontSize: 40, bold: true }, "divider title");
    const s = pres.addSlide({ masterName: "CB_DIVIDER", sectionTitle: section });
    if (number) T(s, number, { x: 8.7, y: 1.55, w: R - 8.7, h: 1.0, fontSize: 60, bold: true, color: COL.gold });
    s.addText(title || "", { placeholder: "title" });
    if (subtitle) TF(s, subtitle, { x: 6.4, y: 4.35, w: R - 6.4, h: 0.9, color: COL.stone, lineSpacingMultiple: 1.15 }, { size: 16, min: 13, label: "divider subtitle" });
    return s;
  }
  function subtitleLine(slide, text) {
    if (!text) return { y0: CONTENT_Y, h: CONTENT_H };
    TF(slide, text, { x: M, y: 1.45, w: R - M, h: 0.4, color: COL.grey, bold: true, valign: "middle" }, { size: 15, min: 12, label: "subtitle" });
    return { y0: 2.0, h: CONTENT_H - 0.35 };
  }
  // Lay out n equal boxes right-to-left in a row/grid inside [x0, x0+w].
  function grid(n, cols, { x0 = M, w = R - M, y0 = CONTENT_Y, h = CONTENT_H, gap = 0.35 } = {}) {
    const rows = Math.ceil(n / cols);
    const bw = (w - (cols - 1) * gap) / cols, bh = (h - (rows - 1) * gap) / rows;
    return Array.from({ length: n }, (_, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      return { x: x0 + w - bw - c * (bw + gap), y: y0 + r * (bh + gap), w: bw, h: bh };
    });
  }

  return {
    pres, COL, HEX, IMG, LOGO_R, MARK_R, W, H, M, R, CONTENT_Y, CONTENT_H, warnings, boxes, tables, mediaData, nextKey, subtitleLine,
    estLines, estHeight, T, TF, panel, darkPanel, iconCircle, iconData, itemRuns, card, contentSlide, darkSlide, dividerSlide, grid, warn,
    get slideNo() { return slideNo; },
    bumpBox() { const k = nextKey(); boxIdx++; return k; },
  };
}

// pptxgenjs cannot write theme colours or the Arabic (complex-script) font, so patch the theme part.
async function finalizeTheme(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const clr = Object.entries(THEME_COLORS).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join("");
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))) {
    let x = await zip.file(f).async("string");
    x = x.replace(/<a:clrScheme name="[^"]*">[\s\S]*?<\/a:clrScheme>/, `<a:clrScheme name="CoreBuild">${clr}</a:clrScheme>`)
      .replace(/<a:cs typeface="[^"]*"\/>/g, `<a:cs typeface="${FONT}"/>`)
      .replace(/script="Arab" typeface="[^"]*"/g, `script="Arab" typeface="${FONT}"`);
    zip.file(f, x);
  }
  // Drop folder entries: some cloud viewers refuse zips that contain them.
  for (const n of Object.keys(zip.files)) if (zip.files[n].dir) delete zip.files[n];
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { createDeck, finalizeTheme, estLines, estHeight, HEX };
