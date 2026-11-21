const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const PizZip = require('pizzip');
const store = require('./templateStoreService');
const { extractTags } = require('./templateTagService');
const { detectPlaceholders } = require('./logoService');
const { buildOutline, redSpans } = require('./templateOutlineService');
const { mapTemplate, mapFromAnswers } = require('./templateMappingService');
const { writeTags, planCleanup } = require('./templateTagWriter');
const { fillTemplate } = require('./renderService');
const { autoBind } = require('../proposal/autoBind');
const { FIELDS, BY_KEY, slots, ITEM_LOOP } = require('../proposal/fieldSchema');
const { sampleValuesIgnored } = require('../proposal/renderSettings');
const { PRODUCTS } = require('./productCatalog');

// Template drafts: an uploaded .docx that has been analysed and is waiting for the admin to review the mapping.
//   DATA_DIR/proposal_template_drafts.json    [{ id, filename, uploadedBy, uploadedAt, answers, aiError, overrides }]
//   DATA_DIR/templates/drafts/<id>.docx       the upload, exactly as uploaded
// The outline, tags and mapping are recomputed from the file + the stored answers + the admin's overrides each time, so
// there is no second copy of them to go stale. Nothing here is a usable template: confirm() makes the tagged version.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'proposal_template_drafts.json');
const DRAFT_DIR = path.join(DATA_DIR, 'templates', 'drafts');
fs.mkdirSync(DRAFT_DIR, { recursive: true });

