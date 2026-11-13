// Mechanical pptx → deck spec conversion. No model involved: every slide of the source becomes one or
// more spec slides tagged with `source: n`, keeping all of its text. Slides that cannot be mapped to a
// slide type without losing text (charts, diagrams, unusual layouts) are kept as a picture of the original.
const { tokens } = require("./facts");

const CONST_TEXT = /^COREBUILD INVESTMENTS ESTABLISHMENT$/i;
const ARABIC = /[؀-ۿ]/;
const PALETTE = ["151515", "B8924A", "D9C49C", "6E6A62", "CFCAC0"]; // timeline category colours, in renderer order

const cx = (s) => s.x + s.w / 2, cy = (s) => s.y + s.h / 2;
const inside = (a, b, tol = 0.03) => cx(a) >= b.x - tol && cx(a) <= b.x + b.w + tol && cy(a) >= b.y - tol && cy(a) <= b.y + b.h + tol;
const area = (s) => s.w * s.h;
const byReading = (a, b) => (Math.abs(a.y - b.y) > 0.12 ? a.y - b.y : b.x - a.x); // top→bottom, right→left
const isNumTxt = (t) => /^\d{1,2}$/.test(t.text.trim());
const one = (t) => t.paras.length === 1;
const sizeOf = (t) => Math.max(...t.paras.map((p) => p.size || 14));

