// Reads any .pptx into plain data: slides in order, each with positioned shapes (text paragraphs,
// fills, pictures, tables), layout name, background darkness, notes and section names.
// Positions are in inches. Used by the importer (pptx → spec) and the checker (compare decks).
const JSZip = require("jszip");
const path = require("path").posix;
const { parseXml, kid, kids, find, findAll, textOf } = require("./xml");

const EMU = 914400;

function luminance(hex) {
  if (!hex || hex.length !== 6) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function readPptx(buffer, { withMedia = false } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const cache = {};
  const read = async (p) => { const f = zip.file(p); return f ? f.async("string") : null; };
  const xml = async (p) => { if (!(p in cache)) { const s = await read(p); cache[p] = s ? parseXml(s) : null; } return cache[p]; };
  async function rels(p) {
    const dir = path.dirname(p);
    const x = await xml(`${dir}/_rels/${path.basename(p)}.rels`);
    const out = {};
    for (const r of findAll(x, "Relationship")) {
      out[r.attrs.Id] = { target: r.attrs.TargetMode === "External" ? r.attrs.Target : path.normalize(path.join(dir, r.attrs.Target)), type: (r.attrs.Type || "").split("/").pop() };
    }
    return out;
  }

  const pres = await xml("ppt/presentation.xml");
  if (!pres) throw new Error("not a PowerPoint (.pptx) file");
  const prels = await rels("ppt/presentation.xml");
  const sz = find(pres, "p:sldSz");
  const size = { w: sz ? +sz.attrs.cx / EMU : 13.333, h: sz ? +sz.attrs.cy / EMU : 7.5 };
  const sldIds = findAll(find(pres, "p:sldIdLst"), "p:sldId");

  // Sections (PowerPoint 2010+ extension)
  const sectionOf = {};
  for (const sec of findAll(pres, "p14:section")) for (const s of findAll(sec, "p14:sldId")) sectionOf[s.attrs.id] = sec.attrs.name || "";

  const core = (await read("docProps/core.xml")) || "";
  const kw = /<cp:keywords>([^<]*)<\/cp:keywords>/.exec(core);
  const ttl = /<dc:title>([^<]*)<\/dc:title>/.exec(core);

  // Colour scheme of a master (theme colours + clrMap), for resolving schemeClr fills.
  const schemeCache = {};
  async function schemeFor(masterPath) {
    if (schemeCache[masterPath]) return schemeCache[masterPath];
    const mx = await xml(masterPath);
    const mr = await rels(masterPath);
    const themeRel = Object.values(mr).find((r) => r.type === "theme");
    const theme = themeRel ? await xml(themeRel.target) : null;
    const clr = {};
    const cs = find(theme, "a:clrScheme");
    for (const c of kids(cs)) {
      const v = kid(c, "a:srgbClr") || kid(c, "a:sysClr");
      if (v) clr[c.name.slice(2)] = (v.attrs.val && v.attrs.val.length === 6 ? v.attrs.val : v.attrs.lastClr) || "";
    }
    const map = (find(mx, "p:clrMap") || { attrs: {} }).attrs;
    const sch = Object.assign({}, clr, { bg1: clr[map.bg1 || "lt1"], tx1: clr[map.tx1 || "dk1"], bg2: clr[map.bg2 || "lt2"], tx2: clr[map.tx2 || "dk2"] });
    return (schemeCache[masterPath] = sch);
  }
  const colorOf = (fill, sch) => {
    if (!fill) return null;
    const s = kid(fill, "a:srgbClr"); if (s) return s.attrs.val;
    const c = kid(fill, "a:schemeClr"); if (c) return sch[c.attrs.val] || null;
    return null;
  };
  const bgOf = (x, sch) => {
    const bg = find(x, "p:bg");
    if (!bg) return null;
    const bgPr = kid(bg, "p:bgPr");
    if (bgPr) return colorOf(kid(bgPr, "a:solidFill"), sch);
    const ref = kid(bg, "p:bgRef");
    return ref ? colorOf(ref, sch) : null;
  };

  function paragraphs(txBody, sch) {
    if (!txBody) return [];
    const out = [];
    for (const p of kids(txBody, "a:p")) {
      let text = "", size = null, bold = false, color = null;
      for (const c of kids(p)) {
        if (c.name === "a:r" || c.name === "a:fld") {
          if (c.name === "a:fld" && /slidenum/i.test(c.attrs.type || "")) continue;
          const rPr = kid(c, "a:rPr");
          if (rPr) {
            if (size == null && rPr.attrs.sz) size = +rPr.attrs.sz / 100;
            if (rPr.attrs.b === "1") bold = true;
            if (!color) color = colorOf(kid(rPr, "a:solidFill"), sch);
          }
          text += textOf(kid(c, "a:t"));
        } else if (c.name === "a:br") text += "\n";
      }
      if (size == null) { const e = kid(p, "a:endParaRPr"); if (e && e.attrs.sz) size = +e.attrs.sz / 100; }
      if (text.trim()) out.push({ text: text.replace(/[ \t ]+/g, " ").trim(), size, bold, color });
    }
    return out;
  }

  const slides = [];
  for (let i = 0; i < sldIds.length; i++) {
    const rel = prels[sldIds[i].attrs["r:id"]];
    if (!rel) continue;
    const sp = rel.target;
    const x = await xml(sp);
    const r = await rels(sp);
    const layoutRel = Object.values(r).find((v) => v.type === "slideLayout");
    let layoutName = "", lx = null, masterPath = null;
    if (layoutRel) {
      lx = await xml(layoutRel.target);
      layoutName = (find(lx, "p:cSld") || { attrs: {} }).attrs.name || "";
      const mrel = Object.values(await rels(layoutRel.target)).find((v) => v.type === "slideMaster");
      masterPath = mrel ? mrel.target : null;
    }
    const sch = masterPath ? await schemeFor(masterPath) : {};
    const bg = bgOf(x, sch) || (lx && bgOf(lx, sch)) || (masterPath && bgOf(await xml(masterPath), sch)) || "FFFFFF";

    // Placeholder positions from the layout, for placeholders that do not carry their own xfrm.
    const phPos = {};
    for (const s of findAll(lx, "p:sp")) {
      const ph = find(s, "p:ph"), xf = find(kid(s, "p:spPr"), "a:xfrm");
      if (ph && xf) phPos[ph.attrs.type || "body:" + (ph.attrs.idx || "")] = xf;
    }

    const shapes = [];
    const box = (xf, tf) => {
      const off = kid(xf, "a:off"), ext = kid(xf, "a:ext");
      if (!off || !ext) return null;
      return { x: (+off.attrs.x * tf.sx + tf.dx) / EMU, y: (+off.attrs.y * tf.sy + tf.dy) / EMU, w: (+ext.attrs.cx * tf.sx) / EMU, h: (+ext.attrs.cy * tf.sy) / EMU };
    };
    function shapeOf(c, tf) {
      const nv = find(c, "p:cNvPr");
      const ph = find(c, "p:ph");
      const spPr = kid(c, "p:spPr");
      let xf = spPr ? kid(spPr, "a:xfrm") : kid(c, "p:xfrm");
      if (!xf && ph) xf = phPos[ph.attrs.type || "body:" + (ph.attrs.idx || "")] || phPos[ph.attrs.type] || null;
      const b = xf ? box(xf, tf) : ph && /title/i.test(ph.attrs.type || "") ? { x: 0.6, y: 0.5, w: size.w - 1.2, h: 0.9 } : { x: 0, y: 0, w: 0, h: 0 };
      const geom = spPr && kid(spPr, "a:prstGeom");
      const sh = Object.assign({ kind: c.name.slice(2), name: nv ? nv.attrs.name : "", ph: ph ? ph.attrs.type || "body" : null, prst: geom ? geom.attrs.prst : null,
        fill: spPr ? colorOf(kid(spPr, "a:solidFill"), sch) : null, paras: paragraphs(kid(c, "p:txBody"), sch) }, b);
      if (c.name === "p:pic") {
        const blip = find(c, "a:blip");
        const t = blip && r[blip.attrs["r:embed"]];
        sh.media = t ? t.target : null;
      }
      if (c.name === "p:graphicFrame") {
        const tbl = find(c, "a:tbl");
        if (tbl) {
          const rtl = (kid(tbl, "a:tblPr") || { attrs: {} }).attrs.rtl === "1";
          sh.kind = "table";
          sh.colW = findAll(kid(tbl, "a:tblGrid"), "a:gridCol").map((g) => +g.attrs.w / EMU);
          sh.rows = kids(tbl, "a:tr").map((tr) => kids(tr, "a:tc").filter((tc) => tc.attrs.hMerge !== "1").map((tc) => paragraphs(kid(tc, "a:txBody"), sch).map((p) => p.text).join("\n")));
          sh.rtl = rtl;
        } else if (find(c, "c:chart")) sh.kind = "chart";
        else if (find(c, "dgm:relIds")) sh.kind = "diagram";
        else sh.kind = "object";
      }
      sh.text = sh.paras.map((p) => p.text).join("\n");
      return sh;
    }
    function walk(node, tf) {
      for (const c of kids(node)) {
        if (c.name === "p:grpSp") {
          const gx = kid(kid(c, "p:grpSpPr"), "a:xfrm");
          let t2 = tf;
          if (gx) {
            const off = kid(gx, "a:off"), ext = kid(gx, "a:ext"), cho = kid(gx, "a:chOff"), che = kid(gx, "a:chExt");
            if (off && ext && cho && che) {
              const kx = +che.attrs.cx ? +ext.attrs.cx / +che.attrs.cx : 1, ky = +che.attrs.cy ? +ext.attrs.cy / +che.attrs.cy : 1;
              t2 = { sx: tf.sx * kx, sy: tf.sy * ky, dx: (+off.attrs.x - +cho.attrs.x * kx) * tf.sx + tf.dx, dy: (+off.attrs.y - +cho.attrs.y * ky) * tf.sy + tf.dy };
            }
          }
          walk(c, t2);
        } else if (["p:sp", "p:pic", "p:graphicFrame", "p:cxnSp"].includes(c.name)) shapes.push(shapeOf(c, tf));
        else if (c.name === "mc:AlternateContent") walk(kid(c, "mc:Choice") || kid(c, "mc:Fallback"), tf);
      }
    }
    walk(find(x, "p:spTree"), { sx: 1, sy: 1, dx: 0, dy: 0 });

    let notes = "";
    const nrel = Object.values(r).find((v) => v.type === "notesSlide");
    if (nrel) {
      const nx = await xml(nrel.target);
      notes = findAll(nx, "p:sp").filter((s) => { const ph = find(s, "p:ph"); return ph && (ph.attrs.type || "body") === "body"; })
        .map((s) => paragraphs(kid(s, "p:txBody"), {}).map((p) => p.text).join("\n")).join("\n").trim();
    }
    // Static texts of the layout (footer / tagline on kit decks)
    const layoutTexts = findAll(lx, "p:sp").filter((s) => !find(s, "p:ph")).map((s) => {
      const xf = find(kid(s, "p:spPr"), "a:xfrm"); const b = xf ? box(xf, { sx: 1, sy: 1, dx: 0, dy: 0 }) : { y: 0 };
      return { y: b.y, text: paragraphs(kid(s, "p:txBody"), sch).map((p) => p.text).join(" ") };
    }).filter((t) => t.text);

    const visible = [];
    for (const s of shapes) {
      if (s.kind === "table") s.rows.forEach((row) => row.forEach((c) => { if (c.trim()) visible.push(c); }));
      else s.paras.forEach((p) => visible.push(p.text));
    }
    slides.push({
      n: slides.length + 1, id: sldIds[i].attrs.id, path: sp, section: sectionOf[sldIds[i].attrs.id] || "", hidden: (find(x, "p:sld") || { attrs: {} }).attrs.show === "0",
      layout: layoutName, bg, dark: luminance(bg) < 0.35, shapes, notes, texts: visible, layoutTexts,
    });
  }

  let media = null;
  if (withMedia) {
    media = {};
    const used = new Set(slides.flatMap((s) => s.shapes.filter((x) => x.media).map((x) => x.media)));
    for (const m of used) { const f = zip.file(m); if (f) media[m] = await f.async("nodebuffer"); }
  }
  return { size, title: ttl ? ttl[1] : "", keywords: kw ? kw[1] : "", slides, media };
}

module.exports = { readPptx, luminance };
