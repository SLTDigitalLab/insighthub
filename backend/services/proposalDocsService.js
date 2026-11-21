const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Status tracking + document uploads for saved proposals.
// Files live under backend/uploads/proposals/<refNo>/<docType>-<timestamp>.<ext>
// (never served statically: see the 404 guard in server.js; downloads go through the authenticated GET route).

const STATUSES = ['Draft', 'Sent', 'Revised', 'Revised & Sent', 'Confirmed', 'Completed'];
const DOC_TYPES = ['customerConfirmation', 'creditApproval', 'singleSourceApproval', 'uat'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOTE = 500;
// Which document slots each status accepts
const STATUS_DOC_TYPES = {
  'Confirmed': ['customerConfirmation', 'creditApproval', 'singleSourceApproval'],
  'Completed': ['uat'],
};
const REVISION_STATUSES = ['Revised', 'Revised & Sent'];

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
};

const UPLOADS_ROOT = path.resolve(
  process.env.UPLOADS_DIR ? path.join(process.env.UPLOADS_DIR, 'proposals') : path.join(__dirname, '..', 'uploads', 'proposals')
);

// refNo comes from the URL: allow only a conservative character set so it cannot escape the uploads root
function safeRefNo(refNo) {
  const v = String(refNo || '').trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(v) || v.includes('..')) return null;
  return v;
}

function proposalDir(refNo) {
  const safe = safeRefNo(refNo);
  if (!safe) return null;
  const dir = path.resolve(UPLOADS_ROOT, safe);
  return dir.startsWith(UPLOADS_ROOT + path.sep) ? dir : null;
}

// storedPath is kept relative to the uploads root; resolve it and make sure it is still inside
function resolveStored(storedPath) {
  if (!storedPath) return null;
  const abs = path.resolve(UPLOADS_ROOT, storedPath);
  return abs.startsWith(UPLOADS_ROOT + path.sep) ? abs : null;
}

function removeStored(storedPath) {
  const abs = resolveStored(storedPath);
  if (abs) { try { fs.unlinkSync(abs); } catch { /* already gone */ } }
}

function removeProposalDir(refNo) {
  const dir = proposalDir(refNo);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.warn('[proposalDocs] cleanup failed:', e.message); } }
}

// Validates the extension + MIME type of an upload; returns the normalised extension or null
function validateFile(file) {
  if (!file) return null;
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimes = ALLOWED[ext];
  if (!mimes || !mimes.includes(file.mimetype)) return null;
  return ext === '.jpeg' ? '.jpg' : ext;
}

function saveFile(refNo, docType, ext, buffer) {
  const dir = proposalDir(refNo);
  if (!dir) throw new Error('Invalid reference number');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${docType}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return path.posix.join(path.basename(dir), name);
}

// The Excel a solution proposal was built from: uploads/proposals/<refNo>/source.xlsx (same path protection as the documents)
const SOURCE_NAME = 'source.xlsx';

function saveSource(refNo, buffer) {
  const dir = proposalDir(refNo);
  if (!dir) throw new Error('Invalid reference number');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE_NAME), buffer);
  return path.posix.join(path.basename(dir), SOURCE_NAME);
}

function sourcePath(refNo) {
  const dir = proposalDir(refNo);
  const abs = dir && path.join(dir, SOURCE_NAME);
  return abs && fs.existsSync(abs) ? abs : null;
}

// ---- Versions ---------------------------------------------------------------------------------------------------------
// A version is a snapshot of the proposal content (fields + the Word / PDF generated from them). v1 is created with the proposal;
// the number goes up ONLY when the content changes (an edit saved from the editor, or a regenerated revision). Status changes
// never create a version: they are history events on the current version.
//   proposal.currentVersion  integer
//   proposal.versions        [{ versionNumber, createdAt, createdBy, reason, snapshotAvailable, fields, companyName, templateId,
//                               templateVersion, products, files: { docx, pdf } }]  (files are paths relative to the uploads root)
//   proposal.statusHistory   [{ id, proposalId, versionNumber, status, note, documents, userEmail, createdAt, sequence }]
const VERSIONING = 2;

