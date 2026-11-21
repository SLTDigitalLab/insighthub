const fs = require('fs');
const docs = require('./proposalDocsService');
const storage = require('./proposalStorageService');

// Word / PDF files of a proposal version. Every version keeps its own files under
// uploads/proposals/<refNo>/versions/v<N>/ (see proposalDocsService.saveVersionFile); a file is rendered from the version's own
// snapshot (fields + template) the first time it is needed, then stored and reused. Another version is never touched.

const FORMATS = ['docx', 'pdf'];
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
const fail = (status, message) => Object.assign(new Error(message), { status });
const keyOf = docs.keyOf; // the folder is named after the reference, or after the id when there is no usable reference

// The version of a proposal; throws 404 for an unknown one
function findVersion(proposal, versionNumber) {
  const n = versionNumber == null || versionNumber === '' ? proposal.currentVersion : Number(versionNumber);
  const snap = Number.isInteger(n) ? (proposal.versions || []).find(v => v.versionNumber === n) : null;
  if (!snap) throw fail(404, 'Version not found');
  return snap;
}

// Builds one file from THAT version's snapshot: its fields and the template version stored with it (never today's active template)
async function renderSnapshot(proposal, snap, format) {
  if (!snap.templateId) throw fail(409, `v${snap.versionNumber} has no template stored with it, so its ${format.toUpperCase()} cannot be rebuilt.`);
  if (format === 'pdf') {
    // convert the version's own stored Word file when there is one, so the PDF always matches it
    const storedDocx = docs.resolveStored((snap.files || {}).docx);
    if (storedDocx && fs.existsSync(storedDocx)) return { buffer: await require('./pdfService').docxToPdf(fs.readFileSync(storedDocx)) };
  }
  if (proposal.proposalType === 'productSolution') {
    const refService = require('./refService');
    const ownRef = refService.sanitizeProductSolutionRef(proposal.refNo);
    return require('./productSolutionRenderService').render({ templateId: snap.templateId, fields: snap.fields, companyName: snap.companyName, products: snap.products, format, refNo: ownRef });
  }
  if (proposal.proposalType === 'solution') {
    const refService = require('./refService');
    const ownRef = refService.sanitizeSolutionRef(proposal.refNo) || (refService.isValid(proposal.refNo) ? proposal.refNo : '');
    return require('./solutionRenderService').render({ templateId: snap.templateId, fields: snap.fields, companyName: snap.companyName, format, refNo: ownRef });
  }
  return require('./renderService').render({ templateId: snap.templateId, fields: snap.fields, format });
}

function persistFile(proposal, versionNumber, format, buffer) {
  const ref = docs.saveVersionFile(keyOf(proposal), versionNumber, `.${format}`, buffer);
  storage.updateProposal(keyOf(proposal), p => ({
    ...p,
    versions: p.versions.map(v => (v.versionNumber === versionNumber && !(v.files || {})[format] ? { ...v, files: { ...(v.files || {}), [format]: ref } } : v)),
  }));
}

// { buffer, mimeType, fileName } of one version in 'docx' or 'pdf' (default: the current version)
async function getVersionFile(id, versionNumber, format) {
  if (!FORMATS.includes(format)) throw fail(400, 'format must be docx or pdf');
  const proposal = storage.getProposalById(id);
  if (!proposal) throw fail(404, 'Proposal not found');
  const snap = findVersion(proposal, versionNumber);
  if (!snap.snapshotAvailable) throw fail(404, `The content of v${snap.versionNumber} was not stored, so its ${format.toUpperCase()} cannot be produced.`);
  // <reference, only when there is a clean one>_<customer>_v<N>.<ext>; no "undefined", "PR:" or dangling dash
  const fileName = docs.buildFileName([docs.fileRef(proposal), snap.companyName || proposal.companyName || 'Proposal', `v${snap.versionNumber}`], format);

  const abs = docs.resolveStored((snap.files || {})[format]);
  if (abs && fs.existsSync(abs)) return { buffer: fs.readFileSync(abs), mimeType: MIME[format], fileName };

  const { buffer } = await renderSnapshot(proposal, snap, format);
  try { persistFile(proposal, snap.versionNumber, format, buffer); } catch (e) { console.warn('[proposalVersion] could not store file:', e.message); }
  return { buffer, mimeType: MIME[format], fileName };
}

// ---- One step of the timeline ------------------------------------------------------------------------------------------------
// The document of a step (event id): the content snapshot the step shows (its own, or for Confirmed / Completed the last numbered step's),
// with the base reference replaced by the step's reference inside the reference tags only, rendered with the template stored for that
// content version. Cached under versions/vN/steps/<eventId>/; rebuilt when missing.

