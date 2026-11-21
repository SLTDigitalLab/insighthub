const PizZip = require('pizzip');
const { buildOutline } = require('./templateOutlineService');
const { pPrWith, rPrWith } = require('./ooxmlFormat');
const { ITEM_LOOP } = require('../proposal/fieldSchema');
const { terms, outline: outlineSettings } = require('../proposal/renderSettings');

// Formatting of the template's own paragraphs that generated content has to keep.
// docxtemplater replaces the whole paragraph that holds a raw {@tag} with the XML it is given, so the paragraph's own
// alignment and spacing are lost unless the generated XML carries them. They are read from the template here and stored
// with the template version (templateStoreService), never written in code.
//
//   diagram: the paragraph that holds {@diagram} (the picture of one product in the {#requirements} loop)
//     { pPr }   the paragraph properties of that paragraph. (docxtemplater only accepts a raw tag that is alone in its
//               paragraph, so a template with other text next to {@diagram} is refused when it is uploaded.)
//   terms: the first paragraph under the Terms and Conditions heading (the template's own generic bullets)
//     { pPr, rPr }  its list style / indent / spacing (numbering kept) and the look of its text. The product terms are
//                   written with the same formatting so they read as part of the same list.
//                   Left out when the template has no such heading or no paragraph under it.
function captureFormats(buffer) {
  try {
    const outline = buildOutline(buffer);
    const zip = new PizZip(buffer);
    const out = {};
    const xmlOf = p => zip.file(outline.files[p.ref.split('.')[0]]).asText();
    const alone = outline.paragraphs.find(p => p.text.trim() === `{@${ITEM_LOOP.pictureColumn}}`);
    if (alone) out.diagram = { pPr: alone.pPrInfo ? pPrWith(xmlOf(alone).slice(alone.pPrInfo.start, alone.pPrInfo.end)) : '' };
    const termsFormat = captureTerms(outline, xmlOf);
    if (termsFormat) out.terms = termsFormat;
    return out;
  } catch (err) {
    return {};
  }
}

const isHeading = p => p.outlineLevel !== undefined && p.outlineLevel < outlineSettings.bodyTextLevel;

function captureTerms(outline, xmlOf) {
  const heading = new RegExp(terms.headingPattern, 'i');
  const at = outline.paragraphs.findIndex(p => isHeading(p) && heading.test(p.text));
  if (at === -1) return null;
  // the first LIST paragraph with text under the heading (the template's generic bullets); a template without a list there uses
  // its first paragraph with text. Tag paragraphs and sub-headings above the list are not samples.
  const under = [];
  for (let i = at + 1; i < outline.paragraphs.length; i += 1) {
    const p = outline.paragraphs[i];
    if (isHeading(p)) break;
    if (p.text.trim() && !p.text.trim().startsWith('{') && p.pPrInfo) under.push(p);
  }
  const isList = p => /<w:numPr>/.test(xmlOf(p).slice(p.pPrInfo.start, p.pPrInfo.end));
  const p = under.find(isList) || under[0];
  if (p) {
    const xml = xmlOf(p);
    const run = p.runs.find(r => !r.hidden && r.text.trim());
    return {
      pPr: pPrWith(xml.slice(p.pPrInfo.start, p.pPrInfo.end), { keepList: true }),
      rPr: run && run.rPrNode ? rPrWith(xml.slice(run.rPrNode.start, run.rPrNode.end)) : '',
    };
  }
  return null;
}

module.exports = { captureFormats };