const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const sameJson = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
const time = iso => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };

// Deterministic order: createdAt, then the sequence number (events with the same timestamp keep the order they happened in)
function sortHistory(history) {
  return [...(history || [])].sort((a, b) => time(a.createdAt) - time(b.createdAt) || (a.sequence || 0) - (b.sequence || 0));
}

function makeEvent(p, { status, note = '', documents = {}, userEmail = '', versionNumber, createdAt }) {
  const last = (p.statusHistory || []).reduce((m, h) => Math.max(m, h.sequence || 0), 0);
  return {
    id: uuidv4(),
    proposalId: p.id,
    versionNumber: versionNumber || p.currentVersion || 1,
    status,
    note,
    documents,
    userEmail,
    createdAt: createdAt || new Date().toISOString(),
    sequence: last + 1,
  };
}

// ---- Steps (the version history timeline) --------------------------------------------------------------------------------------
// Every history event is a step. Order: createdAt, then sequence. The first is "Original"; every later step whose status is not
// Confirmed / Completed is V1, V2, V3...; Confirmed and Completed carry no label. A step's content is its event's content version, except
// Confirmed / Completed, which show the content of the last numbered step before them.
const FINAL_STATUSES = ['Confirmed', 'Completed'];
const isFinalStatus = s => FINAL_STATUSES.includes(s);
const statusRank = s => STATUSES.indexOf(s);
// The statuses a proposal can still be moved to: only those AFTER the current one in STATUSES
const nextStatuses = current => (statusRank(current) < 0 ? [...STATUSES] : STATUSES.slice(statusRank(current) + 1));

const VIEW_ONLY_MESSAGE = 'This proposal is Confirmed or Completed, so it is view-only: it can no longer be edited, saved or regenerated. You can still view it and download the Word / PDF.';
function assertEditable(p) {
  if (p && isFinalStatus(p.status)) throw Object.assign(new Error(VIEW_ONLY_MESSAGE), { status: 409 });
}

// [{ event, label, number, finalStep, versionNumber }] for a history; label is '' for Confirmed / Completed.
function buildSteps(history) {
  const sorted = sortHistory(history);
  let n = 0;
  const steps = sorted.map((event, i) => {
    const finalStep = isFinalStatus(event.status);
    if (i > 0 && !finalStep) n += 1;
    return { event, label: i === 0 ? 'Original' : (finalStep ? '' : `V${n}`), number: i === 0 || finalStep ? 0 : n, finalStep, versionNumber: event.versionNumber };
  });
  // content: a numbered step uses its own content version; Confirmed / Completed the last numbered step's before them
  steps.forEach((s, i) => {
    if (!s.finalStep) return;
    for (let k = i - 1; k >= 0; k--) if (!steps[k].finalStep) { s.versionNumber = steps[k].versionNumber; break; }
  });
  return steps;
}

// The proposal's base reference: generated once (Original), never changed
const baseRefOf = p => String((p && (p.refNo || (p.fields && p.fields.refNo))) || '').trim();

// Document reference of one step: Original and Confirmed / Completed print the base; Vn prints <base>-Vn ("SLTM-V2" when the base ends with "-")
function stepRef(base, step) {
  const b = String(base || '').trim();
  if (!b || !step || !step.number) return b;
  return b.endsWith('-') ? `${b}V${step.number}` : `${b}-V${step.number}`;
}

// The top-level tags of `fields` whose (text) value contains the base reference
function refTagKeysOf(fields, base) {
  const b = String(base || '').trim();
  if (!b || !fields || typeof fields !== 'object') return [];
  return Object.keys(fields).filter(k => typeof fields[k] === 'string' && fields[k].includes(b));
}

// A copy of the snapshot's fields with the base reference replaced by the step's reference, only inside the reference tags' values
function fieldsWithRef(fields, refTagKeys, base, ref) {
  const out = clone(fields || {});
  const b = String(base || '').trim();
  if (!b || ref === b) return out;
  (refTagKeys || []).forEach(k => { if (typeof out[k] === 'string') out[k] = out[k].split(b).join(ref); });
  return out;
}

