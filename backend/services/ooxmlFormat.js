const { parse } = require('./ooxmlTree');

// Small helpers to copy and adjust the formatting (paragraph properties w:pPr, run properties w:rPr) of a template paragraph.
// Word wants the children of these elements in a fixed order, so they are always rebuilt in that order.

const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs',
  'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
  'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl',
  'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof',
  'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText',
  'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

const local = name => name.replace(/^w:/, '');

// children of a <w:pPr>/<w:rPr> source string as [{ name, xml }]
function childrenOf(src) {
  if (!src) return [];
  const root = parse(src).children.find(c => c.name !== '#text');
  if (!root || root.selfClosing) return [];
  return root.children.filter(c => c.name !== '#text').map(c => ({ name: local(c.name), xml: src.slice(c.start, c.end) }));
}

function rebuild(tag, order, kids) {
  const idx = n => { const i = order.indexOf(n); return i === -1 ? order.length : i; };
  const sorted = kids.map((k, n) => ({ ...k, n })).sort((a, b) => (idx(a.name) - idx(b.name)) || (a.n - b.n));
  return `<w:${tag}>${sorted.map(k => k.xml).join('')}</w:${tag}>`;
}

// pPrXml: a '<w:pPr>…</w:pPr>' string or ''. Options:
//   jc 'left'|'both'|'center'|...   set the alignment;  keepNext / keepLines: add;  dropStyle: remove the paragraph style
// Always removed: section break, numbering, outline level, page-break-before and the paragraph-mark run properties, because
// a copy of a paragraph must not start a section, a list entry, a contents entry or a new page.
// keepList: a list item's copy keeps its numbering (w:numPr) and the paragraph-mark run properties (the bullet's own look)
function pPrWith(pPrXml, { jc, keepNext, keepLines, dropStyle, keepList } = {}) {
  const drop = new Set(['sectPr', 'outlineLvl', 'pageBreakBefore', 'pPrChange', ...(keepList ? [] : ['numPr', 'rPr']), ...(dropStyle ? ['pStyle'] : []), ...(jc ? ['jc'] : []), ...(keepNext ? ['keepNext'] : []), ...(keepLines ? ['keepLines'] : [])]);
  const kids = childrenOf(pPrXml).filter(k => !drop.has(k.name));
  if (jc) kids.push({ name: 'jc', xml: `<w:jc w:val="${jc}"/>` });
  if (keepNext) kids.push({ name: 'keepNext', xml: '<w:keepNext/>' });
  if (keepLines) kids.push({ name: 'keepLines', xml: '<w:keepLines/>' });
  return kids.length ? rebuild('pPr', PPR_ORDER, kids) : '';
}

// rPrXml: a '<w:rPr>…</w:rPr>' string or ''. bold: make it bold.
function rPrWith(rPrXml, { bold } = {}) {
  const kids = childrenOf(rPrXml).filter(k => !(bold && (k.name === 'b' || k.name === 'bCs')));
  if (bold) { kids.push({ name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }); }
  return kids.length ? rebuild('rPr', RPR_ORDER, kids) : '';
}

module.exports = { pPrWith, rPrWith };
