const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { extractTags } = require('./templateTagService');
const { autoBind } = require('../proposal/autoBind');
const { captureFormats } = require('./templateFormats');
const PizZip = require('pizzip');
const { detectPlaceholders } = require('./logoService');

// Versioned proposal templates (new generator). Flat files, same pattern as the rest of the app:
//   DATA_DIR/proposal_templates.json   index: [{ id, version, filename, uploadedBy, uploadedAt, isActive, tags, bindings }]
//   bindings = which schema field fills which tag (proposal/autoBind.js; the admin can correct them)
//   DATA_DIR/templates/<id>.docx       the file itself
// The default template (templates/Product_Proposal_Template.docx) is imported as version 1 on first run.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'proposal_templates.json');
const FILES_DIR = path.join(DATA_DIR, 'templates');
const DEFAULT_TEMPLATE = require('../proposal/renderSettings').paths.defaultTemplate;

fs.mkdirSync(FILES_DIR, { recursive: true });

function readIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[templateStore] Error reading index:', err.message);
    return [];
  }
}

function writeIndex(list) {
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
}

function fileOf(id) {
  return path.join(FILES_DIR, `${path.basename(id)}.docx`);
}

function originalOf(id) {
  return path.join(FILES_DIR, `${path.basename(id)}.original.docx`);
}

function logoPlaceholdersOf(buffer) {
  try { return detectPlaceholders(new PizZip(buffer)); } catch { return []; }
}

function addVersion(list, { buffer, original, filename, uploadedBy, tags, active, extra, type }) {
  const id = uuidv4();
  try {
    fs.writeFileSync(fileOf(id), buffer);
    if (original) fs.writeFileSync(originalOf(id), original);
  } catch (err) {
    [fileOf(id), originalOf(id)].forEach(f => { try { fs.unlinkSync(f); } catch { /* not written */ } });
    throw err;
  }
  const entry = {
    id,
    // Product and solution versions share one counter (as before). The Product + Solution template has its own, so its versions
    // never change the numbers the other two templates get.
    version: list.filter(t => (type === PS_TYPE ? t.type === PS_TYPE : t.type !== PS_TYPE)).reduce((max, t) => Math.max(max, t.version || 0), 0) + 1,
    filename: filename || 'template.docx',
    uploadedBy: uploadedBy || 'Admin',
    uploadedAt: new Date().toISOString(),
    isActive: !!active,
    tags,
    bindings: autoBind(tags),
    logoPlaceholders: logoPlaceholdersOf(buffer), // {%client_logo} tags and pictures (logoService.js); none is fine
    formats: captureFormats(buffer), // the template's own picture paragraph etc. (templateFormats.js)
    sizeBytes: buffer.length,
    ...(original ? { hasOriginal: true } : {}),
    ...(extra || {}),
  };
  list.push(entry);
  return entry;
}

// First run: an empty index gets the default template as version 1, active.
function ensureInitialised() {
  const list = readIndex();
  if (list.length) return list;
  if (!fs.existsSync(DEFAULT_TEMPLATE)) return list;
  const buffer = fs.readFileSync(DEFAULT_TEMPLATE);
  const report = extractTags(buffer);
  if (report.errors.length) {
    console.error('[templateStore] Default template could not be parsed:', report.errors.map(e => e.message).join('; '));
    return list;
  }
  addVersion(list, { buffer, filename: path.basename(DEFAULT_TEMPLATE), uploadedBy: 'System (default)', tags: report.tags, active: true });
  writeIndex(list);
  console.log('[templateStore] Imported default template as version 1 (active).');
  return list;
}