function makeSnapshot(p, { versionNumber, reason, userEmail = '', createdAt }) {
  return {
    refTagKeys: refTagKeysOf(p.fields, baseRefOf(p)),
    versionNumber,
    createdAt: createdAt || new Date().toISOString(),
    createdBy: userEmail,
    reason,
    snapshotAvailable: true,
    fields: clone(p.fields || {}),
    companyName: p.companyName || '',
    templateId: p.templateId || '',
    templateVersion: p.templateVersion == null ? null : p.templateVersion,
    products: clone(p.products || []),
    files: { docx: null, pdf: null },
  };
}

// Files of one version: uploads/proposals/<refNo>/versions/v<N>/proposal.<ext> (never overwritten by another version)
function saveVersionFile(refNo, versionNumber, ext, buffer) {
  const dir = proposalDir(refNo);
  if (!dir || !Number.isInteger(versionNumber) || versionNumber < 1) throw new Error('Invalid reference number');
  const sub = path.join(dir, 'versions', `v${versionNumber}`);
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, `proposal${ext}`), buffer);
  return path.posix.join(path.basename(dir), 'versions', `v${versionNumber}`, `proposal${ext}`);
}

// Files of one step: uploads/proposals/<key>/versions/v<N>/steps/<eventId>/proposal.<ext> (N = the content version the step shows)
function stepFileAbs(key, versionNumber, eventId, ext) {
  const dir = proposalDir(key);
  if (!dir || !Number.isInteger(versionNumber) || versionNumber < 1 || !/^[A-Za-z0-9-]{1,64}$/.test(String(eventId || ''))) return null;
  return path.join(dir, 'versions', `v${versionNumber}`, 'steps', String(eventId), `proposal${ext}`);
}

function saveStepFile(key, versionNumber, eventId, ext, buffer) {
  const abs = stepFileAbs(key, versionNumber, eventId, ext);
  if (!abs) throw new Error('Invalid reference number');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return abs;
}

function isMigrated(p) {
  if (!p) return false;
  return p.versioning === VERSIONING && Array.isArray(p.versions) && p.versions.length > 0 &&
    Array.isArray(p.statusHistory) && p.statusHistory.length > 0 &&
    p.statusHistory.every(h => h && h.id && Number.isInteger(h.versionNumber) && Number.isInteger(h.sequence)) &&
    !(p.documents && Object.keys(p.documents).length);
}

// Brings any stored record to the model above. Idempotent.
// Older records had a version on every entry, bumped by the Revised / Revised & Sent statuses (the only trace of a revision they
// kept), and no stored content other than the latest `fields`. So: the first entry is v1, the number goes up on each entry that
// was a revision, and only the latest version can have a content snapshot; earlier ones get snapshotAvailable:false (no content invented).
// Records from before versioning get a v1 Draft entry (created date + preparer) when their log does not start with one, and the old
// per-proposal documents map moves onto the latest Confirmed / Completed entry.
function migrateHistory(p) {
  if (!p || isMigrated(p)) return p;
  const status = STATUSES.includes(p.status) ? p.status : 'Draft';
  const legacy = (Array.isArray(p.statusHistory) ? p.statusHistory : []).filter(h => h && STATUSES.includes(h.status));
  const created = p.createdAt || p.date || new Date().toISOString();
  const draft = () => ({ status: 'Draft', userEmail: p.generatedBy || '', createdAt: created });
  const norm = e => ({ ...e, userEmail: e.userEmail != null ? e.userEmail : (e.changedBy || ''), createdAt: e.createdAt || e.changedAt || created });
  let entries = legacy.length ? legacy.map(norm) : [{ ...draft(), status }];
  if (legacy.length && entries[0].status !== 'Draft') entries = [draft(), ...entries];
  // stored array order = the order things happened; use it as the sequence and sort by (createdAt, sequence)
  entries = entries.map((e, i) => ({ ...e, sequence: i + 1 }));
  entries = [...entries].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.sequence - b.sequence);

  let version = 1;
  const history = entries.map((e, i) => {
    if (i > 0 && REVISION_STATUSES.includes(e.status)) version += 1;
    return {
      id: e.id || uuidv4(),
      proposalId: p.id,
      versionNumber: version,
      status: e.status,
      note: e.note || '',
      documents: e.documents && typeof e.documents === 'object' ? e.documents : {},
      userEmail: e.userEmail || '',
      createdAt: e.createdAt || created,
      sequence: i + 1,
    };
  });
  for (const [docType, doc] of Object.entries(p.documents || {})) {
    if (!doc || !DOC_TYPES.includes(docType)) continue;
    const group = Object.keys(STATUS_DOC_TYPES).find(st => STATUS_DOC_TYPES[st].includes(docType));
    const target = [...history].reverse().find(h => h.status === group) || history[history.length - 1];
    target.documents[docType] = { id: doc.id || uuidv4(), ...doc, docType };
  }

  const versions = [];
  for (let n = 1; n <= version; n++) {
    const first = history.find(h => h.versionNumber === n);
    const base = { versionNumber: n, createdAt: first.createdAt, createdBy: first.userEmail, reason: n === 1 ? 'created' : 'revision', files: { docx: null, pdf: null } };
    versions.push(n === version
      ? { ...base, snapshotAvailable: true, fields: clone(p.fields || {}), companyName: p.companyName || '', templateId: p.templateId || '', templateVersion: p.templateVersion == null ? null : p.templateVersion, products: clone(p.products || []) }
      : { ...base, snapshotAvailable: false, fields: null, companyName: null, templateId: null, templateVersion: null, products: null });
  }

  const { documents, ...rest } = p;
  return { ...rest, versioning: VERSIONING, currentVersion: version, versions, statusHistory: history };
}