// ---------- per-slide classification ----------
function convertSlide(s, ctx) {
  const shapes = s.shapes;
  if (shapes.some((x) => ["chart", "diagram", "object"].includes(x.kind))) return { picture: "chart or diagram" };
  let texts = shapes.filter((x) => x.kind === "sp" && x.text && !CONST_TEXT.test(x.text.trim()));
  const pics = shapes.filter((x) => x.kind === "pic");
  const notes = s.notes || undefined;
  const isFirst = s.n === 1, isLast = s.n === ctx.count;

  // Dark full slides: cover, divider, closing
  if (s.dark) {
    const big = [...texts].sort((a, b) => sizeOf(b) - sizeOf(a));
    if (/DIVIDER|Section/i.test(s.layout) || (!isFirst && !isLast && texts.some((t) => isNumTxt(t) && sizeOf(t) >= 36))) {
      const num = texts.find((t) => isNumTxt(t) && sizeOf(t) >= 36);
      const rest = big.filter((t) => t !== num);
      return { slides: [{ type: "divider", number: num ? num.text.trim() : undefined, title: rest[0] ? rest[0].text : "", subtitle: rest.slice(1).sort(byReading).map((t) => t.text).join("\n") || undefined, notes }] };
    }
    if (isFirst || !/شكر/.test((big[0] || {}).text || "")) {
      if (isFirst) {
        const title = big[0];
        const others = texts.filter((t) => t !== title).sort(byReading);
        const sub = others.find((t) => /^مقدم(ة)? (إلى|الى)\s*:?/.test(t.text));
        const kicker = others.find((t) => t.y < title.y && !ARABIC.test(t.text));
        const rest = others.filter((t) => t !== sub && t !== kicker);
        const subtitle = rest.find((t) => t.y > title.y && sizeOf(t) >= 18);
        const meta = rest.filter((t) => t !== subtitle);
        return { slides: [{ type: "cover", kicker: kicker ? kicker.text : undefined, title: title ? title.text : "", subtitle: subtitle ? subtitle.text : undefined,
          meta: meta.length ? meta.map((t) => t.text).join(" — ") : undefined, submitted_to: sub ? sub.text.replace(/^مقدم(ة)? (إلى|الى)\s*:?\s*/, "") : undefined,
          submitted_label: sub ? /^مقدم(ة)? (إلى|الى)\s*:?/.exec(sub.text)[0] : undefined, notes }] };
      }
    }
    if (isLast || /شكر/.test((big[0] || {}).text || "")) {
      const title = big[0];
      const contacts = {}, textParts = [];
      for (const t of texts.filter((x) => x !== title).sort(byReading)) {
        const v = t.text.trim();
        if (!contacts.email && /^\S+@\S+\.\S+$/.test(v)) contacts.email = v;
        else if (!contacts.website && /^(https?:\/\/|www\.)\S+$/i.test(v)) contacts.website = v;
        else if (!contacts.phone && /^[+\d][\d\s\-+()]{6,}$/.test(v)) contacts.phone = v;
        else if (sizeOf(t) >= 15 && sizeOf(t) <= 16 && !contacts.address && v.length < 90 && t.y > 4) contacts.address = v;
        else textParts.push(v);
      }
      return { slides: [{ type: "closing", title: title ? title.text : "", text: textParts.join("\n") || undefined, contacts, notes }] };
    }
  }

  // Content slides: title and kicker at the top
  const top = texts.filter((t) => t.y < 1.45);
  const title = texts.find((t) => /title/i.test(t.ph || "")) || [...top].sort((a, b) => sizeOf(b) - sizeOf(a))[0];
  const kicker = title ? top.find((t) => t !== title && t.y < title.y && sizeOf(t) <= 14) : null;
  texts = texts.filter((t) => t !== title && t !== kicker).sort(byReading);
  const base = { kicker: kicker ? kicker.text : undefined, title: title ? title.text : "" };

  // Table
  const tbl = shapes.find((x) => x.kind === "table");
  if (tbl) {
    const arabic = tbl.rows.some((r) => r.some((c) => ARABIC.test(c)));
    const flip = !tbl.rtl && arabic;
    const rows = tbl.rows.map((r) => (flip ? [...r].reverse() : r)).filter((r) => r.some((c) => c.trim()));
    const widths = (flip ? [...tbl.colW].reverse() : tbl.colW).map((w) => Math.round(w * 100) / 100);
    const free = texts.filter((t) => !inside(t, tbl));
    const head = rows[0] || [], body = rows.slice(1);
    const note = free.map((t) => t.text).join("\n") || undefined;
    const out = [];
    for (let i = 0; i < Math.max(1, body.length); i += 9) {
      out.push(Object.assign({ type: "table" }, base, { title: base.title + (i ? " (تابع)" : ""), columns: head, column_widths: widths.length === head.length ? widths : undefined, rows: body.slice(i, i + 9), note: i + 9 >= body.length ? note : undefined }));
    }
    out[0].notes = notes;
    return { slides: out };
  }

  // Gantt chart
  const gantt = readGantt(shapes, texts);
  if (gantt) {
    return { slides: [Object.assign({ type: "timeline" }, base, gantt.spec, { notes })], timeline: gantt.spec.activities };
  }

  // Panels: filled boxes that hold text
  const panels = shapes.filter((x) => x.kind === "sp" && ["roundRect", "rect"].includes(x.prst) && x.fill && x.w >= 1.4 && x.h >= 0.9);
  const iconOf = (p) => {
    const ic = pics.find((q) => q.w < 0.5 && inside(q, p) && shapes.some((e) => e.prst === "ellipse" && inside(q, e)));
    return ic && ic.media ? ctx.mediaRef(ic.media) : undefined;
  };
  const owner = new Map();
  for (const t of texts) {
    const holders = panels.filter((p) => inside(t, p)).sort((a, b) => area(a) - area(b));
    if (holders.length) owner.set(t, holders[0]);
  }
  const panelTexts = (p) => texts.filter((t) => owner.get(t) === p);
  const used = panels.filter((p) => panelTexts(p).length);
  let free = texts.filter((t) => !owner.has(t));
  const photos = pics.filter((q) => q.w >= 2 && q.h >= 2 && q.media).map((q) => Object.assign({}, q, { ref: ctx.mediaRef(q.media) }));

  // Agenda: boxes with a big 2-digit number, a heading and a subtitle
  if (/محتويات|فهرس|agenda|contents/i.test(base.title) && used.length >= 2 && used.every((p) => panelTexts(p).some((t) => isNumTxt(t) && sizeOf(t) >= 26)) && used.length <= 6 && !free.length) {
    const items = used.sort(byReading).map((p) => {
      const ts = panelTexts(p), num = ts.find((t) => isNumTxt(t)), rest = ts.filter((t) => t !== num);
      return { number: num.text.trim(), title: rest[0] ? rest[0].text : "", subtitle: rest.slice(1).map((t) => t.text).join("\n") || undefined, icon: iconOf(p) };
    });
    return { slides: [Object.assign({ type: "agenda" }, base, { items, notes })] };
  }

  // Org chart: small boxes in up to 3 rows joined by lines
  const lines = shapes.filter((x) => x.kind === "cxnSp" || x.prst === "line");
  if (lines.length >= 2 && used.length >= 3 && used.every((p) => p.h < 1.5 && p.w < 4.2) && !free.length) {
    const rows = [];
    for (const p of [...used].sort((a, b) => a.y - b.y)) {
      const r = rows.find((rr) => Math.abs(rr[0].y - p.y) < 0.2);
      r ? r.push(p) : rows.push([p]);
    }
    if (rows.length <= 3 && rows.every((r) => r.length <= 3) && rows[0].length === 1) {
      const person = (p) => { const ts = panelTexts(p).sort(byReading); return { dept: ts[0] ? ts[0].text : "", name: ts[1] ? ts[1].text : "", role: ts.slice(2).map((t) => t.text).join(" ") }; };
      const ordered = (r) => [...r].sort((a, b) => b.x - a.x).map(person);
      return { slides: [Object.assign({ type: "org" }, base, { root: person(rows[0][0]), level2: rows[1] ? ordered(rows[1]) : [], level3: rows[2] ? ordered(rows[2]) : [], notes })] };
    }
  }

  // Subtitle line right under the title, and wide group headers that split the slide
  let subtitle;
  const headers = free.filter((t) => t.w > 5 && one(t) && t.paras[0].bold && sizeOf(t) >= 14 && used.some((p) => p.y > t.y));
  if (headers.length < 2) {
    const sub = free.find((t) => t.y < 2.1 && t.w > 5 && one(t));
    if (sub) { subtitle = sub.text; free = free.filter((t) => t !== sub); }
  }
  if (headers.length >= 2 && used.length) {
    const groups = headers.sort((a, b) => a.y - b.y).map((h, i, arr) => ({ h, panels: used.filter((p) => p.y > h.y && (i + 1 >= arr.length || p.y < arr[i + 1].y)) }));
    const rest = free.filter((t) => !headers.includes(t));
    if (groups.every((g) => g.panels.length) && !rest.length) {
      const out = [];
      for (let i = 0; i < groups.length; i++) {
        const r = layoutPanels(groups[i].panels, [], panelTexts, iconOf, photos, Object.assign({}, base, { title: base.title + (i ? " (تابع)" : "") }), groups[i].h.text, shapes);
        if (!r) return { picture: "grouped layout" };
        out.push(...r);
      }
      out[0].notes = notes;
      return { slides: out };
    }
  }
  const r = layoutPanels(used, free, panelTexts, iconOf, photos, base, subtitle, shapes);
  if (!r) return { picture: "layout not recognised" };
  r[0].notes = notes;
  return { slides: r };
}

