const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const store = require('./templateStoreService');
const { applyPlaceholderColours } = require('./placeholderColourService');
const { tidyContents } = require('./contentsTidyService');
const { dataFor, removeEmptyLoopTables } = require('./solutionRenderService');
const { buildSchema, flattenTags, applyReference } = require('./solutionSchemaService');
const { diagramsXml } = require('./ooxml');
const { prepareClientLogo, applyClientLogo } = require('./logoService');
const { resolveForRender: resolveDiagrams } = require('./diagramService');
const { PRODUCT_BY_ID } = require('./productCatalog');
const { files } = require('../proposal/renderSettings');

// Fills the stored PRODUCT + SOLUTION template with the (edited) values. Same idea as solutionRenderService: the data is built from the
// template's own tags (text -> string, raw XML -> paragraphs, loop -> rows), so no tag name, heading or table layout is written here.
// The layout comes only from the template.
//
// Two things a text value cannot carry are picture-based, and are decided by the AI workflow at generation time, not by this code:
//   fields.__meta.diagramTags : the raw-XML tags that hold the network diagrams of the selected products (the workflow names them from the
//                               tag's context); they are filled with the diagrams of the proposal's products (ooxml.diagramsXml)
//   fields.__meta.leadLogo    : a logo (none is looked up in this flow; an older proposal keeps its own) for the template's {%client_logo} picture (logoService), when it has one
// __meta is not a template tag: the edit screen never shows it and it is kept as it is when the proposal is saved.

const META_KEY = '__meta';
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clean = v => (v == null ? '' : String(v));

function describe(err) {
  const errs = err && err.properties && Array.isArray(err.properties.errors) ? err.properties.errors : [err];
  return errs.map(e => (e.properties && e.properties.explanation) || e.message).join('; ');
}

// file: the template .docx buffer. tags: its tag list. fields: the values keyed by tag (+ __meta). products: [{ id, name }] of the proposal.
// Returns the filled .docx buffer.
async function fill(file, tags, fields, { products = [], label = '' } = {}) {
  const fail = message => Object.assign(new Error(message), { status: 500 });
  const meta = isObj(fields && fields[META_KEY]) ? fields[META_KEY] : {};
  const values = { ...(fields || {}) };
  delete values[META_KEY];
  try {
    const zip = new PizZip(file);
    applyPlaceholderColours(zip); // placeholder runs take their colour from the label next to them (see placeholderColourService.js)
    const flat = flattenTags(tags);
    const main = zip.file('word/document.xml');
    if (main) {
      const xml = main.asText();
      const next = removeEmptyLoopTables(xml, flat, values);
      if (next !== xml) zip.file('word/document.xml', next);
    }
    // {%client_logo} text tags become logo pictures before docxtemplater reads the template (a template without one is fine)
    const logoCtx = await prepareClientLogo(zip, clean(meta.leadLogo), meta.leadLogoSize, label);
    const data = dataFor(flat, values);
    const diagramTags = new Set(Array.isArray(meta.diagramTags) ? meta.diagramTags.map(String) : []);
    if (diagramTags.size) {
      const chosen = (products || []).map(p => PRODUCT_BY_ID[p && p.id]).filter(Boolean);
      const images = await resolveDiagrams({ requirements: chosen.map(p => ({ id: p.id })) }); // stored default pictures, as the product flow uses
      const xml = diagramsXml(zip, chosen.map(p => (images[p.id] ? { ...p, _image: images[p.id] } : p)));
      flat.filter(t => t.type === 'rawXml' && diagramTags.has(t.name)).forEach(t => { data[t.name] = xml; });
    }
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '', errorLogging: false });
    doc.render(data);
    await applyClientLogo(doc.getZip(), logoCtx);
    // one table of contents, no blank entries (contentsTidyService.js); the PDF conversion updates its page numbers
    return tidyContents(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })).buffer;
  } catch (err) {
    throw fail(`Could not fill the template: ${describe(err)}`);
  }
}

// format: 'docx' | 'pdf'. Returns { buffer, baseName, entry }.
// refNo = the proposal's own reference ('' when it has none), printed by the template's reference placeholder; left alone when not given.
async function render({ templateId, fields, companyName, products = [], format = 'docx', refNo }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  // The version the proposal was made with; when it is gone (deleted / replaced) or is not a Product + Solution template, the current
  // ACTIVE Product + Solution template is used instead (a warning is logged, the user sees nothing)
  const usable = e => !!e && e.type === store.PS_TYPE && !!store.readFile(e.id);
  let entry = templateId ? store.get(templateId) : null;
  if (!usable(entry)) {
    if (templateId) console.warn(`[productSolutionRender] template version ${templateId} not found; using the active Product + Solution template`);
    entry = store.getActive(store.PS_TYPE);
  }
  if (!usable(entry)) throw fail(409, 'There is no active Product + Solution template. Upload one first.');
  const file = store.readFile(entry.id);
  if (!isObj(fields)) throw fail(400, 'fields are required');
  const withRef = refNo === undefined ? fields : applyReference(buildSchema(entry.tags), fields, refNo, false, true);
  const docx = await fill(file, entry.tags, withRef, { products, label: `v${entry.version}` });
  const baseName = `${files.namePrefix}ProductSolution_${clean(companyName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'Draft'}`;
  return { buffer: format === 'pdf' ? await require('./pdfService').docxToPdf(docx) : await require('./pdfService').refreshContents(docx), baseName, entry };
}

module.exports = { META_KEY, render, fill };
