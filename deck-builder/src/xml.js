// Minimal XML → tree parser, enough for OOXML parts. Node: { name, attrs, children: [node | string] }.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decode(m[3] ?? m[4] ?? "");
  return out;
}

function parseXml(s) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[6] !== undefined) { top.children.push(decode(m[6])); continue; }
    if (m[1] !== undefined) { top.children.push(m[1]); continue; }
    if (!m[3]) continue; // processing instruction or comment
    if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
    const node = { name: m[3], attrs: parseAttrs(m[4] || ""), children: [] };
    top.children.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}

const isNode = (c) => c && typeof c === "object";
const kids = (n, name) => (n ? n.children.filter((c) => isNode(c) && (!name || c.name === name)) : []);
const kid = (n, name) => kids(n, name)[0] || null;
function find(n, name) {
  if (!n) return null;
  for (const c of n.children) {
    if (!isNode(c)) continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return null;
}
function findAll(n, name, out = []) {
  if (!n) return out;
  for (const c of n.children) {
    if (!isNode(c)) continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
const textOf = (n) => (!n ? "" : n.children.map((c) => (isNode(c) ? textOf(c) : c)).join(""));

module.exports = { parseXml, kids, kid, find, findAll, textOf, decode };