// Parse one panel's texts into roles.
function parsePanel(p, ts, shapesInside) {
  ts = [...ts].sort(byReading);
  const tag = ts.find((t) => shapesInside.some((q) => q !== p && q.h < 0.8 && q.fill && inside(t, q) && q.y > p.y + p.h * 0.55));
  const number = ts.find((t) => t !== tag && isNumTxt(t) && sizeOf(t) >= 18);
  const big = ts.find((t) => t !== tag && t !== number && sizeOf(t) >= 26);
  let rest = ts.filter((t) => t !== tag && t !== number && t !== big);
  const label = big ? rest.find((t) => t.y < big.y && sizeOf(t) <= 14) : null;
  rest = rest.filter((t) => t !== label);
  const heading = rest.find((t) => one(t) && sizeOf(t) >= 14 && t.paras[0].bold && t.text.length < 90 && !/:/.test(t.text.slice(0, 40)));
  rest = rest.filter((t) => t !== heading);
  const small = !big && !heading ? rest.find((t) => one(t) && sizeOf(t) <= 12.5 && t.paras[0].bold && t.text.length < 40) : null; // e.g. "القيم" above a tile heading
  return { tag, number, big, label, heading, items: rest.flatMap((t) => t.paras.map((x) => x.text)), small };
}

function splitValue(v) {
  const m = /^([\d.,%+\-]+)\s+(.+)$/.exec(v.trim());
  return m ? { value: m[1], unit: m[2] } : { value: v.trim() };
}