function normalize(p) {
  if (!p) return p;
  const m = migrateHistory(p);
  return {
    ...m,
    status: STATUSES.includes(m.status) ? m.status : 'Draft',
    proposalType: m.proposalType === 'solution' ? 'solution' : (m.proposalType === 'productSolution' ? 'productSolution' : 'product'),
    statusHistory: sortHistory(m.statusHistory),
  };
}

// The folder key of a proposal's files: its reference when that is a safe folder name, otherwise its id. The reference never decides
// whether a proposal can be found or downloaded (routes look proposals up by id).
// A bare "SLTM-" (several proposals can have it) or any reference with a trailing dash is never a key: those proposals use their id.
const keyOf = p => (p && safeRefNo(p.refNo) && fileRef(p) ? safeRefNo(p.refNo) : p && p.id) || '';

// The reference as a file-name part: '' unless it is a clean reference (no label like "PR:", no trailing dash, no odd characters)
const fileRef = p => {
  const r = String((p && p.refNo) || '').trim();
  // a Product + Solution reference that stops at "SP" (no Excel ref) is a short form, like "SLTM-": not a file-name part or a key
  if (p && p.proposalType === 'productSolution' && /-SP$/.test(r)) return '';
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(r) && !/^(pr|ref|no|null|undefined)$/i.test(r) ? r : '';
};

// One part of a file name: letters, digits, "." and "-" only (so no ":" "/" "\" etc.), runs of other characters become "_"; '' for
// nothing / "undefined" / "null"
const fileNamePart = v => {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
  return /^(undefined|null)$/i.test(s) ? '' : s;
};

// <reference if any>_<customer>_<rest...>.<ext>, parts that are empty are left out (never "undefined", "null" or a dangling dash)
const buildFileName = (parts, ext) => `${parts.map(fileNamePart).filter(Boolean).join('_') || 'Proposal'}.${ext}`;

module.exports = { FINAL_STATUSES, isFinalStatus, nextStatuses, assertEditable, VIEW_ONLY_MESSAGE, buildSteps, baseRefOf, stepRef, refTagKeysOf, fieldsWithRef, stepFileAbs, saveStepFile, keyOf,fileRef, fileNamePart, buildFileName, saveSource, sourcePath, STATUSES, DOC_TYPES, MAX_BYTES, MAX_NOTE, STATUS_DOC_TYPES, VERSIONING, isMigrated, sameJson, sortHistory, makeEvent, makeSnapshot, saveVersionFile, migrateHistory, safeRefNo, resolveStored, removeStored, removeProposalDir, validateFile, saveFile, normalize };
