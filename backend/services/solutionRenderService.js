const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const store = require('./templateStoreService');
const { applyPlaceholderColours } = require('./placeholderColourService');
const { tidyContents } = require('./contentsTidyService');
const { textToOoxml } = require('./ooxml');
const structured = require('./structuredTextService');
const { prepareClientLogo, applyClientLogo } = require('./logoService');
const { docxToPdf } = require('./pdfService');
const { GROUP_FLAG, buildSchema, flattenTags, applyReference } = require('./solutionSchemaService');
const { files } = require('../proposal/renderSettings');

// Fills a stored SOLUTION template with the (edited) tag values. Generic: the data is built from the template's own tags
// (text -> string, raw XML -> paragraphs, loop -> rows), so no tag name is written here. The product renderer is not involved.

const clean = v => (v == null ? '' : String(v));
// not a template tag: the proposal's picture settings (customer logo) ride along in the fields under this key, as in the Product + Solution flow
const META_KEY = '__meta';

// Money at render time only (stored values are never changed). In a table cell a plain number that has decimals or is 1000 or
// more prints as 1,234.50. In a plain text tag (decimalsOnly) only a number WITH decimals does, so a whole number such as a year
// (2026) stays as it is. Small integers (a quantity), "-", "N/A", numbers with a leading zero and text always stay as they are.
function formatMoney(v, decimalsOnly = false) {
  const s = clean(v).trim();
  const t = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t) || /^-?0\d/.test(t)) return clean(v);
  const n = Number(t);
  if (!(t.includes('.') || (!decimalsOnly && Math.abs(n) >= 1000))) return clean(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataFor(tags, values, inLoop = false) {
  const src = values && typeof values === 'object' ? values : {};
  const data = {};
  (tags || []).forEach(tag => {
    const v = src[tag.name];
    if (tag.type === 'loop') {
      const rows = Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [];
      data[tag.name] = rows.map(row => ({ ...dataFor(tag.children, row, true), [GROUP_FLAG]: row[GROUP_FLAG] === true }));
    } else if (tag.type === 'rawXml') {
      // a structured block (introduction + items) is turned into paragraphs here, from its text; plain text prints as it always did
      data[tag.name] = structured.isStructured(v) ? structured.toXml(v) : textToOoxml(v);
    } else {
      data[tag.name] = formatMoney(v, !inLoop);
    }
  });
  return data;
}

// ---- A loop with no rows takes its table (and the heading above it) with it ---------------------------------------------------
// Done on the template XML before it is filled, so an empty "Optional items" section disappears instead of printing a header-only
// table. Only a body-level table whose tags all belong to the empty loop is removed (a table that also holds other tags is kept),
// and only a heading paragraph (heading style / outline level, or keep-with-next + all bold) with no tags in it goes with it.
const TAG_RE = /\{[#/@^]?[A-Za-z_][\w.]*\}/g;
const textOf = s => s.replace(/<[^>]+>/g, '');
const tagName = t => t.replace(/^\{[#/@^]?|\}$/g, '');

function outermostTables(xml) {
  const out = [];
  const re = /<w:tbl[ >]|<\/w:tbl>/g;
  let m; let depth = 0; let start = 0;
  while ((m = re.exec(xml))) {
    if (m[0] !== '</w:tbl>') { if (depth === 0) start = m.index; depth += 1; } else { depth -= 1; if (depth === 0) out.push([start, m.index + m[0].length]); }
  }
  return out;
}

function isHeadingParagraph(p) {
  const text = textOf(p).trim();
  if (!text || text.length > 120 || (text.match(TAG_RE) || []).length || p.includes('<w:sectPr') || p.includes('<w:drawing') || (p.match(/<\/w:p>/g) || []).length !== 1) return false;
  const style = (/<w:pStyle w:val="([^"]+)"/.exec(p) || [])[1] || '';
  if (/^(heading|title|subtitle)/i.test(style) || p.includes('<w:outlineLvl')) return true;
  const runs = p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
  const boldRun = r => /<w:b\/>|<w:b w:val="(1|true|on)"\/>/.test(r);
  return p.includes('<w:keepNext/>') && runs.filter(r => textOf(r).trim()).every(boldRun);
}

const namesOf = tag => [tag.name, ...((tag.children || []).flatMap(namesOf))];

function removeEmptyLoopTables(xml, tags, values) {
  const src = values && typeof values === 'object' ? values : {};
  const empty = (tags || []).filter(t => t.type === 'loop' && !(Array.isArray(src[t.name]) && src[t.name].some(r => r && typeof r === 'object')));
  if (!empty.length) return xml;
  const cuts = [];
  outermostTables(xml).forEach(([a, b]) => {
    const found = textOf(xml.slice(a, b)).match(TAG_RE) || [];
    const owner = empty.find(t => found.includes(`{#${t.name}}`));
    if (!owner) return;
    const allowed = new Set([...namesOf(owner), GROUP_FLAG]);
    if (found.some(f => !allowed.has(tagName(f)))) return; // the table also holds other tags: leave it
    let from = a;
    const before = xml.slice(0, a).trimEnd();
    if (before.endsWith('</w:p>')) {
      const ps = Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '));
      if (ps !== -1 && isHeadingParagraph(before.slice(ps))) from = ps;
    }
    cuts.push([from, b]);
  });
  let out = xml;
  cuts.sort((x, y) => y[0] - x[0]).forEach(([from, to]) => { out = out.slice(0, from) + out.slice(to); });
  return out;
}

function describe(err) {
  const errs = err && err.properties && Array.isArray(err.properties.errors) ? err.properties.errors : [err];
  return errs.map(e => (e.properties && e.properties.explanation) || e.message).join('; ');
}

// The stored template opened for filling: placeholder colours fixed, tables of empty loops removed.
function open(file, tags, values) {
  const zip = new PizZip(file);
  applyPlaceholderColours(zip); // placeholder runs take their colour from the label next to them (see placeholderColourService.js)
  // flattened: a cell written {#_group}{x}{/_group}{^_group}{x}{/_group} fills x of its row, not of a nested _group loop
  const flat = flattenTags(tags);
  const main = zip.file('word/document.xml');
  if (main) {
    const xml = main.asText();
    const next = removeEmptyLoopTables(xml, flat, values);
    if (next !== xml) zip.file('word/document.xml', next);
  }
  return { zip, flat };
}
const renderDoc = (zip, flat, values) => {
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '', errorLogging: false });
  doc.render(dataFor(flat, values));
  return doc;
};
// one table of contents, no blank entries (contentsTidyService.js); the PDF conversion updates its page numbers
const finishDoc = doc => tidyContents(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })).buffer;

// file: the template .docx buffer. tags: its tag list. Returns the filled .docx buffer (no logo: used to check an uploaded template).
function fill(file, tags, values) {
  const fail = message => Object.assign(new Error(message), { status: 500 });
  try {
    const { zip, flat } = open(file, tags, values);
    return finishDoc(renderDoc(zip, flat, values));
  } catch (err) {
    throw fail(`Could not fill the template: ${describe(err)}`);
  }
}

// The same, with the customer logo of the proposal (values.__meta.leadLogo, a PNG / JPG data URL): it fills the template's {%client_logo}
// picture, sized from the template (logoService.js); without a logo the placeholder (and its empty line) is removed.
async function fillWithLogo(file, tags, values, label = '') {
  const fail = message => Object.assign(new Error(message), { status: 500 });
  const meta = values && values[META_KEY] && typeof values[META_KEY] === 'object' ? values[META_KEY] : {};
  const body = { ...values };
  delete body[META_KEY];
  try {
    const { zip, flat } = open(file, tags, body);
    const logoCtx = await prepareClientLogo(zip, clean(meta.leadLogo), meta.leadLogoSize, label);
    const doc = renderDoc(zip, flat, body);
    await applyClientLogo(doc.getZip(), logoCtx);
    return finishDoc(doc);
  } catch (err) {
    throw fail(`Could not fill the template: ${describe(err)}`);
  }
}

// format: 'docx' | 'pdf'. Returns { buffer, baseName, entry }.
// refNo = the proposal's own reference ('' when it has none): the template's reference placeholder prints a full SLTM reference or
// that value, never junk the AI or the sheet put there ("PR:"). Left alone when refNo is not given.
async function render({ templateId, fields, companyName, format = 'docx', refNo }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const entry = templateId ? store.get(templateId) : store.getActive('solution');
  if (!entry || entry.type !== 'solution') throw fail(templateId ? 404 : 409, templateId ? 'Solution template version not found' : 'There is no active solution template. Upload one first.');
  const file = store.readFile(entry.id);
  if (!file) throw fail(404, 'Template file is missing on the server');
  if (!fields || typeof fields !== 'object') throw fail(400, 'fields are required');
  const withRef = refNo === undefined ? fields : applyReference(buildSchema(entry.tags), fields, refNo);
  const docx = await fillWithLogo(file, entry.tags, withRef, `v${entry.version}`);
  const baseName = `${files.namePrefix}Solution_${clean(companyName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'Draft'}`;
  return { buffer: format === 'pdf' ? await docxToPdf(docx) : await require('./pdfService').refreshContents(docx), baseName, entry };
}

module.exports = { META_KEY, render, fill, fillWithLogo, dataFor, formatMoney, removeEmptyLoopTables, buildSchema };
