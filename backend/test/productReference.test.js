process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Product proposal reference numbers: SLTM-<section>-<sub-section>-<8 random digits> built by the backend once, when the proposal is
// created; exactly "SLTM-" for a user without a section / sub-section or when anything goes wrong. The reference never stops a proposal:
// generate (200), save to the archive by id (Draft, one "Original" history entry), Save, Word and PDF download.
// The n8n workflow and the PDF converter are stubbed. Runs the real routes against a temporary data folder.
//   node test/productReference.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'product-reference-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

require('../services/pdfService').docxToPdf = async () => Buffer.from('%PDF-1.4 stub');

const axios = require('axios');
let workflowAnswer = () => ({ values: {} });
const realPost = axios.post.bind(axios);
axios.post = async (url, payload, ...rest) => (/proposal-v2/.test(url) ? { data: workflowAnswer(payload) } : realPost(url, payload, ...rest));

const express = require('express');
const PizZip = require('pizzip');
const userService = require('../services/userService');
const storage = require('../services/proposalStorageService');
const refSvc = require('../services/refService');
const { PRODUCTS } = require('../services/productCatalog');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });
const wordText = buf => new PizZip(buf).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const FULL = /^SLTM-[A-Z0-9]+-[A-Z0-9]+-\d{8}$/;

