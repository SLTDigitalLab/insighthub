const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const pdfParse = require('pdf-parse');
const store = require('./templateStoreService');
const { applyPlaceholderColours } = require('./placeholderColourService');
const { tidyContents } = require('./contentsTidyService');
const { PRODUCT_BY_ID } = require('./productCatalog');
const { textToOoxml, blocksToOoxml, termsXml, diagramsXml, diagramParagraph } = require('./ooxml');
const { splitItems, dedupe, termsRows } = require('./termsService');
const { captureFormats } = require('./templateFormats');
const { prepareClientLogo, applyClientLogo } = require('./logoService');
const { resolveForRender: resolveDiagrams } = require('./diagramService');
const { docxToPdf } = require('./pdfService');
const { BY_KEY, FIELDS, CHIP_SECTIONS, TERMS_LOOP } = require('../proposal/fieldSchema');
const { wording, files } = require('../proposal/renderSettings');

// Last step: fill a stored template version with the (edited) `fields` of the edit screen.
// The template is used exactly as stored (no XML rewriting at render time). Which schema field fills which {tag} comes from
// the template version's `bindings` (proposal/autoBind.js); tag and field names are not written in this file.

const clean = v => (v == null ? '' : String(v));
const trimmed = v => clean(v).trim();

// Added to the bold title of a recommended product the rep ticked
const PRIORITY_SUFFIX = wording.prioritySuffix;

function money(v) {
  const s = trimmed(v);
  if (!s) return '';
  const n = Number(s.replace(/,/g, ''));
  return Number.isNaN(n) ? s : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const asRows = v => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : []);

// Content of a composed tag as blocks: { title } = bold left-aligned item title, { text } = justified paragraph(s).
function composeBlocks(binding, fields) {
  const f = k => trimmed(fields[k]);
  switch (binding.how) {
    case 'paragraphs':
      return binding.fields.map(f).filter(Boolean).map(text => ({ text }));
    case 'join':
      return [{ text: binding.fields.map(k => f(k).replace(/,+$/, '')).filter(Boolean).join(', ') }];
    case 'requirements':
      return asRows(fields.requirements).flatMap((r, i) => [{ title: wording.itemTitle(i + 1, trimmed(r.title)) }, { text: trimmed(r.text) }]);
    case 'about':
      return [
        { text: f('aboutDescription') },
        ...asRows(fields.recommendations).filter(r => PRODUCT_BY_ID[r.id]).flatMap((r, i) => [
          { title: `${wording.itemTitle(i + 1, PRODUCT_BY_ID[r.id].name)}${r.highPriority ? PRIORITY_SUFFIX : ''}` },
          { text: trimmed(r.reason) },
        ]),
      ];
    default:
      return [];
  }
}

// Plain-text version for a tag that is not raw XML (titles and paragraphs on separate lines)
const blocksToText = blocks => blocks.map(b => b.title || b.text || '').filter(Boolean).join('\n');

async function buildData(entry, fields, zip, products, formats = {}, diagrams = {}) {
  const data = {};
  // a product's own picture: the rep's upload / stored default when there is one (services/diagramService.js)
  const withImage = p => (p && diagrams[p.id] ? { ...p, _image: diagrams[p.id] } : p);
  for (const tag of entry.tags) {
    const binding = (entry.bindings || {})[tag.name];
    const cell = (type, v) => (type === 'rawXml' ? textToOoxml(v) : clean(v));
    if (!binding || binding.kind === 'none') {
      data[tag.name] = tag.type === 'loop' ? [] : (tag.type === 'rawXml' ? '<w:p/>' : '');
    } else if (binding.kind === 'loop') {
      const field = BY_KEY[binding.field];
      const defOf = c => { const col = binding.columns && binding.columns[c.name]; return { col, def: field && (field.columns || []).find(x => x.key === col) }; };
      // a row is used when one of its stored columns has a value (the computed number / diagram do not count); a field with
      // required columns (the product terms) prints only the rows where every required column has a value
      const required = ((field && field.columns) || []).filter(c => c.required);
      const used = asRows(fields[binding.field])
        .filter(row => required.every(c => trimmed(row[c.key])))
        .filter(row => (tag.children || []).some(c => { const { col, def } = defOf(c); return col && !(def && def.computed) && trimmed(row[col]); }));
      data[tag.name] = used.map((row, i) => Object.fromEntries((tag.children || []).map(c => {
        const { col, def } = defOf(c);
        if (def && def.computed === 'index') return [c.name, String(i + 1)];
        // the product's own picture; '' when it has none, which makes docxtemplater drop the paragraph that holds the tag
        if (def && def.computed === 'diagram') return [c.name, diagramParagraph(zip, withImage(PRODUCT_BY_ID[row.id]), formats.diagram)];
        const raw = col ? row[col] : '';
        return [c.name, cell(c.type, def && def.format === 'money' ? money(raw) : raw)];
      })));
    } else if (binding.kind === 'diagrams') {
      data[tag.name] = diagramsXml(zip, products.map(withImage));
    } else if (binding.kind === 'compose' && binding.how === 'terms') {
      // older block form: the sentences of every product's terms (as edited on the edit screen) as one bullet list, duplicates removed
      const items = dedupe(asRows(fields[binding.fields[0]]).flatMap(r => splitItems(r.terms)));
      data[tag.name] = tag.type === 'rawXml' ? termsXml(items, formats.terms) : items.join('\n');
    } else if (binding.kind === 'compose') {
      const blocks = composeBlocks(binding, fields);
      data[tag.name] = tag.type === 'rawXml' ? blocksToOoxml(blocks) : blocksToText(blocks);
    } else {
      data[tag.name] = cell(tag.type, fields[binding.field]);
    }
  }
  return data;
}