function layoutPanels(used, free, panelTexts, iconOf, photos, base, subtitle, shapes) {
  const all = used.map((p) => ({ p, ...parsePanel(p, panelTexts(p), shapes), icon: iconOf(p) }));
  const extra = free.length ? [{ heading: undefined, items: free.flatMap((t) => t.paras.map((x) => x.text)) }] : [];
  let stats = all.filter((a) => a.big && a.p.w < 5.5 && a.p.h <= 3.3);
  if (!stats.some((a) => /\d/.test(a.big.text))) stats = [];
  const darkHero = all.find((a) => a.big && a.p.h >= 2.5 && a.p.w >= 3 && a.p.w < 6 && (a.p.fill || "").toUpperCase() === "151515" && !/\d{3}/.test(a.big.text) || (a.big && a.p.h >= 4.5 && a.p.w < 6));
  const photo = photos.find((q) => q.h >= 3);
  const cardOf = (a) => {
    const heading = a.heading ? a.heading.text : a.small ? a.small.text : undefined;
    const items = (a.small && a.heading ? [a.small.text] : []).concat(a.items);
    return { icon: a.icon, heading, items, tag: a.tag ? a.tag.text : undefined };
  };
  const tileOf = (a) => ({ icon: a.icon, heading: [a.small && a.heading ? a.small.text : null, a.heading ? a.heading.text : a.small ? a.small.text : null].filter(Boolean).join(" — ") || undefined, text: a.items.join("\n") || undefined, number: a.number ? a.number.text.trim() : undefined });

  // stats: 2–4 big numbers, optional wide fact strip
  if (stats.length >= 2 && stats.length <= 4) {
    const others = all.filter((a) => !stats.includes(a));
    const strip = others.length === 1 && others[0].p.w > 8 ? others[0] : null;
    if (others.length === 0 || strip) {
      let facts;
      if (strip) {
        const ts = panelTexts(strip.p);
        const labels = ts.filter((t) => sizeOf(t) <= 13), values = ts.filter((t) => sizeOf(t) > 13);
        if (labels.length !== values.length) return null;
        facts = labels.sort((a, b) => b.x - a.x).map((l) => ({ label: l.text, value: values.sort((a, b) => Math.abs(a.x - l.x) - Math.abs(b.x - l.x))[0].text }));
      }
      const st = stats.sort((a, b) => b.p.x - a.p.x).map((a) => Object.assign({ label: a.label ? a.label.text : a.heading ? a.heading.text : "", icon: a.icon }, splitValue(a.big.text)));
      if (free.length || stats.some((a) => a.items.length)) return null;
      return [Object.assign({ type: "stats" }, base, { stats: st, facts })];
    }
  }

  // process: 2–5 numbered steps in one row, optional dark band underneath
  const numbered = all.filter((a) => a.number && !a.big);
  const seq = [...numbered].sort((a, b) => b.p.x - a.p.x).every((a, i) => a.number.text.trim() === String(i + 1).padStart(2, "0"));
  if (seq && numbered.length >= 2 && numbered.length <= 5 && numbered.every((a) => Math.abs(a.p.y - numbered[0].p.y) < 0.1)) {
    const others = all.filter((a) => !numbered.includes(a));
    const band = others.length === 1 && others[0].p.w > 8 ? others[0] : null;
    if (others.length === 0 || band) {
      let bandSpec;
      if (band) {
        const ts = panelTexts(band.p).sort(byReading);
        const head = ts[0];
        const cols = [];
        for (const t of ts.slice(1)) { const c = cols.find((cc) => Math.abs(cc.x - t.x) < 0.3); c ? c.ts.push(t) : cols.push({ x: t.x, ts: [t] }); }
        bandSpec = { heading: head.text, items: cols.sort((a, b) => b.x - a.x).map((c) => ({ heading: c.ts[0].text, text: c.ts.slice(1).map((t) => t.text).join("\n") })) };
        if (bandSpec.items.length > 4) return null;
      }
      if (free.length) return null;
      return [Object.assign({ type: "process" }, base, { subtitle, steps: numbered.sort((a, b) => b.p.x - a.p.x).map((a) => ({ icon: a.icon, heading: a.heading ? a.heading.text : "", text: a.items.join("\n") })), band: bandSpec })];
    }
  }

  // hero: dark panel (or photo) with a big figure or statement, beside cards/tiles
  if (darkHero || photo) {
    const rest = all.filter((a) => a !== darkHero);
    const hp = darkHero ? darkHero.p : photo;
    const panel = darkHero
      ? { icon: darkHero.icon, label: darkHero.label ? darkHero.label.text : darkHero.heading ? darkHero.heading.text : undefined, ...splitValue(darkHero.big.text), text: darkHero.items.join("\n") || undefined }
      : {};
    if (photo) panel.image = photo.ref;
    const side = cx(hp) > 6.67 ? "right" : undefined;
    const cards = rest.map(cardOf).concat(extra);
    const out = [];
    const first = cards.slice(0, 2);
    out.push(Object.assign({ type: "hero" }, base, { subtitle, panel, panel_side: side, cards: first }));
    for (let i = 2; i < cards.length; i += 3) out.push(Object.assign({ type: "cards" }, base, { title: base.title + " (تابع)", cards: cards.slice(i, i + 3) }));
    return out;
  }

  // tiles: boxes with a heading and one short text (numbered tiles too)
  const tileLike = all.length >= 2 && all.every((a) => !a.tag && !a.big && a.items.join(" ").length < 170 && (a.heading || a.small));
  if (tileLike && !extra.length && all.length <= 8) {
    const ts = all.sort((a, b) => byReading(a.p, b.p)).map(tileOf);
    const numberedTiles = ts.every((t, i) => t.number === String(i + 1).padStart(2, "0"));
    ts.forEach((t) => { if (numberedTiles) delete t.number; });
    const firstRow = all.filter((a) => Math.abs(a.p.y - all[0].p.y) < 0.1).length;
    return [Object.assign({ type: "tiles" }, base, { subtitle, numbered: numberedTiles || undefined, columns: ts.length === 4 && firstRow === 4 ? 4 : undefined, tiles: ts })];
  }

  // cards (default): up to 3 per slide
  const cards = all.sort((a, b) => byReading(a.p, b.p)).map(cardOf).concat(extra);
  if (!cards.length) return null;
  const out = [];
  for (let i = 0; i < cards.length; i += 3) out.push(Object.assign({ type: "cards" }, base, { title: base.title + (i ? " (تابع)" : ""), subtitle: i ? undefined : subtitle, cards: cards.slice(i, i + 3) }));
  return out;
}