(async () => {
  userService.inviteUser({ email: 'rep@example.com', name: 'Account Manager', section: 'rebm', subSection: 'wpe' });
  userService.inviteUser({ email: 'admin@example.com', name: 'Admin', section: 'REBM', subSection: 'WPE' });
  Object.assign(userService.getUserByEmail('admin@example.com'), { section: '', subSection: '', rebmArea: '' });

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/proposals', require('../routes/proposals'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/proposals`;
  const headers = { 'x-user-email': 'rep@example.com' };
  const get = (url, params) => axios.get(base + url, { headers, params, responseType: 'arraybuffer', validateStatus: () => true });
  const generate = (email, company) => axios.post(`${base}/generate`, { business: { name: company, address: 'No 1, Galle Road, Colombo 03' }, productIds: [PRODUCTS[0].id], user: { email, name: 'Rep' } }, { validateStatus: () => true });
  const stored = company => storage.getAllProposals().find(p => p.companyName === company);

  // generate -> archive -> Word + PDF; returns the stored proposal. `want` = the exact reference, or a RegExp.
  const wholeFlow = async (email, company, want) => {
    const r = await generate(email, company);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    typeof want === 'string' ? assert.strictEqual(r.data.fields.refNo, want) : assert.ok(want.test(r.data.fields.refNo), r.data.fields.refNo);
    assert.ok(!r.data.error && !r.data.aiError && !/reference/i.test(JSON.stringify(r.data.notes || [])), 'no error or warning');
    const saved = stored(company);
    assert.ok(saved, 'saved to the archive');
    assert.strictEqual(saved.refNo, r.data.fields.refNo);
    assert.strictEqual(saved.status, 'Draft');
    assert.strictEqual(saved.statusHistory.length, 1);
    assert.strictEqual(saved.statusHistory[0].status, 'Draft');
    const word = await get(`/${saved.id}/download`, { format: 'docx' });
    assert.strictEqual(word.status, 200, Buffer.from(word.data).toString());
    const name = /filename="([^"]+)"/.exec(word.headers['content-disposition'])[1];
    const slug = company.replace(/\W+/g, '_');
    assert.ok(!/undefined|null|-\.|_-/.test(name), name);
    const ref = r.data.fields.refNo;
    assert.strictEqual(name, ref === 'SLTM-' ? `${slug}_Original.docx` : `${ref}.docx`, name); // the Original step is named after its document reference; "SLTM-" is left out of the name
    assert.ok(wordText(Buffer.from(word.data)).includes(`Proposal Ref. No. ${ref}`) || wordText(Buffer.from(word.data)).includes(ref), 'the reference is in the Word file');
    const pdf = await get(`/${saved.id}/download`, { format: 'pdf' });
    assert.strictEqual(pdf.status, 200, Buffer.from(pdf.data).toString());
    assert.ok(/filename="[^"]+\.pdf"/.test(pdf.headers['content-disposition']));
    return { saved, ref, response: r.data };
  };

  console.log('Reference generation');
  await ok('user with section + sub-section: SLTM-<SECTION>-<SUBSECTION>-<8 digits> (upper case), the workflow\'s own reference is ignored', async () => {
    workflowAnswer = () => ({ values: {}, refNo: 'SLTM-REBM-WPE-11111111' });
    const { ref } = await wholeFlow('rep@example.com', 'Acme Lanka', FULL);
    assert.ok(ref.startsWith('SLTM-REBM-WPE-') && ref !== 'SLTM-REBM-WPE-11111111', ref);
  });
  await ok('admin without section / sub-section: exactly "SLTM-" (no digits, no fallback); two admin proposals do not clash', async () => {
    workflowAnswer = () => ({ values: {}, refNo: 'SLTM-REBM-WPC1-22222222' });
    const { saved } = await wholeFlow('admin@example.com', 'Admin Co One', 'SLTM-');
    await wholeFlow('admin@example.com', 'Admin Co Two', 'SLTM-');
    assert.notStrictEqual(saved.id, stored('Admin Co Two').id);
    assert.strictEqual((await get(`/${saved.id}/history`)).status, 200);
    // status update and edit address the right proposal by id, not the first "SLTM-"
    const st = await axios.post(`${base}/${stored('Admin Co Two').id}/status`, { status: 'Sent' }, { headers, validateStatus: () => true });
    assert.strictEqual(st.status, 200);
    assert.strictEqual(storage.getProposalById(saved.id).status, 'Draft');
    assert.strictEqual(storage.getProposalById(stored('Admin Co Two').id).status, 'Sent');
  });
  await ok('the generator uses crypto.randomInt in 10000000-99999999', () => {
    for (let i = 0; i < 200; i++) { const n = refSvc.randomEightDigits(); assert.ok(Number.isInteger(n) && n >= 10000000 && n <= 99999999, String(n)); }
  });

  console.log('Same reference for the life of the proposal');
  await ok('Save keeps the reference (new versions too); what the user types and saves is kept', async () => {
    workflowAnswer = () => ({ values: {} });
    const { saved, ref } = await wholeFlow('rep@example.com', 'Keep Co', FULL);
    const ids = [];
    let r = await axios.put(`${base}/${saved.id}/fields`, { fields: { ...saved.fields, companyName: 'Keep Co', executiveSummary: 'edited' } }, { headers, validateStatus: () => true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.proposal.refNo, ref);
    assert.strictEqual(r.data.proposal.fields.refNo, ref);
    assert.strictEqual(r.data.currentVersion, 2);
    for (const v of r.data.proposal.versions) {
      const snap = await axios.get(`${base}/${saved.id}/versions/${v.versionNumber}`, { headers, validateStatus: () => true });
      ids.push(snap.data.snapshot && snap.data.snapshot.fields && snap.data.snapshot.fields.refNo);
    }
    assert.strictEqual(ids.length, 2);
    assert.ok(ids.every(x => x === ref), `every version carries ${ref}: ${ids}`);
    assert.strictEqual((await get(`/${saved.id}/download`, { format: 'docx' })).status, 200);
    // the user types another reference into the field and saves
    r = await axios.put(`${base}/${saved.id}/fields`, { fields: { ...saved.fields, companyName: 'Keep Co', refNo: 'SLTM-CUSTOM-1' } }, { headers, validateStatus: () => true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(storage.getProposalById(saved.id).fields.refNo, 'SLTM-CUSTOM-1');
    const doc = await get(`/${saved.id}/download`, { format: 'docx' });
    assert.strictEqual(doc.status, 200);
    assert.ok(wordText(Buffer.from(doc.data)).includes('SLTM-CUSTOM-1'), 'the typed reference is printed');
    assert.strictEqual((await get(`/${saved.id}/download`, { format: 'pdf' })).status, 200);
    // an existing proposal never gets a new number: nothing but /generate (a NEW proposal) builds one
    assert.strictEqual(storage.getProposalById(saved.id).refNo, ref);
  });

  console.log('Collisions');
  await ok('a collision draws a new number', async () => {
    storage.saveProposal({ refNo: 'SLTM-REBM-WPE-10000001', companyName: 'Existing', fields: {}, user: { email: 'rep@example.com' } });
    const seq = [10000001, 10000001, 20000002];
    const real = refSvc.randomEightDigits; const calls = [];
    refSvc.randomEightDigits = () => { const n = seq.shift(); calls.push(n); return n; };
    try { await wholeFlow('rep@example.com', 'Collide Co', 'SLTM-REBM-WPE-20000002'); } finally { refSvc.randomEightDigits = real; }
    assert.deepStrictEqual(calls, [10000001, 10000001, 20000002]);
  });
  await ok('all 10 retries colliding: the proposal is still generated, with "SLTM-" (and 10 numbers were tried)', async () => {
    const real = refSvc.randomEightDigits; let n = 0;
    refSvc.randomEightDigits = () => { n += 1; return 10000001; }; // always an existing reference
    try { await wholeFlow('rep@example.com', 'Exhausted Co', 'SLTM-'); } finally { refSvc.randomEightDigits = real; }
    assert.strictEqual(n, 10);
  });

  console.log('The reference never blocks');
  await ok('the generator throws: 200, "SLTM-", saved, Word and PDF work', async () => {
    const real = refSvc.buildProductRef;
    refSvc.buildProductRef = () => { throw new Error('profile lookup exploded'); };
    try { await wholeFlow('rep@example.com', 'Throws Co', 'SLTM-'); } finally { refSvc.buildProductRef = real; }
  });
  await ok('the storage lookup throws during the collision check: 200 and "SLTM-"', async () => {
    const real = refSvc.find;
    refSvc.find = () => { throw new Error('disk error'); };
    try { await wholeFlow('rep@example.com', 'Disk Co', 'SLTM-'); } finally { refSvc.find = real; }
  });
  await ok('a malformed generated reference is replaced by "SLTM-"', async () => {
    const real = refSvc.buildProductRef;
    refSvc.buildProductRef = () => 'not a reference';
    try { await wholeFlow('rep@example.com', 'Malformed Co', 'SLTM-'); } finally { refSvc.buildProductRef = real; }
  });
  await ok('the safety-net pattern accepts a full product reference and exactly "SLTM-", nothing else', () => {
    ['SLTM-REBM-WPE-70793142', 'SLTM-'].forEach(r => assert.ok(refSvc.PRODUCT_REF_PATTERN.test(r), r));
    ['', 'SLTM', 'SLTM-REBM-WPE-', 'SLTM-REBM-WPE-1234567', 'sltm-REBM-WPE-70793142', 'SLTM-REBM-70793142'].forEach(r => assert.ok(!refSvc.PRODUCT_REF_PATTERN.test(r), r));
  });
  await ok('the workflow failing is still the only thing that can stop generation (not the reference)', async () => {
    workflowAnswer = () => ({ error: 'boom' });
    const r = await generate('rep@example.com', 'Wf Down');
    assert.strictEqual(r.status, 502);
    assert.ok(!/reference/i.test(JSON.stringify(r.data)), r.data.error);
    workflowAnswer = () => ({ values: {} });
  });

  server.close();
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