function describe(err) {
  const errs = err && err.properties && Array.isArray(err.properties.errors) ? err.properties.errors : [err];
  return errs.map(e => (e.properties && e.properties.explanation) || e.message).join('; ');
}

// Products of the proposal = the requirement rows (one per selected product)
const productsOf = fields => asRows(fields.requirements).map(r => PRODUCT_BY_ID[r.id]).filter(Boolean);

// Fills a template file with `fields`. entry = { tags, bindings } of that template. Returns the .docx buffer.
const formatCache = new Map(); // template version id -> formats, for versions stored before formats were kept
async function fillTemplate(file, entry, rawFields) {
  // a proposal saved before the product terms existed (or in an older form) takes them from the selected products
  const fields = Array.isArray(rawFields[TERMS_LOOP]) ? rawFields : { ...rawFields, [TERMS_LOOP]: termsRows(productsOf(rawFields)) };
  const zip = new PizZip(file);
  applyPlaceholderColours(zip); // placeholder runs take their colour from the label next to them (see placeholderColourService.js)
  let formats = entry.formats;
  if (!formats) {
    formats = entry.id && formatCache.has(entry.id) ? formatCache.get(entry.id) : captureFormats(file);
    if (entry.id) formatCache.set(entry.id, formats);
  }
  // {%client_logo} text tags become logo pictures before docxtemplater reads the template
  const logoCtx = await prepareClientLogo(zip, fields.leadLogo, fields.leadLogoSize, entry.version ? `v${entry.version}` : (entry.id || ''));
  const data = await buildData(entry, fields, zip, productsOf(fields), formats, await resolveDiagrams(fields));
  try {
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '', errorLogging: false });
    doc.render(data);
    // client logo: the template's {%client_logo} pictures (replaced after filling, so every output comes from this one document)
    await applyClientLogo(doc.getZip(), logoCtx);
    // one table of contents, no blank entries (contentsTidyService.js); the PDF conversion updates its page numbers
    return tidyContents(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })).buffer;
  } catch (err) {
    throw Object.assign(new Error(`Could not fill the template: ${describe(err)}`), { status: 500 });
  }
}

// format: 'docx' | 'pdf'. Returns { buffer, baseName, entry }.
async function render({ templateId, fields, format = 'docx' }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const entry = templateId ? store.get(templateId) : store.getActive();
  if (!entry) throw fail(templateId ? 404 : 409, templateId ? 'Template version not found' : 'There is no active proposal template. Activate a template version first.');
  const file = store.readFile(entry.id);
  if (!file) throw fail(404, 'Template file is missing on the server');
  if (!fields || typeof fields !== 'object') throw fail(400, 'fields are required');

  const buffer = await fillTemplate(file, entry, fields);

  const company = trimmed(fields.companyName);
  const baseName = `${files.namePrefix}${company.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'Draft'}`;
  if (format === 'pdf') return { buffer: await docxToPdf(buffer), baseName, entry };
  // the Word file gets its table of contents rebuilt with this document's page numbers (a PDF does it in its own conversion)
  return { buffer: await require('./pdfService').refreshContents(buffer), baseName, entry };
}

// ---- Preview chips: which PDF page does each section start on? ---------------------------------------------------------
// A section is located by the text of its first filled field that the template actually shows; if that text is not found
// in the rendered PDF the section has no page (its chip is hidden). No heading text is searched for.

const norm = s => clean(s).replace(/[^a-z0-9]/gi, '').toUpperCase();

function boundFieldKeys(entry) {
  const keys = new Set();
  Object.values(entry.bindings || {}).forEach(b => {
    if (b.kind === 'field' || b.kind === 'loop') keys.add(b.field);
    if (b.kind === 'compose') b.fields.forEach(k => keys.add(k));
  });
  return keys;
}

// Text of a field's value that can be searched for in the PDF: the first line of a text field; for a table the longest
// cell of its first row (a product name alone also appears in the letter and elsewhere, a description does not)
function anchorText(field, value) {
  if (field.type === 'table') {
    const row = asRows(value)[0];
    if (!row) return '';
    return (field.columns || []).map(c => c.key).filter(k => k !== 'id' && typeof row[k] === 'string')
      .map(k => trimmed(row[k])).sort((a, b) => b.length - a.length)[0] || '';
  }
  return trimmed(value).split(/\n/).map(s => s.trim()).find(Boolean) || '';
}

// Sections are searched in the order of CHIP_SECTIONS (the order of the document), each one after the page of the previous
// section that was found, so a product name that also appears in the letter cannot pull a later section back.
async function sectionPages(pdf, entry, fields) {
  const texts = [];
  await pdfParse(pdf, {
    pagerender: page => page.getTextContent().then(tc => {
      const t = norm(tc.items.map(it => it.str).join(''));
      texts.push(t);
      return t;
    }),
  });
  const bound = boundFieldKeys(entry);
  const pages = {};
  let last = 0; // page number (1-based) of the last section found
  CHIP_SECTIONS.forEach((section, n) => {
    const anchors = FIELDS.filter(f => f.section === section && f.type !== 'image' && bound.has(f.key))
      .map(f => norm(anchorText(f, fields[f.key])).slice(0, 60))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    pages[section] = 0;
    if (!anchors.length) return;
    // the cover is searched from page 1; every other section after the previous section's page (at least page 2)
    const from = n === 0 ? 0 : Math.max(last, 1);
    const idx = texts.findIndex((t, k) => k >= from && t.includes(anchors[0]));
    if (idx !== -1) { pages[section] = idx + 1; last = idx + 1; }
  });
  return pages;
}

module.exports = { render, fillTemplate, sectionPages, productsOf };