const readIndex = () => { try { const l = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
const writeIndex = list => { const tmp = `${INDEX_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8'); fs.renameSync(tmp, INDEX_FILE); };
const fileOf = id => path.join(DRAFT_DIR, `${path.basename(id)}.docx`);
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });

const TAG_TEXT = /\{[#/@^!]?[A-Za-z_][\w.]*\}/;
const tagHint = s => (s.kind === 'block' || s.kind === 'image' ? `{@${s.key}}` : (s.kind === 'table' ? `{#${s.key}} … {/${s.key}}` : `{${s.key}}`));

// ---- Building the review view of a draft --------------------------------------------------------------------------------
function coveredRuns(entries) {
  const runs = new Set();
  const paras = new Set();
  entries.forEach(e => {
    if (e.status !== 'found') return;
    (e.locations || []).forEach(l => { for (let i = l.runs[0]; i <= l.runs[1]; i += 1) runs.add(`${l.paragraph}.r${i}`); });
    if (e.paragraph) paras.add(e.paragraph);
  });
  return { runs, paras };
}

// Red sample text no slot is connected to: it would print as it is
function unmappedRed(outline, entries, tableParas) {
  const { runs, paras } = coveredRuns(entries);
  const blockParas = new Set();
  entries.filter(e => e.status === 'found' && e.paragraphs).forEach(e => {
    const [a, b] = e.paragraphs.map(r => outline.paragraphs.find(p => p.ref === r));
    outline.paragraphs.filter(p => p.ref.split('.')[0] === a.ref.split('.')[0] && p.index >= a.index && p.index <= b.index).forEach(p => blockParas.add(p.ref));
  });
  const out = [];
  outline.paragraphs.forEach(p => {
    if (blockParas.has(p.ref) || paras.has(p.ref) || tableParas.has(p.ref)) return;
    redSpans(p).forEach(sp => {
      if (TAG_TEXT.test(sp.text)) return; // a {tag} the author already wrote
      const ids = []; for (let i = sp.runs[0]; i <= sp.runs[1]; i += 1) ids.push(`${p.ref}.r${i}`);
      if (ids.some(id => runs.has(id))) return;
      const inField = outline.fields.some(f => f.runs && f.paragraph === p.ref && sp.runs[0] >= f.runs[0] && sp.runs[1] <= f.runs[1] && ['SET', 'REF'].includes(f.kind));
      if (inField) return;
      out.push({ paragraph: p.ref, runs: sp.runs, text: sp.text, context: p.text.trim().slice(0, 160) });
    });
  });
  return out;
}

function candidates(outline) {
  const spans = [];
  outline.paragraphs.forEach(p => redSpans(p).forEach(sp => spans.push({ paragraph: p.ref, runs: sp.runs, text: sp.text, context: p.text.trim().slice(0, 120) })));
  outline.fields.filter(f => f.kind === 'REF' && f.runs).forEach(f => spans.push({ paragraph: f.paragraph, runs: f.runs, text: f.result || '(empty value)', field: f.name, context: `Word field "${f.name}"` }));
  const red = outline.paragraphs.filter(p => p.text.trim() && p.runs.some(r => r.red && !r.hidden && r.text.trim()) && !p.runs.some(r => !r.red && !r.hidden && !r.inFieldCode && r.text.trim()));
  const tables = outline.tables.filter(t => t.rows.some(r => r.cells.some(c => c.red))).map(t => ({
    ref: t.ref,
    header: (t.rows[t.headerRow] ? t.rows[t.headerRow].cells : []).map(c => c.text),
    rows: t.rows.map(r => ({ r: r.index, cells: r.cells.map(c => c.text), red: r.cells.some(c => c.red) })).filter(r => r.red),
  }));
  return {
    spans: spans.slice(0, 200),
    blocks: red.map(p => ({ paragraph: p.ref, text: p.text.trim().slice(0, 120) })).slice(0, 200),
    tables,
  };
}

function view(record, file) {
  const outline = buildOutline(file);
  const report = extractTags(file);
  const entries = mapFromAnswers(outline, report.tags, record.answers, record.overrides || {});
  const bound = autoBind(report.tags);
  const tableParas = new Set();
  entries.filter(e => e.status === 'found' && e.table).forEach(e => {
    const t = outline.tables.find(x => x.ref === e.table);
    t.rows[e.templateRow].cells.forEach(c => (c.paragraphs || []).forEach(r => tableParas.add(r)));
  });
  const mappedRefs = new Set();
  entries.filter(e => e.status === 'found').forEach(e => (e.locations || []).forEach(l => {
    const f = outline.fields.find(x => x.kind === 'REF' && x.paragraph === l.paragraph && x.runs && x.runs[0] === l.runs[0] && x.runs[1] === l.runs[1]);
    if (f) mappedRefs.add(f.ref);
  }));
  const allSlots = Object.fromEntries(slots().map(s => [s.key, s]));
  return {
    id: record.id,
    filename: record.filename,
    uploadedBy: record.uploadedBy,
    uploadedAt: record.uploadedAt,
    sizeBytes: file.length,
    summary: outline.report,
    tags: { found: report.tags.map(t => t.name), unbound: report.tags.filter(t => !bound[t.name]).map(t => t.name), errors: report.errors, logoPlaceholders: detectPlaceholders(new PizZip(file)).length },
    mapping: entries,
    ...(record.aiError ? { aiError: record.aiError } : {}),
    cleanup: planCleanup(outline, mappedRefs),
    unmappedRed: unmappedRed(outline, entries, tableParas),
    willStayEmpty: entries.filter(e => e.status === 'not_found' || e.status === 'needs_review').map(e => ({ key: e.key, label: e.label, status: e.status, tag: tagHint(allSlots[e.key]) })),
    candidates: candidates(outline),
    slots: slots().map(s => ({ key: s.key, label: s.label, kind: s.kind, section: s.section, ...(s.columns ? { columns: s.columns } : {}) })),
  };
}

// ---- API ------------------------------------------------------------------------------------------------------------------
const summary = r => ({ id: r.id, filename: r.filename, uploadedBy: r.uploadedBy, uploadedAt: r.uploadedAt });

function list() {
  return readIndex().map(summary).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// Analyses an upload (tags, outline, AI mapping) and keeps it as a draft
async function create({ buffer, filename, uploadedBy }) {
  const report = extractTags(buffer);
  const bad = report.errors.find(e => e.kind === 'not_docx');
  if (bad) throw fail(400, bad.message);
  if (report.errors.length) throw fail(400, `The template has tag errors, so it was not saved: ${report.errors.map(e => e.message).join('; ')}`);
  const outline = buildOutline(buffer);
  const mapping = await mapTemplate(outline, report.tags);
  const record = { id: uuidv4(), filename: filename || 'template.docx', uploadedBy: uploadedBy || 'Admin', uploadedAt: new Date().toISOString(), answers: mapping.answers, aiError: mapping.aiError || '', overrides: {} };
  try {
    fs.writeFileSync(fileOf(record.id), buffer);
    const index = readIndex();
    index.push(record);
    writeIndex(index);
  } catch (err) {
    try { fs.unlinkSync(fileOf(record.id)); } catch { /* not written */ }
    throw err;
  }
  return view(record, buffer);
}

function load(id) {
  const record = readIndex().find(r => r.id === id);
  if (!record) throw fail(404, 'Template draft not found');
  const file = fs.existsSync(fileOf(id)) ? fs.readFileSync(fileOf(id)) : null;
  if (!file) throw fail(404, 'The uploaded file of this draft is missing on the server');
  return { record, file };
}

function get(id) {
  const { record, file } = load(id);
  return view(record, file);
}

// overrides: { slotKey: raw location | { clear: true } | null (back to the AI's answer) }
function setOverrides(id, overrides) {
  const index = readIndex();
  const record = index.find(r => r.id === id);
  if (!record) throw fail(404, 'Template draft not found');
  const valid = new Set(slots().map(s => s.key));
  record.overrides = record.overrides || {};
  Object.entries(overrides || {}).forEach(([key, raw]) => {
    if (!valid.has(key)) throw fail(400, `Unknown field "${key}"`);
    if (raw === null) delete record.overrides[key]; else record.overrides[key] = raw;
  });
  writeIndex(index);
  return get(id);
}

function remove(id) {
  const index = readIndex();
  if (!index.find(r => r.id === id)) throw fail(404, 'Template draft not found');
  writeIndex(index.filter(r => r.id !== id));
  try { fs.unlinkSync(fileOf(id)); } catch { /* already gone */ }
}

function original(id) {
  const { record, file } = load(id);
  return { filename: record.filename, buffer: file };
}

// ---- Checking the tagged copy before it is saved -------------------------------------------------------------------------
function dummyFields() {
  const f = {};
  FIELDS.forEach(field => {
    if (field.type === 'table') {
      const withDiagram = PRODUCTS.filter(p => p.diagram).map(p => p.id);
      f[field.key] = field.key === 'recommendations' ? [] : [0, 1].map(i => Object.fromEntries(field.columns.filter(c => !c.computed).map(c => [c.key, field.key === ITEM_LOOP.loop && c.key === 'id' ? withDiagram[i] : `TEST ${field.key}.${c.key}${i}`])));
    } else f[field.key] = field.type === 'image' ? '' : `TEST ${field.key}`;
  });
  return f;
}

// Sample values from the Word SET fields that may stay in the tagged copy without failing the upload (and are never
// reported). The list is in proposal/renderSettings.js. Compared ignoring case, spacing and punctuation, so a value split across Word runs or written
// with different commas still matches.
const IGNORED_SAMPLE_VALUES = sampleValuesIgnored; // proposal/renderSettings.js
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const IGNORED_SQUASHED = IGNORED_SAMPLE_VALUES.map(squash).filter(Boolean);
const isIgnoredSample = value => { const v = squash(value); return !!v && IGNORED_SQUASHED.some(i => v === i || v.includes(i)); };

async function validate(buffer, entries, plan, original, changes = {}) {
  const problems = []; // the tagged copy is broken: nothing is saved
  const warnings = []; // worth knowing, never blocks: kept in the version record and the response, not shown in the UI
  const report = extractTags(buffer);
  if (report.errors.length) return { ok: false, problems: report.errors.map(e => `Tag error: ${e.message}`), warnings };
  const names = new Set(report.tags.map(t => t.name));
  if (original) {
    // A tag the author had already written that is gone from the tagged copy was destroyed by our own writer: that blocks.
    // (Fields the original never had a tag for are not an error; they are only listed as skipped.)
    // (The requirements block and diagrams placeholder are replaced on purpose when the writer makes the requirements loop.)
    const loop = changes.requirementsLoop;
    const replaced = new Set(loop ? [ITEM_LOOP.blockSlot, ...(loop.diagramsRemoved ? [ITEM_LOOP.pictureSlot] : [])] : []);
    const before = extractTags(original).tags;
    before.forEach(t => {
      if (!names.has(t.name) && !replaced.has(t.name)) problems.push(`The tag {${t.name}} of the upload was lost while writing the tagged copy`);
      (t.children || []).forEach(c => { const kids = report.tags.find(x => x.name === t.name); if (kids && !(kids.children || []).some(k => k.name === c.name)) problems.push(`The column tag {${c.name}} of {${t.name}} was lost while writing the tagged copy`); });
    });
  }
  const children = Object.fromEntries(report.tags.filter(t => t.type === 'loop').map(t => [t.name, new Set((t.children || []).map(c => c.name))]));
  entries.filter(e => e.status === 'found').forEach(e => {
    const loop = changes.requirementsLoop;
    if (loop && e.key === ITEM_LOOP.pictureSlot && loop.diagramsRemoved) return; // its pictures are in the requirements loop
    const expected = loop && e.key === ITEM_LOOP.blockSlot ? ITEM_LOOP.loop : e.key;
    if (!names.has(expected)) problems.push(`The tag for "${e.label}" is missing from the tagged copy`);
    if (e.kind === 'table') Object.keys(e.columns).forEach(c => { if (!(children[e.key] && children[e.key].has(c))) problems.push(`The "${c}" column tag of "${e.label}" is missing from the tagged copy`); });
  });
  const after = buildOutline(buffer);
  if (after.fields.some(f => f.kind === 'SET')) problems.push('A Word SET field with sample data is still in the tagged copy');
  const setNames = new Set(plan.setFields.map(s => s.name));
  if (after.fields.some(f => f.kind === 'REF' && setNames.has(f.name))) problems.push('A Word field that points at removed sample data is still in the tagged copy');
  if (plan.toc.keep && after.fields.filter(f => f.kind === 'TOC').length !== 1) problems.push('The table of contents was not reduced to one field');
  if (problems.length) return { ok: false, problems, warnings };

  // fill it with dummy values: it must render, repeat its tables and leave no tag text behind
  try {
    const filled = await fillTemplate(buffer, { tags: report.tags, bindings: autoBind(report.tags) }, dummyFields());
    const filledZip = new PizZip(filled);
    const xml = filledZip.file('word/document.xml').asText();
    const text = xml.replace(/<[^>]+>/g, ' ');
    if (/\{[#/@]?[A-Za-z]\w*\}/.test(text)) problems.push('Tag text is left in the document after filling it with test values');
    // every loop (tables, the requirements loop) must repeat once per row; a loop with a {@diagram} tag must bring in pictures
    const bindings = autoBind(report.tags);
    report.tags.filter(t => t.type === 'loop' && bindings[t.name] && bindings[t.name].kind === 'loop').forEach(t => {
      const b = bindings[t.name];
      const defs = BY_KEY[b.field].columns;
      const stored = (t.children || []).map(c => b.columns[c.name]).find(col => col && !(defs.find(d => d.key === col) || {}).computed);
      if (stored && b.field !== 'recommendations' && !text.includes(`TEST ${b.field}.${stored}1`)) problems.push(`The "${t.name}" loop did not repeat its rows`);
      if ((t.children || []).some(c => (defs.find(d => d.key === b.columns[c.name]) || {}).computed === 'diagram') && !Object.keys(filledZip.files).some(n => /ih_diagram_/.test(n))) {
        problems.push(`The "${t.name}" loop did not insert any product diagram`);
      }
    });
    plan.setFields.filter(s => s.value && !isIgnoredSample(s.value)).forEach(s => { if (text.includes(s.value)) problems.push(`Old sample data "${s.value}" is still printed`); });
  } catch (err) {
    problems.push(err.message);
  }
  return { ok: problems.length === 0, problems, warnings };
}

// Writes the tags, checks the result, and stores it as the new active version (the upload is kept next to it)
async function confirm(id, user) {
  const { record, file } = load(id);
  const v = view(record, file);
  const { buffer, changes, plan } = writeTags(file, v.mapping);
  const validation = await validate(buffer, v.mapping, plan, file, changes);
  if (!validation.ok) throw fail(422, 'The tagged copy did not pass its checks, so nothing was saved.', { problems: validation.problems });
  const tags = extractTags(buffer).tags;
  const entry = store.addTagged({
    buffer,
    original: file,
    filename: record.filename,
    uploadedBy: user || record.uploadedBy,
    tags,
    extra: {
      mapping: v.mapping.map(e => ({ key: e.key, status: e.status, source: e.source, ...(e.tag ? { tag: e.tag } : {}) })),
      changes: { ...changes, tags: changes.tags.length, setFieldsRemoved: changes.setFieldsRemoved.length },
      // fields that got no place in this template (they print empty) and red sample text left unconnected
      skipped: v.willStayEmpty,
      unconnectedRed: v.unmappedRed.length,
      lostTags: validation.warnings,
    },
  });
  remove(id);
  return { template: entry, changes, plan: { toc: plan.toc, headings: plan.emptyHeadings.length }, willStayEmpty: v.willStayEmpty, unconnectedRed: v.unmappedRed.length, lostTags: validation.warnings };
}

// A place the analyser proposed but the rules rejected is accepted only when it also offered a clear red-only fix
// (the trimmed range). Everything else stays "needs review" and is skipped.
function autoAcceptSuggestions(id) {
  const v = get(id);
  const overrides = {};
  v.mapping.forEach(e => {
    if (e.status !== 'needs_review') return;
    const s = (e.review || []).map(r => r.suggestion).find(x => x && x.paragraphs);
    if (s) overrides[e.key] = { paragraphs: s.paragraphs };
  });
  return Object.keys(overrides).length ? setOverrides(id, overrides) : v;
}

// One step: analyse, tag, clean and activate (what the review screen's Confirm did). On any failure the active template is
// unchanged and the draft files and index entry are removed.
async function uploadAndActivate({ buffer, filename, uploadedBy }) {
  const draft = await create({ buffer, filename, uploadedBy });
  try {
    const v = autoAcceptSuggestions(draft.id);
    if (!v.mapping.some(e => e.status === 'found' || e.status === 'tagged')) {
      throw fail(422, 'No proposal field could be connected to this template, so it was not used.', {
        problems: [v.aiError ? `The AI mapping did not run: ${v.aiError}` : 'The template has no tags and no red sample text the analyser could match.'],
      });
    }
    const result = await confirm(draft.id, uploadedBy);
    return { ...result, ...(v.aiError ? { aiError: v.aiError } : {}) };
  } catch (err) {
    try { remove(draft.id); } catch { /* confirm already removed it */ }
    throw err;
  }
}

module.exports = { create, list, get, setOverrides, remove, original, confirm, validate, uploadAndActivate };