// A version stored before the logo placeholders carried their location is read again from its file
const hasLocations = t => Array.isArray(t.logoPlaceholders) && t.logoPlaceholders.every(l => 'location' in l && 'nearField' in l && 'nearSection' in l); // 'nearSection' too: versions stored without it are re-detected from the file, so the panel groups client_logo under the section its tag follows
// Templates stored before template types existed are product templates (read-time only, nothing is rewritten)
const PS_TYPE = 'productSolution'; // the combined Product + Solution template (its own single active version)
const typeOf = t => (t && t.type === 'solution' ? 'solution' : (t && t.type === PS_TYPE ? PS_TYPE : 'product'));
const withBindings = t => {
  if (!t) return t;
  let out = t.type === typeOf(t) ? t : { ...t, type: typeOf(t) };
  if (!out.bindings) out = { ...out, bindings: autoBind(out.tags) };
  if (!hasLocations(out)) { const file = fs.existsSync(fileOf(out.id)) ? fs.readFileSync(fileOf(out.id)) : null; out = { ...out, logoPlaceholders: file ? logoPlaceholdersOf(file) : [] }; }
  return out;
};

// The Product + Solution template starts with the combined template shipped in backend/templates (as version 1, active). Only done for
// that type and only while it has no version at all, so the product and solution templates are never touched by it.
const PS_SEED_FILES = ['Product_Solution_Proposal_Template.docx'].map(f => path.join(__dirname, '..', 'templates', f));
function ensurePsSeeded() {
  const list = ensureInitialised();
  if (list.some(t => typeOf(t) === PS_TYPE)) return list;
  const seed = PS_SEED_FILES.find(f => fs.existsSync(f));
  if (!seed) return list;
  const buffer = fs.readFileSync(seed);
  const report = extractTags(buffer);
  if (report.errors.length || !report.tags.length) {
    console.error('[templateStore] The Product + Solution seed template could not be used:', report.errors.map(e => e.message).join('; ') || 'no tags');
    return list;
  }
  // the seed already holds its tags: it is stored as it is (no tagged copy is needed)
  addVersion(list, { buffer, filename: 'Product_Solution_Proposal_Template.docx', uploadedBy: 'System (seed)', tags: report.tags, active: true, type: PS_TYPE, extra: { type: PS_TYPE, kind: 'seed', bindings: {} } });
  writeIndex(list);
  console.log('[templateStore] Imported the Product + Solution template as version 1 (active).');
  return list;
}
// The Solution template starts with the one shipped in backend/templates (as version 1, active), the same way as the Product + Solution
// one. Only done for the solution type and only while it has no version at all, so an upload made by an admin is never replaced and the
// product and Product + Solution templates are never touched by it.
const SOLUTION_SEED_FILE = path.join(__dirname, '..', 'templates', 'Solution_Proposal_Template.docx');
function ensureSolutionSeeded() {
  const list = ensureInitialised();
  if (list.some(t => typeOf(t) === 'solution')) return list;
  if (!fs.existsSync(SOLUTION_SEED_FILE)) return list;
  const buffer = fs.readFileSync(SOLUTION_SEED_FILE);
  const report = extractTags(buffer);
  if (report.errors.length || !report.tags.length) {
    console.error('[templateStore] The Solution seed template could not be used:', report.errors.map(e => e.message).join('; ') || 'no tags');
    return list;
  }
  // the seed already holds its tags: it is stored as it is (no tagged copy is needed)
  addVersion(list, { buffer, filename: 'Solution_Proposal_Template.docx', uploadedBy: 'System (seed)', tags: report.tags, active: true, type: 'solution', extra: { type: 'solution', kind: 'seed', bindings: {} } });
  writeIndex(list);
  console.log('[templateStore] Imported the Solution template as version 1 (active).');
  return list;
}
const indexFor = type => (type === PS_TYPE ? ensurePsSeeded() : (type === 'solution' ? ensureSolutionSeeded() : ensureInitialised()));

// Newest first. type: 'product' (default), 'solution' or 'productSolution'; each type has its own single active template.
function list(type = 'product') {
  return indexFor(type).filter(t => typeOf(t) === type).slice().sort((a, b) => b.version - a.version).map(withBindings);
}

function get(id) {
  return withBindings(ensureInitialised().find(t => t.id === id)) || null;
}