// Gantt: a header row of month numbers 1..N, activity names to its right, bars in the grid.
function readGantt(shapes, texts) {
  const nums = texts.filter((t) => isNumTxt(t) && t.h < 0.6 && sizeOf(t) <= 12);
  const rows = [];
  for (const t of nums) { const r = rows.find((rr) => Math.abs(rr[0].y - t.y) < 0.08); r ? r.push(t) : rows.push([t]); }
  const header = rows.sort((a, b) => b.length - a.length)[0];
  if (!header || header.length < 6) return null;
  const months = header.map((t) => +t.text).sort((a, b) => a - b);
  if (months[0] !== 1 || months[months.length - 1] !== months.length) return null;
  const col = Object.fromEntries(header.map((t) => [+t.text, cx(t)]));
  const gridL = Math.min(...header.map((t) => t.x)), gridR = Math.max(...header.map((t) => t.x + t.w));
  const hy = header[0].y, hh = header[0].h;
  const bars0 = shapes.filter((x) => x.kind === "sp" && !x.text && x.fill && x.h < 0.35 && x.w >= 0.6 * (gridR - gridL) / months.length && x.w < (gridR - gridL) + 0.1 && cx(x) > gridL && cx(x) < gridR && x.y > hy);
  const names = texts.filter((t) => t.x >= gridR - 0.1 && t.y > hy + hh / 2 && bars0.some((b) => cy(b) >= t.y && cy(b) <= t.y + t.h));
  if (names.length < 2) return null;
  const headLabel = texts.find((t) => t.x >= gridR - 0.1 && Math.abs(t.y - hy) < 0.1 && !isNumTxt(t));
  const bars = bars0;
  const legend = shapes.filter((x) => x.kind === "sp" && !x.text && x.fill && x.w < 0.4 && x.h < 0.3 && x.y >= Math.max(...names.map((n) => n.y + n.h)) - 0.02);
  const catKey = {}, categories = {};
  const labels = [];
  for (const sw of legend) {
    const lab = texts.filter((t) => t.x + t.w <= sw.x + 0.05 && Math.abs(cy(t) - cy(sw)) < 0.15).sort((a, b) => b.x - a.x)[0];
    if (lab) labels.push(lab);
    const idx = PALETTE.indexOf((sw.fill || "").toUpperCase());
    catKey[(sw.fill || "").toUpperCase()] = { idx: idx < 0 ? 99 : idx, label: lab ? lab.text : "" };
  }
  const keys = Object.entries(catKey).sort((a, b) => a[1].idx - b[1].idx);
  keys.forEach(([hex, v], i) => { v.key = "c" + (i + 1); categories[v.key] = v.label; });
  const activities = [];
  for (const n of names.sort((a, b) => a.y - b.y)) {
    const bar = bars.find((b) => cy(b) >= n.y && cy(b) <= n.y + n.h);
    if (!bar) return null;
    const covered = months.filter((m) => col[m] >= bar.x - 0.05 && col[m] <= bar.x + bar.w + 0.05);
    if (!covered.length) return null;
    const c = catKey[(bar.fill || "").toUpperCase()];
    activities.push({ name: n.text, start: Math.min(...covered), end: Math.max(...covered), category: c ? c.key : undefined });
  }
  if (!activities.length || activities.length > 12) return null;
  const used = new Set([...header, ...names, ...labels, headLabel].filter(Boolean));
  const note = texts.filter((t) => !used.has(t)).map((t) => t.text).join("\n") || undefined;
  return { spec: { months: months.length, activity_label: headLabel ? headLabel.text : undefined, categories, activities, note } };
}

