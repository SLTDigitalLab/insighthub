// Minimal XML reader for the WordprocessingML parts of a .docx (no dependency). Builds a tree whose nodes keep their
// character offsets in the source string, so a later step can edit the text in place without re-serialising the file.
//   element: { name, attrs, children, start, openEnd, closeStart, end, selfClosing }
//   text:    { name: '#text', text, start, end }
// Comments, processing instructions and CDATA are skipped. Entities in text are decoded by decode().

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parse(xml) {
  const root = { name: '#root', attrs: {}, children: [], start: 0, openEnd: 0 };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml)) !== null) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.children.push({ name: '#text', text: m[5], start: m.index, end: m.index + m[0].length });
    } else if (m[2]) {
      const closing = m[1] === '/';
      if (closing) {
        // Unbalanced input is closed leniently at the nearest matching open element
        let i = stack.length - 1;
        while (i > 0 && stack[i].name !== m[2]) i -= 1;
        if (i > 0) {
          stack[i].closeStart = m.index;
          stack[i].end = m.index + m[0].length;
          stack.length = i;
        }
      } else {
        const attrs = {};
        let a;
        ATTR.lastIndex = 0;
        while ((a = ATTR.exec(m[3] || '')) !== null) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3];
        const node = { name: m[2], attrs, children: [], start: m.index, openEnd: m.index + m[0].length, selfClosing: m[4] === '/' };
        top.children.push(node);
        if (node.selfClosing) {
          node.closeStart = node.end = node.openEnd;
        } else {
          stack.push(node);
        }
      }
    }
  }
  return root;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (e, dec, hex) => {
  if (dec) return String.fromCodePoint(Number(dec));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return ENTITIES[e.toLowerCase()] || e;
});

const childrenOf = (node, name) => (node.children || []).filter(c => c.name === name);
const child = (node, name) => (node.children || []).find(c => c.name === name) || null;
const textOf = node => (node.children || []).filter(c => c.name === '#text').map(c => decode(c.text)).join('');

module.exports = { parse, decode, child, childrenOf, textOf };