// The tags of a snapshot that hold the base reference. Older snapshots do not carry the list: it is worked out once, saved, and reused.
function refTagKeysFor(proposal, snap, base) {
  if (Array.isArray(snap.refTagKeys)) return snap.refTagKeys;
  const keys = docs.refTagKeysOf(snap.fields, base);
  try {
    storage.updateProposal(keyOf(proposal), p => ({ ...p, versions: p.versions.map(v => (v.versionNumber === snap.versionNumber && !Array.isArray(v.refTagKeys) ? { ...v, refTagKeys: keys } : v)) }));
  } catch (e) { console.warn('[proposalVersion] could not store refTagKeys:', e.message); }
  return keys;
}

// { step, steps, snap, ref, fileName } of a step; the current (last) step when eventId is empty. Throws 404 for an unknown step.
function describeStep(proposal, eventId) {
  const steps = docs.buildSteps(proposal.statusHistory);
  const step = eventId ? steps.find(s => s.event.id === eventId) : steps[steps.length - 1];
  if (!step) throw fail(404, 'Step not found');
  const snap = findVersion(proposal, step.versionNumber);
  const base = docs.baseRefOf(proposal);
  const ref = docs.stepRef(base, step);
  return { step, steps, snap, base, ref };
}

// File name: <document reference>.<ext> (SLTM-REBM-WPE-48213-V2.pdf); a proposal with no usable reference falls back to company + step
function stepFileName(proposal, snap, step, ref, format) {
  // only a clean reference names the file (no label like "PR:", no trailing dash, not the short "-SP" form); otherwise company + step
  const named = docs.fileRef({ refNo: ref, proposalType: proposal.proposalType });
  return named ? `${named}.${format}` : docs.buildFileName([snap.companyName || proposal.companyName || 'Proposal', step.label || step.event.status], format);
}

async function renderStep(proposal, snap, base, ref, format, storedDocx) {
  if (!snap.templateId) throw fail(409, `This step has no template stored with it, so its ${format.toUpperCase()} cannot be rebuilt.`);
  if (format === 'pdf' && storedDocx) return { buffer: await require('./pdfService').docxToPdf(fs.readFileSync(storedDocx)) };
  const fields = docs.fieldsWithRef(snap.fields, refTagKeysFor(proposal, snap, base), base, ref);
  if (proposal.proposalType === 'productSolution') {
    const refService = require('./refService');
    return require('./productSolutionRenderService').render({ templateId: snap.templateId, fields, companyName: snap.companyName, products: snap.products, format, refNo: refService.sanitizeProductSolutionRef(base) ? ref : '' });
  }
  if (proposal.proposalType === 'solution') {
    const refService = require('./refService');
    const valid = refService.sanitizeSolutionRef(base) || (refService.isValid(base) ? base : '');
    return require('./solutionRenderService').render({ templateId: snap.templateId, fields, companyName: snap.companyName, format, refNo: valid ? ref : '' });
  }
  return require('./renderService').render({ templateId: snap.templateId, fields, format });
}

// { buffer, mimeType, fileName, ref, label } of one step in 'docx' or 'pdf' (default step: the current one)
async function getStepFile(id, eventId, format) {
  if (!FORMATS.includes(format)) throw fail(400, 'format must be docx or pdf');
  const proposal = storage.getProposalById(id);
  if (!proposal) throw fail(404, 'Proposal not found');
  const { step, snap, base, ref } = describeStep(proposal, eventId);
  if (!snap.snapshotAvailable) throw fail(404, `The content of this step was not stored, so its ${format.toUpperCase()} cannot be produced.`);
  const fileName = stepFileName(proposal, snap, step, ref, format);
  const out = buffer => ({ buffer, mimeType: MIME[format], fileName, ref, label: step.label });

  const key = keyOf(proposal);
  const cached = docs.stepFileAbs(key, snap.versionNumber, step.event.id, `.${format}`);
  if (cached && fs.existsSync(cached)) return out(fs.readFileSync(cached));

  const docxCached = format === 'pdf' ? docs.stepFileAbs(key, snap.versionNumber, step.event.id, '.docx') : null;
  const { buffer } = await renderStep(proposal, snap, base, ref, format, docxCached && fs.existsSync(docxCached) ? docxCached : null);
  try { docs.saveStepFile(key, snap.versionNumber, step.event.id, `.${format}`, buffer); } catch (e) { console.warn('[proposalVersion] could not store step file:', e.message); }
  return out(buffer);
}

// Background: store the Word file of a freshly created version (the PDF is stored the first time it is downloaded, so a
// slow PDF conversion never competes with the editor's live preview). Never throws.
function storeVersionFiles(id, versionNumber) {
  return getVersionFile(id, versionNumber, 'docx').catch(e => console.warn(`[proposalVersion] v${versionNumber} Word not stored:`, e.message));
}

module.exports = { getVersionFile, getStepFile, describeStep, storeVersionFiles, findVersion };
