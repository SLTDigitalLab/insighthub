const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const docs = require('./proposalDocsService');

// Saved proposals ("Generated Proposals"). Flat file, same pattern as the rest of the app.
// A record holds the edit screen's `fields` (proposal/fieldSchema.js keys) plus the template version it was generated with.
// Templates are not handled here: see templateStoreService.js.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROPOSALS_FILE = path.join(DATA_DIR, 'saved_proposals.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROPOSALS_FILE)) {
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify([]), 'utf8');
}

// The whole file as stored (nothing is migrated or dropped here, so a write never changes records it does not touch)
function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error('[proposalStorage] Error reading saved proposals:', err.message);
    return [];
  }
}

// Records of the short-lived 'v2' dev format (values instead of fields) cannot be opened; they are left in the file but not listed.
// Reads normalise a record in memory only (docs.normalize); the file is migrated ONLY by scripts/migrate-proposal-versions.js --write.
function readProposals() {
  return readAll().filter(p => p && p.schema !== 'v2');
}

function writeProposals(list) {
  try {
    fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[proposalStorage] Error writing saved proposals:', err.message);
  }
}

const NOT_MIGRATED = 'This proposal is stored in the old format. Run "node scripts/migrate-proposal-versions.js --write" in the backend folder, then try again.';
const matches = (p, key) => !!p && p.schema !== 'v2' && ((key && p.refNo === key) || p.id === key); // a proposal without a reference number is found by its id

// Changing a stored record needs the version model; an old-format record is never converted as a side effect of a save
const SENT_STATUSES = ['Sent', 'Revised & Sent', 'Confirmed', 'Completed'];

function assertMigrated(record) {
  if (!docs.isMigrated(record)) throw Object.assign(new Error(NOT_MIGRATED), { status: 409 });
}

module.exports = {
  saveProposal: ({ refNo, companyName, business = {}, fields = {}, templateId = '', templateVersion = null, user = {}, products = [], proposalType = 'product', solution = null }) => {
    const list = readAll();
    const now = new Date().toISOString();
    const proposal = {
      id: uuidv4(),
      refNo: proposalType === 'solution' || proposalType === 'productSolution' ? (refNo || '') : (refNo || fields.refNo || ''), // a solution proposal's reference is only ever the built one
      companyName: companyName || fields.companyName || business.name || '',
      category: business.category || '',
      address: business.address || '',
      date: fields.proposalDate || now,
      generatedBy: user.email || '',
      generatorName: user.name || '',
      products: Array.isArray(products) ? products : [],
      fields,
      templateId,
      templateVersion,
      createdAt: now,
      status: 'Draft',
      versioning: docs.VERSIONING,
      currentVersion: 1,
      // only solution proposals carry a type; a record without one is a product proposal (docs.normalize)
      ...(proposalType === 'solution' || proposalType === 'productSolution' ? { proposalType, solution: solution || {} } : {}),
    };
    // v1 = the content as first generated; its Draft event is the first history entry
    proposal.versions = [docs.makeSnapshot(proposal, { versionNumber: 1, reason: 'created', userEmail: user.email || '', createdAt: now })];
    proposal.statusHistory = [docs.makeEvent(proposal, { status: 'Draft', versionNumber: 1, userEmail: user.email || '', createdAt: now })];
    list.unshift(proposal);
    writeProposals(list);
    return proposal;
  },

  getAllProposals: () => readProposals().map(docs.normalize),

  getProposalById: (id) => docs.normalize((id && readProposals().find(p => p.id === id || p.refNo === id)) || null),

  // false when the stored record is still in the old format (see scripts/migrate-proposal-versions.js)
  isMigrated: (id) => { const p = id && readProposals().find(r => r.id === id || r.refNo === id); return !p || docs.isMigrated(p); },

  // Applies mutate(record) to the stored record and saves it; returns the normalised record, or null if not found
  updateProposal: (refNo, mutate) => {
    const list = readAll();
    const idx = list.findIndex(p => matches(p, refNo));
    if (idx === -1) return null;
    assertMigrated(list[idx]);
    const next = mutate(docs.normalize(list[idx]));
    list[idx] = next;
    writeProposals(list);
    return docs.normalize(next);
  },

  // A content change (edit saved from the editor, regenerated revision). mutate(record) returns the record with the new content.
  // When the content (fields / company name) differs, or `force` is set, this creates the next version: a full snapshot plus a
  // history event on it; earlier versions and their files are never touched. Otherwise it only saves what mutate changed.
  // Returns { proposal, changed, versionNumber } or null when the proposal does not exist.
  reviseProposal: (refNo, mutate, { reason = 'edit', userEmail = '', note = '', force = false } = {}) => {
    const list = readAll();
    const idx = list.findIndex(p => matches(p, refNo));
    if (idx === -1) return null;
    assertMigrated(list[idx]);
    const before = docs.normalize(list[idx]);
    docs.assertEditable(before); // Confirmed / Completed proposals are view-only (409)
    const after ={ ...mutate(before), versions: before.versions, statusHistory: before.statusHistory, currentVersion: before.currentVersion };
    const changed = force || !docs.sameJson(before.fields, after.fields) || (before.companyName || '') !== (after.companyName || '');
    if (!changed) {
      list[idx] = after;
      writeProposals(list);
      return { proposal: docs.normalize(after), changed: false, versionNumber: before.currentVersion };
    }
    const now = new Date().toISOString();
    const versionNumber = before.currentVersion + 1;
    // Only a proposal that has already gone to the customer becomes Revised; a Draft (or an already Revised one) keeps its status
    const status = SENT_STATUSES.includes(before.status) ? 'Revised' : before.status;
    const next = { ...after, currentVersion: versionNumber, status };
    next.versions = [...before.versions, docs.makeSnapshot(next, { versionNumber, reason, userEmail, createdAt: now })];
    next.statusHistory = [...before.statusHistory, docs.makeEvent(next, { status, versionNumber, note: note || (reason === 'revision' ? 'Revision generated' : 'Content edited'), userEmail, createdAt: now })];
    list[idx] = next;
    writeProposals(list);
    return { proposal: docs.normalize(next), changed: true, versionNumber };
  },

  deleteProposal: (id) => {
    const list = readAll();
    const target = id && list.find(p => p && (p.id === id || p.refNo === id));
    writeProposals(list.filter(p => !p || (p.id !== id && (!id || p.refNo !== id))));
    if (target) docs.removeProposalDir(docs.keyOf(target)); // the folder is named after the reference or, without a usable one, the id
    return true;
  },
};