// ---------- whole deck ----------
function slideStrings(spec) {
  const out = [];
  const walk = (v, k) => {
    if (v == null) return;
    if (typeof v === "string") { if (!["type", "icon", "image", "category", "panel_side", "notes"].includes(k) && !/^media:/.test(v)) out.push(v); return; }
    if (typeof v === "number") { if (!["months", "start", "end", "source", "columns"].includes(k)) out.push(String(v)); return; }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, k));
    if (typeof v === "object") for (const [kk, vv] of Object.entries(v)) if (kk !== "column_widths") walk(vv, kk);
  };
  walk(spec);
  return out;
}

function convertDeck(ex, { mediaRef }) {
  const sections = [];
  const report = [];
  const timelines = {};
  const pictures = [];
  const ctx = { count: ex.slides.length, mediaRef };
  for (const s of ex.slides) {
    let res;
    try { res = convertSlide(s, ctx); } catch (e) { res = { picture: "error: " + e.message }; }
    if (res.slides) {
      // Self-check: the converted slide(s) must carry every word of the source slide.
      const src = new Set(tokens(s.texts.filter((t) => !CONST_TEXT.test(t)).join("\n")));
      const implicit = res.slides.flatMap((x) => (x.type === "tiles" && x.numbered ? x.tiles.map((_, i) => String(i + 1).padStart(2, "0")) : x.type === "process" ? x.steps.map((_, i) => String(i + 1).padStart(2, "0")) : x.type === "timeline" ? Array.from({ length: x.months || 0 }, (_, i) => String(i + 1)) : []));
      const got = new Set(tokens(res.slides.flatMap(slideStrings).concat(implicit).join("\n")));
      const missing = [...src].filter((w) => !got.has(w));
      if (missing.length > Math.max(0, src.size * 0.01)) res = { picture: `text would be lost (${missing.slice(0, 6).join(" ")})` };
    }
    let slides;
    if (res.slides) {
      slides = res.slides.map((x) => Object.assign({ source: s.n }, x));
      if (res.timeline) timelines[s.n] = res.timeline;
      report.push({ source: s.n, as: slides.map((x) => x.type).join("+") });
    } else {
      const title = (s.shapes.find((x) => x.text && x.y < 1.45) || {}).text || "";
      slides = [{ type: "picture", source: s.n, full: true, image: null, title, notes: [s.notes, s.texts.join("\n")].filter(Boolean).join("\n\n") }];
      pictures.push({ n: s.n, slide: slides[0] });
      report.push({ source: s.n, as: "picture", reason: res.picture });
    }
    const secName = s.section || (sections.length ? sections[sections.length - 1].title : "العرض");
    let sec = sections[sections.length - 1];
    if (!sec || sec.title !== secName) { sec = { title: secName, slides: [] }; sections.push(sec); }
    sec.slides.push(...slides);
  }
  const content = ex.slides.find((s) => !s.dark);
  const lt = content ? content.layoutTexts.filter((t) => t.y > 6.5) : [];
  const footer = (lt.find((t) => ARABIC.test(t.text)) || {}).text;
  const tagline = (lt.find((t) => !ARABIC.test(t.text)) || {}).text;
  return { spec: { title: ex.title || "", footer, tagline, sections }, report, timelines, pictures };
}

module.exports = { convertDeck, slideStrings, readGantt };
