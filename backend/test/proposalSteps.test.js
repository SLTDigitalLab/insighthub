process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Version history steps: labels, per-step document reference and content, the status cascade (422) and the view-only guard for
// Confirmed / Completed (409). Runs the real routes in-process against a temporary data folder (never the real data); the PDF converter is
// replaced by a stub.
//   node test/proposalSteps.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-steps-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

require('../services/pdfService').docxToPdf = async () => Buffer.from('%PDF-1.4 stub');

const express = require('express');
const axios = require('axios');
const PizZip = require('pizzip');
const userService = require('../services/userService');
const tmplSvc = require('../services/solutionTemplateService');
const storage = require('../services/proposalStorageService');
const docs = require('../services/proposalDocsService');
const { build } = require('./solutionTestTemplate');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });

const EMAIL = 'steps-tester@example.com';
const headers = { 'x-user-email': EMAIL };
const wordText = buf => new PizZip(buf).file('word/document.xml').asText().replace(/<[^>]+>/g, '');

(async () => {
  userService.inviteUser({ email: EMAIL, name: 'Steps Tester', section: 'REBM', subSection: 'WPE' });
  const template = tmplSvc.uploadAndActivate({ buffer: build(), filename: 'steps_template.docx', uploadedBy: 'tester' }).template;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/proposals', require('../routes/proposals'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/proposals`;
  const call = (method, url, data, params) => axios({ method, url: base + url, data, params, headers, validateStatus: () => true, ...(method === 'get' && params && params.format ? { responseType: 'arraybuffer' } : {}) });
  const download = (id, format, step) => call('get', `/${id}/download`, undefined, { format, ...(step ? { step } : {}) });
  const nameOf = r => /filename="([^"]+)"/.exec(r.headers['content-disposition'])[1];
  const history = async id => (await call('get', `/${id}/history`)).data.history;
  const setStatus = (id, status, extra = {}) => call('post', `/${id}/status`, { status, ...extra });
  const edit = (id, fields) => call('put', `/solution/${id}/fields`, { fields, companyName: 'Acme Ltd' });
  const make = (refNo, extra = {}) => storage.saveProposal({
    refNo, companyName: 'Acme Ltd', proposalType: 'solution', templateId: template.id, templateVersion: template.version,
    fields: { customer_name: 'Original Customer', ref_no: refNo, boq_rows: [{ item_description: 'Smart board', qty: '1' }] }, user: { email: EMAIL, name: 'Steps Tester' },
    solution: { sheetName: 'S1', sourceName: 'q.xlsx' }, ...extra,
  });

  console.log('Labels and document references (unit)');
  await ok('Original, V1.., no label for Confirmed / Completed; skipped in the count', () => {
    const ev = (i, status, v) => ({ id: `e${i}`, status, versionNumber: v, createdAt: `2026-01-0${i}T00:00:00Z`, sequence: i });
    const steps = docs.buildSteps([ev(1, 'Draft', 1), ev(2, 'Sent', 1), ev(3, 'Revised', 2), ev(4, 'Revised & Sent', 2), ev(5, 'Confirmed', 2), ev(6, 'Completed', 2)]);
    assert.deepStrictEqual(steps.map(s => s.label), ['Original', 'V1', 'V2', 'V3', '', '']);
    assert.strictEqual(steps[4].versionNumber, 2);
    assert.strictEqual(docs.stepRef('SLTM-REBM-WPE-48213', steps[2]), 'SLTM-REBM-WPE-48213-V2');
    assert.strictEqual(docs.stepRef('SLTM-', steps[2]), 'SLTM-V2');
    assert.strictEqual(docs.stepRef('SLTM-REBM-WPE-', steps[2]), 'SLTM-REBM-WPE-V2');
    assert.strictEqual(docs.stepRef('SLTM-REBM-WPE-48213', steps[4]), 'SLTM-REBM-WPE-48213');
    assert.strictEqual(docs.stepRef('SLTM-REBM-WPE-48213', steps[0]), 'SLTM-REBM-WPE-48213');
    // a history that does not follow the cascade is labelled by position, skipping Confirmed / Completed
    const odd = docs.buildSteps([ev(1, 'Draft', 1), ev(2, 'Confirmed', 1), ev(3, 'Sent', 1), ev(4, 'Revised', 2)]);
    assert.deepStrictEqual(odd.map(s => s.label), ['Original', '', 'V1', 'V2']);
  });
  await ok('the cascade only offers later statuses', () => {
    assert.deepStrictEqual(docs.nextStatuses('Draft'), ['Sent', 'Revised', 'Revised & Sent', 'Confirmed', 'Completed']);
    assert.deepStrictEqual(docs.nextStatuses('Revised'), ['Revised & Sent', 'Confirmed', 'Completed']);
    assert.deepStrictEqual(docs.nextStatuses('Revised & Sent'), ['Confirmed', 'Completed']);
    assert.deepStrictEqual(docs.nextStatuses('Completed'), []);
  });

  console.log('Full flow (solution proposal)');
  const REF = 'SLTM-REBM-WPE-48213';
  const p = make(REF);
  let originalId;
  await ok('new proposal: Original only; document reference = base ref', async () => {
    const h = await history(p.id);
    assert.strictEqual(h.length, 1); originalId = h[0].id;
    const r = await download(p.id, 'docx');
    assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
    assert.strictEqual(nameOf(r), `${REF}.docx`);
    assert.ok(wordText(Buffer.from(r.data)).includes(`Reference: ${REF}   Date`));
  });
  await ok('Draft → Sent is V1 with <base>-V1; Draft and Sent are no longer accepted (422)', async () => {
    assert.strictEqual((await setStatus(p.id, 'Sent')).status, 200);
    const r = await download(p.id, 'docx');
    assert.strictEqual(nameOf(r), `${REF}-V1.docx`);
    assert.ok(wordText(Buffer.from(r.data)).includes(`Reference: ${REF}-V1`));
    for (const s of ['Draft', 'Sent']) { const x = await setStatus(p.id, s); assert.strictEqual(x.status, 422, s); assert.ok(x.data.error); }
    assert.strictEqual((await setStatus(p.id, 'Nonsense')).status, 400);
  });
  await ok('editing at Sent saves a new step: V2, status Revised, <base>-V2 with the new content', async () => {
    const cur = (await call('get', `/solution/${p.id}`)).data.proposal;
    const put = await edit(p.id, { ...cur.fields, customer_name: 'Edited Customer' });
    assert.strictEqual(put.status, 200, JSON.stringify(put.data));
    const h = await history(p.id);
    assert.strictEqual(h[h.length - 1].status, 'Revised');
    const steps = docs.buildSteps(h);
    assert.strictEqual(steps[steps.length - 1].label, 'V2');
    const r = await download(p.id, 'docx');
    assert.strictEqual(nameOf(r), `${REF}-V2.docx`);
    const text = wordText(Buffer.from(r.data));
    assert.ok(text.includes(`Reference: ${REF}-V2`) && text.includes('Customer: Edited Customer'), text.slice(0, 200));
  });
  await ok('Revised → Revised & Sent is V3; only Confirmed / Completed remain (Sent, Revised → 422)', async () => {
    assert.strictEqual((await setStatus(p.id, 'Revised & Sent')).status, 200);
    assert.strictEqual(nameOf(await download(p.id, 'docx')), `${REF}-V3.docx`);
    for (const s of ['Sent', 'Revised', 'Revised & Sent', 'Draft']) assert.strictEqual((await setStatus(p.id, s)).status, 422, s);
  });
  await ok('Confirmed: no label, base ref, the content of V3; save / regenerate are 409', async () => {
    assert.strictEqual((await setStatus(p.id, 'Confirmed')).status, 200);
    const h = await history(p.id);
    assert.strictEqual(docs.buildSteps(h).pop().label, '');
    const r = await download(p.id, 'docx');
    assert.strictEqual(nameOf(r), `${REF}.docx`);
    const text = wordText(Buffer.from(r.data));
    assert.ok(text.includes(`Reference: ${REF}   Date`) && text.includes('Customer: Edited Customer'), text.slice(0, 200));
    const cur = (await call('get', `/solution/${p.id}`)).data.proposal;
    assert.strictEqual((await edit(p.id, { ...cur.fields, customer_name: 'Nope' })).status, 409);
    assert.strictEqual((await call('post', `/solution/${p.id}/regenerate`, { user: { name: 'x' } })).status, 409);
    assert.strictEqual((await edit(p.id, cur.fields)).status, 409); // an unchanged save is blocked too
    assert.strictEqual((await history(p.id)).length, h.length, 'nothing was added');
    assert.deepStrictEqual(docs.nextStatuses('Confirmed'), ['Completed']);
    assert.strictEqual((await setStatus(p.id, 'Sent')).status, 422);
  });
  await ok('Completed is final (any status → 422); its PDF still downloads', async () => {
    assert.strictEqual((await setStatus(p.id, 'Completed')).status, 200);
    for (const s of ['Draft', 'Sent', 'Revised', 'Revised & Sent', 'Confirmed', 'Completed']) assert.strictEqual((await setStatus(p.id, s)).status, 422, s);
    const r = await download(p.id, 'pdf');
    assert.strictEqual(r.status, 200); assert.strictEqual(nameOf(r), `${REF}.pdf`);
  });
  await ok('clicking Original downloads the base-ref document with the original content; each step is cached', async () => {
    const r = await download(p.id, 'docx', originalId);
    assert.strictEqual(nameOf(r), `${REF}.docx`);
    const text = wordText(Buffer.from(r.data));
    assert.ok(text.includes(`Reference: ${REF}   Date`) && text.includes('Customer: Original Customer'), text.slice(0, 200));
    const dir = path.join(process.env.UPLOADS_DIR, 'proposals', REF, 'versions', 'v1', 'steps', originalId);
    assert.ok(fs.existsSync(path.join(dir, 'proposal.docx')), 'cached under versions/v1/steps/<eventId>/');
    fs.unlinkSync(path.join(dir, 'proposal.docx')); // rebuilt when missing
    assert.strictEqual((await download(p.id, 'docx', originalId)).status, 200);
    assert.strictEqual((await download(p.id, 'docx', 'no-such-step')).status, 404);
  });
  await ok('refTagKeys are recorded per content version', () => {
    const rec = storage.getProposalById(p.id);
    assert.ok(rec.versions.every(v => Array.isArray(v.refTagKeys) && v.refTagKeys.includes('ref_no')), JSON.stringify(rec.versions.map(v => v.refTagKeys)));
  });
  await ok('an older snapshot without refTagKeys is worked out once and saved', async () => {
    const q = make('SLTM-REBM-WPE-77777');
    storage.updateProposal(q.id, r => ({ ...r, versions: r.versions.map(v => { const { refTagKeys, ...rest } = v; return rest; }) }));
    assert.strictEqual(storage.getProposalById(q.id).versions[0].refTagKeys, undefined);
    assert.strictEqual((await download(q.id, 'docx')).status, 200);
    assert.deepStrictEqual(storage.getProposalById(q.id).versions[0].refTagKeys, ['ref_no']);
  });

  console.log('Admin proposal (reference "SLTM-")');
  await ok('V1 reads SLTM-V1; the Original keeps the base and a clean file name', async () => {
    const a = make('SLTM-');
    assert.strictEqual((await setStatus(a.id, 'Sent')).status, 200);
    const r = await download(a.id, 'docx');
    assert.strictEqual(nameOf(r), 'SLTM-V1.docx');
    assert.ok(wordText(Buffer.from(r.data)).includes('Reference: SLTM-V1'));
    const first = (await history(a.id))[0];
    assert.ok(wordText(Buffer.from((await download(a.id, 'docx', first.id)).data)).includes('Reference: SLTM-   Date'));
  });
  await ok('"SLTM-REBM-WPE-" (no Excel ref) reads SLTM-REBM-WPE-V2', async () => {
    const a = make('SLTM-REBM-WPE-');
    await setStatus(a.id, 'Sent');
    const cur = (await call('get', `/solution/${a.id}`)).data.proposal;
    await edit(a.id, { ...cur.fields, customer_name: 'Changed' });
    assert.strictEqual(nameOf(await download(a.id, 'docx')), 'SLTM-REBM-WPE-V2.docx');
  });

  server.close();
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
