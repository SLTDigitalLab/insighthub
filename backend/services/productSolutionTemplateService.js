const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const store = require('./templateStoreService');
const { extractTags } = require('./templateTagService');
const { buildSchema } = require('./solutionSchemaService');
const solutionTemplates = require('./solutionTemplateService');

// Upload of the PRODUCT + SOLUTION template (the "Product + Solution template" tab). It has its own single active version, versioned and
// restorable like the other two; uploading or restoring here never touches the Product or Solution template (templateStoreService keeps one
// active version per type).
//
//   analyse(file)  -> a draft: the file is kept exactly as uploaded, a tagged copy is made. A file that already holds {tags} is kept as it
//                     is (no AI). A file with no tags at all goes through the existing AI field mapper + tag writer (the Product flow's
//                     components) to tag what it can; whatever it cannot tag is simply not in the template. The result is accepted even when
//                     some tags are missing: the draft lists what was found and how it differs from the active template.
//   confirm(draft) -> the single Confirm: the tagged copy goes through the shared checks (solutionTemplateService) and becomes the active
//                     Product + Solution template.
// There is no list of tag names anywhere here: the tags are whatever the file contains.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DRAFT_DIR = path.join(DATA_DIR, 'templates', 'ps_drafts');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
fs.mkdirSync(DRAFT_DIR, { recursive: true });

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const safeId = id => (/^[0-9a-f-]{36}$/i.test(String(id || '')) ? String(id) : null);
const metaOf = id => path.join(DRAFT_DIR, `${id}.json`);
const taggedOf = id => path.join(DRAFT_DIR, `${id}.docx`);
const originalOf = id => path.join(DRAFT_DIR, `${id}.original.docx`);

function purgeOld() {
  try {
    fs.readdirSync(DRAFT_DIR).forEach(f => { const p = path.join(DRAFT_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.unlinkSync(p); });
  } catch { /* best effort */ }
}

// Tags of a template as the UI lists them: { name, type, fields } (fields = the columns of a loop, nested loops included)
const flatten = tag => ({ name: tag.name, type: tag.type, fields: (tag.children || []).map(c => (c.type === 'loop' ? `${c.name}[]` : c.name)) });

// Every tag path of a tag list: "loop", "loop.column" ... used to tell what is new / gone compared with the active template
function paths(tags, prefix = '') {
  return (tags || []).flatMap(t => [`${prefix}${t.name}`, ...paths(t.children, `${prefix}${t.name}.`)]);
}

// The existing Product flow's AI field mapper and tag writer, used only to tag a file that has no tags. Never throws: on any problem the
// file stays as it is and the reason is returned.
async function autoTag(buffer, tags) {
  try {
    const { buildOutline } = require('./templateOutlineService');
    const { mapTemplate } = require('./templateMappingService');
    const { writeTags } = require('./templateTagWriter');
    const outline = buildOutline(buffer);
    const mapping = await mapTemplate(outline, tags);
    const mapped = (mapping.entries || []).filter(e => e.status === 'found' || e.status === 'tagged');
    if (!mapped.length) return { buffer, tagged: false, aiError: mapping.aiError || 'The AI could not find a place for any field in this template.' };
    const out = writeTags(buffer, mapping.entries);
    const check = extractTags(out.buffer);
    if (check.errors.length) return { buffer, tagged: false, aiError: `The tagged copy had tag errors (${check.errors.map(e => e.message).join('; ')}), so the file was kept as it is.` };
    return { buffer: out.buffer, tagged: true, aiError: mapping.aiError || '' };
  } catch (err) {
    return { buffer, tagged: false, aiError: err.message };
  }
}

function view(id) {
  const sid = safeId(id);
  if (!sid || !fs.existsSync(metaOf(sid)) || !fs.existsSync(taggedOf(sid))) throw fail(404, 'This template upload is no longer available. Please upload the file again.');
  const record = JSON.parse(fs.readFileSync(metaOf(sid), 'utf8'));
  const tagged = fs.readFileSync(taggedOf(sid));
  const report = extractTags(tagged);
  const active = store.getActive(store.PS_TYPE);
  const now = new Set(paths(report.tags));
  const before = new Set(paths(active ? active.tags : []));
  return {
    id: sid,
    filename: record.filename,
    uploadedBy: record.uploadedBy,
    uploadedAt: record.uploadedAt,
    sizeBytes: tagged.length,
    autoTagged: !!record.autoTagged,
    ...(record.aiError ? { aiError: record.aiError } : {}),
    tags: report.tags.map(flatten),
    // compared with the template that is active now (nothing is lost silently: the admin sees it before confirming)
    ...(active ? { comparedWith: { version: active.version, added: [...now].filter(p => !before.has(p)), removed: [...before].filter(p => !now.has(p)) } } : {}),
  };
}

async function analyse({ buffer, filename, uploadedBy }) {
  purgeOld();
  const report = extractTags(buffer);
  const bad = report.errors.find(e => e.kind === 'not_docx');
  if (bad) throw fail(400, bad.message);
  if (report.errors.length) throw fail(400, `The template has tag errors, so it was not saved: ${report.errors.map(e => e.message).join('; ')}`);
  let tagged = buffer;
  let autoTagged = false;
  let aiError = '';
  if (!report.tags.length) ({ buffer: tagged, tagged: autoTagged, aiError } = await autoTag(buffer, report.tags));
  const id = uuidv4();
  try {
    fs.writeFileSync(originalOf(id), buffer);
    fs.writeFileSync(taggedOf(id), tagged);
    fs.writeFileSync(metaOf(id), JSON.stringify({ filename: path.basename(filename || 'template.docx'), uploadedBy: uploadedBy || 'Admin', uploadedAt: new Date().toISOString(), autoTagged, aiError }), 'utf8');
  } catch (err) {
    remove(id);
    throw err;
  }
  return view(id);
}

function remove(id) {
  const sid = safeId(id);
  if (!sid) return;
  [metaOf(sid), taggedOf(sid), originalOf(sid)].forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
}

// The single Confirm. On any failure the active template is unchanged and the draft stays so the admin can read the reason.
function confirm(id, user) {
  const sid = safeId(id);
  if (!sid || !fs.existsSync(metaOf(sid)) || !fs.existsSync(taggedOf(sid))) throw fail(404, 'This template upload is no longer available. Please upload the file again.');
  const record = JSON.parse(fs.readFileSync(metaOf(sid), 'utf8'));
  const result = solutionTemplates.uploadAndActivate({
    buffer: fs.readFileSync(taggedOf(sid)),
    original: fs.existsSync(originalOf(sid)) ? fs.readFileSync(originalOf(sid)) : undefined,
    filename: record.filename,
    uploadedBy: user || record.uploadedBy,
    type: store.PS_TYPE,
  });
  remove(sid);
  return { template: result.template, schema: result.schema, autoTagged: !!record.autoTagged, ...(record.aiError ? { aiError: record.aiError } : {}) };
}

// One step (analyse + Confirm), for callers that do not review: the draft is removed whatever the outcome
async function uploadAndActivate({ buffer, filename, uploadedBy }) {
  const draft = await analyse({ buffer, filename, uploadedBy });
  try {
    return confirm(draft.id, uploadedBy);
  } finally {
    remove(draft.id);
  }
}

// The active template and its tag schema (null template: the page tells the admin to upload one)
function active() {
  const entry = store.getActive(store.PS_TYPE);
  return { entry, schema: entry ? buildSchema(entry.tags) : [] };
}

module.exports = { analyse, view, confirm, remove, uploadAndActivate, active };
