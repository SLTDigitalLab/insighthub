const fs = require('fs');
const path = require('path');

// Raw-XML helpers for {@...} template tags: text -> escaped OOXML paragraphs, and product diagrams as inline images.
// esc / run / textPara / pngSize / imagePara were moved here unchanged from the old proposalBuilder.js.

const { paths, layout, diagrams } = require('../proposal/renderSettings');

const DIAGRAM_DIR = paths.diagramDir;

// wp:docPr ids must be unique in the document. Returns a function giving the next free id for this package: counting up from
// above the highest id already in any word/*.xml part (shared by the diagrams and the logo, so they never repeat).
const idCounters = new WeakMap();
function nextDocPrId(zip) {
  if (!idCounters.has(zip)) {
    let max = 0;
    Object.keys(zip.files).filter(n => /^word\/[^/]+\.xml$/.test(n)).forEach(n => {
      (zip.file(n).asText().match(/<(?:wp:docPr|pic:cNvPr)[^>]*?\sid="(\d+)"/g) || []).forEach(m => { max = Math.max(max, Number(/id="(\d+)"/.exec(m)[1])); });
    });
    idCounters.set(zip, max);
  }
  const next = idCounters.get(zip) + 1;
  idCounters.set(zip, next);
  return next;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Escapes text before putting it into raw Word XML
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // PNG width/height are stored at bytes 16-23 of the file header
}

function textPara(runsXml, { before = 120, after = 60, keepNext = false, keepLines = false } = {}) {
  return `<w:p><w:pPr><w:pStyle w:val="${layout.bodyStyle}"/>${keepNext ? '<w:keepNext/>' : ''}${keepLines ? '<w:keepLines/>' : ''}<w:widowControl/><w:spacing w:before="${before}" w:after="${after}"/><w:ind w:left="${layout.captionIndentLeft}" w:right="${layout.captionIndentRight}"/><w:jc w:val="both"/></w:pPr>${runsXml}</w:p>`;
  // One body-text paragraph
}

