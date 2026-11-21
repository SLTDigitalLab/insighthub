// One-off migration of saved proposals to the version model (see services/proposalDocsService.js: migrateHistory).
//   node scripts/migrate-proposal-versions.js            -> report only (dry run)
//   node scripts/migrate-proposal-versions.js --write    -> backup + write
// The same migration also runs automatically when the server loads the file (services/proposalStorageService.js); this script
// just shows what changes and keeps a dated backup next to the data file. It is idempotent.
const fs = require('fs');
const path = require('path');
const docs = require('../services/proposalDocsService');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'saved_proposals.json');
const write = process.argv.includes('--write');

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const label = h => `v${h.versionNumber != null ? h.versionNumber : h.version} ${h.status}`;
let changed = 0;

const migrated = raw.map(p => {
  if (!p || p.schema === 'v2') return p; // the short-lived dev format is left as is (the app does not list it either)
  const next = docs.migrateHistory(p);
  if (next !== p) {
    changed++;
    const before = (p.statusHistory || []).map(label).join(' > ') || '(none)';
    const after = next.statusHistory.map(label).join(' > ');
    const snaps = next.versions.map(v => `v${v.versionNumber}:${v.snapshotAvailable ? 'snapshot' : 'no snapshot'}`).join(', ');
    console.log(`${p.refNo || p.id}  ${p.companyName || ''}\n  before: ${before}\n  after:  ${after}\n  versions: ${snaps}  (current v${next.currentVersion})`);
  }
  return next;
});

console.log(`\n${changed} of ${raw.length} proposal(s) need migrating.`);
if (write && changed) {
  const backup = `${FILE}.pre-versioning-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(FILE, backup);
  fs.writeFileSync(FILE, JSON.stringify(migrated, null, 2), 'utf8');
  console.log(`Backup: ${backup}\nWritten: ${FILE}`);
} else if (!write && changed) {
  console.log('Dry run: nothing written. Re-run with --write.');
}