function getActive(type = 'product') {
  return withBindings(indexFor(type).find(t => t.isActive && typeOf(t) === type)) || null;
}

function readFile(id) {
  const p = fileOf(id);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// A tagged copy made by the review screen (templateDraftService), with the uploaded original kept next to it. Becomes the
// active version. extra = { kind, mapping, changes }.
function addTagged({ buffer, original, filename, uploadedBy, tags, extra, type = 'product' }) {
  const index = indexFor(type);
  const entry = addVersion(index, { buffer, original, filename, uploadedBy, tags, active: false, type, extra: { kind: 'tagged', ...(type === 'solution' || type === PS_TYPE ? { type } : {}), ...(extra || {}) } });
  // only versions of the same type are switched off: a new solution template never deactivates the product template
  index.forEach(t => { if (typeOf(t) === type) t.isActive = t.id === entry.id; });
  try {
    writeIndex(index); // the active version only changes when this write succeeds
  } catch (err) {
    [fileOf(entry.id), originalOf(entry.id)].forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
    throw err;
  }
  return entry;
}

function readOriginal(id) {
  const p = originalOf(id);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// The account-manager tags of a template version (tag -> user field), learned from the agent's answers (solution templates).
// Existing entries are kept; only tags not stored yet are added. Returns the stored map.
function mergeUserSource(id, pairs) {
  const index = ensureInitialised();
  const entry = index.find(t => t.id === id);
  if (!entry) return {};
  const map = { ...(entry.userSource || {}) };
  let changed = false;
  (pairs || []).forEach(u => { if (u && u.tag && u.field && !(u.tag in map)) { map[u.tag] = u.field; changed = true; } });
  if (changed) { entry.userSource = map; writeIndex(index); }
  return map;
}

function activate(id) {
  const index = ensureInitialised();
  const target = index.find(t => t.id === id);
  if (!target) return null;
  index.forEach(t => { if (typeOf(t) === typeOf(target)) t.isActive = t.id === id; });
  writeIndex(index);
  return target;
}

// "Restore Default" of the Product template: makes the bundled default file (templates/Product_Proposal_Template.docx) the active
// version. A stored product version with exactly the same file is re-activated; when the bundled file was replaced after this server
// first started (so version 1 is an older default), it is added as a new version. Returns the active entry, null when the file is missing.
function restoreDefault() {
  if (!fs.existsSync(DEFAULT_TEMPLATE)) return null;
  const buffer = fs.readFileSync(DEFAULT_TEMPLATE);
  const index = ensureInitialised();
  let entry = index.find(t => typeOf(t) === 'product' && t.sizeBytes === buffer.length && (() => { const f = readFile(t.id); return f && f.equals(buffer); })());
  if (!entry) {
    const report = extractTags(buffer);
    if (report.errors.length) throw new Error(`The default template could not be read: ${report.errors.map(e => e.message).join('; ')}`);
    entry = addVersion(index, { buffer, filename: path.basename(DEFAULT_TEMPLATE), uploadedBy: 'System (default)', tags: report.tags, active: false });
  }
  index.forEach(t => { if (typeOf(t) === 'product') t.isActive = t.id === entry.id; });
  writeIndex(index);
  return withBindings(entry);
}

// Deletes a PREVIOUS version (the active one cannot be deleted). Proposals already made with it keep working: a render whose
// version is gone uses the active template of its type. Returns the removed entry, null when it does not exist; throws when it is active.
function remove(id) {
  const index = ensureInitialised();
  const at = index.findIndex(t => t.id === id);
  if (at === -1) return null;
  if (index[at].isActive) throw Object.assign(new Error('The active template cannot be deleted. Activate another version first.'), { status: 409 });
  const [entry] = index.splice(at, 1);
  writeIndex(index);
  [fileOf(entry.id), originalOf(entry.id)].forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
  return entry;
}

module.exports = { PS_TYPE, list, get, getActive, readFile, readOriginal, addTagged, activate, remove, restoreDefault, mergeUserSource };