function run(text, { bold = false, color = null } = {}) {
  return `<w:r><w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  // One piece of text, optionally bold/coloured
}

// Paragraph properties of a picture paragraph written by the upload when it creates the requirements loop
function picturePPr() {
  return `<w:pPr><w:keepLines/><w:spacing w:before="${layout.captionSpacing.first}" w:after="${layout.diagram.spacingAfter}"/><w:jc w:val="center"/></w:pPr>`;
}

// pPrXml: the paragraph properties to use (a '<w:pPr>…</w:pPr>' string, '' for none); the settings' picture layout when omitted
function imagePara(rId, docPrId, name, size, isFirstProduct = false, pPrXml, limits) {
  // limits = { maxCx, maxCy } for a diagram the rep uploaded (fitted to the text width); the settings' layout otherwise
  const maxCx = limits ? limits.maxCx : layout.diagram.maxWidth;
  const maxCy = limits ? limits.maxCy : (isFirstProduct ? layout.diagram.maxHeightFirst : layout.diagram.maxHeight);

  let cx = maxCx;
  let cy = Math.round(cx * size.h / size.w);
  if (cy > maxCy) {
    cy = maxCy;
    cx = Math.round(cy * size.w / size.h);
  }

  const pPr = pPrXml !== undefined ? pPrXml : `<w:pPr><w:keepLines/><w:spacing w:before="${layout.captionSpacing.first}" w:after="${isFirstProduct ? layout.diagram.spacingFirstAfter : layout.diagram.spacingAfter}"/><w:jc w:val="center"/></w:pPr>`;
  return `<w:p>${pPr}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${esc(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${esc(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// Plain text from the edit form -> OOXML paragraphs (justified).
//   every non-blank line = its own paragraph (a line break is never used inside a justified paragraph)
//   "- " line            = bullet (its own paragraph)
// Nothing is interpreted as markup: everything goes through esc().
function textToOoxml(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const paras = lines.map(line => {
    const bullet = /^-\s+(.*)$/.exec(line);
    if (bullet) return `<w:p><w:pPr><w:spacing w:before="${layout.bullet.spacing}" w:after="${layout.bullet.spacing}"/><w:ind w:left="${layout.bullet.indentLeft}" w:hanging="${layout.bullet.hanging}"/><w:jc w:val="both"/></w:pPr><w:r><w:t>${layout.bullet.symbol}</w:t></w:r><w:r><w:tab/></w:r>${run(bullet[1])}</w:p>`;
    return `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run(line)}</w:p>`;
  });
  return paras.join('') || '<w:p/>';
}

// Bold, left-aligned title paragraph of a numbered item ("1. Product name"); the description that follows is a normal justified paragraph.
function titlePara(text) {
  return `<w:p><w:pPr><w:keepNext/><w:spacing w:before="${layout.titleSpacing.before}" w:after="${layout.titleSpacing.after}"/><w:jc w:val="left"/></w:pPr>${run(text, { bold: true })}</w:p>`;
}

// blocks: [{ title } | { text }] -> OOXML. A title block is bold and left-aligned; a text block goes through textToOoxml.
function blocksToOoxml(blocks) {
  return (blocks || []).map(b => (b.title ? titlePara(b.title) : (String(b.text || '').trim() ? textToOoxml(b.text) : ''))).join('') || '<w:p/>';
}

// The product terms as bullet paragraphs. fmt = { pPr, rPr } read from the template's own first generic terms paragraph when
// the template was stored; without it the settings' bullet layout is used. No items -> '' (not even an empty paragraph).
function termsXml(items, fmt) {
  return (items || []).map(text => {
    if (fmt && fmt.pPr) return `<w:p>${fmt.pPr}<w:r>${fmt.rPr || ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    return `<w:p><w:pPr><w:spacing w:before="${layout.bullet.spacing}" w:after="${layout.bullet.spacing}"/><w:ind w:left="${layout.bullet.indentLeft}" w:hanging="${layout.bullet.hanging}"/><w:jc w:val="both"/></w:pPr><w:r><w:t>${layout.bullet.symbol}</w:t></w:r><w:r><w:tab/></w:r>${run(text)}</w:p>`;
  }).join('');
}

// The diagram file of a product, from its `diagram` field in products.json; null when it has none or the file is missing.
function diagramPath(product) {
  if (!product || !product.diagram) return null;
  const file = path.join(DIAGRAM_DIR, path.basename(product.diagram));
  return fs.existsSync(file) ? file : null;
}

// Adds the product's diagram PNG (and its relationship / content type) to the package. Returns { rId, n, size } or null when
// the product has no usable diagram. Numbers are per package, so the {@diagramsXml} block and the requirements loop never clash.
const diagramCounters = new WeakMap();
// Usable text width of the document (EMU): its last section's page width minus margins; null when it cannot be read
function textWidthOf(zip) {
  const f = zip.file('word/document.xml');
  const all = f ? f.asText().match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) : null;
  if (!all) return null;
  const s = all[all.length - 1];
  const num = re => { const m = re.exec(s); return m ? Number(m[1]) : null; };
  const w = num(/<w:pgSz\b[^>]*w:w="(\d+)"/);
  if (!w) return null;
  return (w - (num(/<w:pgMar\b[^>]*w:left="(\d+)"/) || 0) - (num(/<w:pgMar\b[^>]*w:right="(\d+)"/) || 0)) * 635;
}

function addDiagram(zip, product) {
  let buf, size, ext = 'png', limits;
  if (product && product._image) {
    // a diagram the rep uploaded (override or product default): PNG / JPEG, fitted to the text width
    ({ buf, ext } = product._image);
    size = { w: product._image.w, h: product._image.h };
    const width = textWidthOf(zip);
    limits = { maxCx: width ? Math.round(width * diagrams.textWidthShare) : layout.diagram.maxWidth, maxCy: diagrams.maxHeight };
  } else {
    const file = diagramPath(product);
    if (!file) return null;
    buf = fs.readFileSync(file);
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null; // PNG only
    size = pngSize(buf);
  }
  const n = (diagramCounters.get(zip) || 0) + 1;
  diagramCounters.set(zip, n);
  const mediaName = `ih_diagram_${n}.${ext}`;
  const rId = `rIdIHD${n}`;
  zip.file(`word/media/${mediaName}`, buf);
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = zip.file(relsPath) ? zip.file(relsPath).asText() : '';
  if (rels && !rels.includes(`Id="${rId}"`)) {
    zip.file(relsPath, rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`));
  }
  const ctPath = '[Content_Types].xml';
  const ct = zip.file(ctPath) ? zip.file(ctPath).asText() : '';
  if (ct && !new RegExp(`Extension="${ext}"`, 'i').test(ct)) {
    zip.file(ctPath, ct.replace('<Default ', `<Default Extension="${ext}" ContentType="image/${ext}"/><Default `));
  }
  return { rId, n, size, limits };
}

// One inline image per selected product that has a diagram, each with the product name above it.
// Products without a diagram are skipped (nothing is inserted for them).
function diagramsXml(zip, products) {
  let xml = '';
  let count = 0;
  (products || []).forEach(product => {
    const d = addDiagram(zip, product);
    if (!d) return;
    count += 1;
    xml += textPara(run(product.name, { bold: true, color: layout.captionColor }), { before: d.n === 1 ? layout.captionSpacing.first : layout.captionSpacing.next, keepNext: true, keepLines: true });
    xml += imagePara(d.rId, nextDocPrId(zip), `${product.name} diagram`, d.size, d.n === 1, undefined, d.limits);
  });
  return count ? xml : '<w:p/>';
}

// The picture of ONE product for the {@diagram} tag of the requirements loop. '' when the product has none: docxtemplater
// then drops the whole paragraph that holds the tag. fmt = the template's own picture paragraph, as captured when the template
// was stored ({ pPr }).
function diagramParagraph(zip, product, fmt) {
  const d = addDiagram(zip, product);
  if (!d) return '';
  return imagePara(d.rId, nextDocPrId(zip), `${product.name} diagram`, d.size, d.n === 1, fmt ? fmt.pPr : undefined, d.limits);
}

module.exports = { nextDocPrId, esc, run, textPara, pngSize, imagePara, textToOoxml, blocksToOoxml, titlePara, termsXml, diagramPath, diagramsXml, diagramParagraph, picturePPr };
