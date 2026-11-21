process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// The reference number never blocks an action: Word / PDF downloads (archive route and the editor's export route), Save, the original
// Excel and the file names work for a proposal whose reference is empty or junk ("PR:"). Runs the real routes in-process against a
// temporary data folder; the PDF converter is replaced by a stub (no Word / LibreOffice needed).
//   node test/solutionDownload.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solution-download-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

// stub the PDF converter before anything destructures it
const PDF_STUB = Buffer.from('%PDF-1.4 stub');
require('../services/pdfService').docxToPdf = async () => PDF_STUB;

const express = require('express');
const axios = require('axios');
const PizZip = require('pizzip');
const userService = require('../services/userService');
const tmplSvc = require('../services/solutionTemplateService');
const storage = require('../services/proposalStorageService');
const { build } = require('./solutionTestTemplate');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });

const EMAIL = 'dl-tester@example.com';
const headers = { 'x-user-email': EMAIL };
const wordText = buf => new PizZip(buf).file('word/document.xml').asText().replace(/<[^>]+>/g, '');

(async () => {
  userService.inviteUser({ email: EMAIL, name: 'DL Tester', section: 'REBM', subSection: 'WPE' });
  const template = tmplSvc.uploadAndActivate({ buffer: build(), filename: 'dl_template.docx', uploadedBy: 'tester' }).template;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/proposals', require('../routes/proposals'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/proposals`;
  const get = (url, params) => axios.get(base + url, { headers, params, responseType: 'arraybuffer', validateStatus: () => true });

  const make = (refNo, extra = {}) => storage.saveProposal({
    refNo, companyName: 'Acme: Lanka/Ltd', proposalType: 'solution', templateId: template.id, templateVersion: template.version,
    fields: { customer_name: 'Acme', ref_no: 'PR:', boq_rows: [{ item_description: 'Smart board', qty: '1' }] }, user: { email: EMAIL, name: 'DL Tester' },
    solution: { sheetName: 'S1', sourceName: 'quotation: v1.xlsx' }, ...extra,
  });

  const cases = [['an empty reference', ''], ['a junk reference ("PR:")', 'PR:']];
  for (const [label, ref] of cases) {
    const p = make(ref);
    console.log(`Solution proposal with ${label}`);
    await ok('Word download by id returns the file (200) with a clean name and an empty reference field', async () => {
      const r = await get(`/${p.id}/download`, { format: 'docx' });
      assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
      const name = /filename="([^"]+)"/.exec(r.headers['content-disposition'])[1];
      assert.ok(/^Acme_Lanka_Ltd_Original\.docx$/.test(name), name);
      assert.ok(!/undefined|null|PR|:|\/|\\|_-|-\./.test(name.replace('.docx', '')) , name);
      const text = wordText(Buffer.from(r.data));
      assert.ok(text.includes('Reference:'), 'template text is there');
      assert.ok(!text.includes('PR:'), 'no label in the document');
      assert.ok(/Reference:\s+Date:/.test(text), `empty reference field: ${text.slice(0, 120)}`);
    });
    await ok('PDF download by id returns the file (200)', async () => {
      const r = await get(`/${p.id}/download`, { format: 'pdf' });
      assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
      assert.strictEqual(r.headers['content-type'], 'application/pdf');
      assert.ok(/filename="Acme_Lanka_Ltd_Original\.pdf"/.test(r.headers['content-disposition']));
    });
    await ok('the editor export (Word and PDF) with the proposal id returns the file and an empty reference field', async () => {
      for (const format of ['docx', 'pdf']) {
        const r = await axios.post(`${base}/solution/export`, { fields: p.fields, templateId: template.id, companyName: p.companyName, format, id: p.id }, { headers, responseType: 'arraybuffer', validateStatus: () => true });
        assert.strictEqual(r.status, 200, `${format}: ${Buffer.from(r.data).toString()}`);
        const name = /filename="([^"]+)"/.exec(r.headers['content-disposition'])[1];
        assert.ok(name === `Acme_Lanka_Ltd_Solution.${format}`, name);
        if (format === 'docx') assert.ok(/Reference:\s+Date:/.test(wordText(Buffer.from(r.data))), 'empty reference field');
      }
    });
    await ok('Save, load, history, original Excel and status update all work by id', async () => {
      const put = await axios.put(`${base}/solution/${p.id}/fields`, { fields: { ...p.fields, customer_name: `Edited ${label.length}` }, companyName: 'Acme Ltd' }, { headers, validateStatus: () => true });
      assert.strictEqual(put.status, 200, JSON.stringify(put.data));
      assert.strictEqual(put.data.proposal.fields.ref_no, '', 'junk in the reference placeholder is replaced by the proposal\'s own (empty) reference');
      assert.strictEqual((await axios.get(`${base}/solution/${p.id}`, { headers, validateStatus: () => true })).status, 200);
      assert.strictEqual((await axios.get(`${base}/${p.id}/history`, { headers, validateStatus: () => true })).status, 200);
      const src = await get(`/solution/${p.id}/source`);
      assert.ok([200, 404].includes(src.status) && src.status !== 400, 'no reference validation (404 only because this test stored no Excel)');
      const st = await axios.post(`${base}/${p.id}/status`, { status: 'Sent' }, { headers, validateStatus: () => true });
      assert.strictEqual(st.status, 200, JSON.stringify(st.data));
    });
    await ok('an unknown id is a plain 404, never "Invalid reference number"', async () => {
      const r = await get('/no-such-id/download', { format: 'docx' });
      assert.strictEqual(r.status, 404);
      assert.ok(!/Invalid reference/.test(Buffer.from(r.data).toString()));
    });
    storage.deleteProposal(p.id);
  }

  console.log('Solution proposal with a real reference');
  await ok('the reference is in the file name and in the document', async () => {
    const p = make('SLTM-REBM-WPE-2026-0451');
    const r = await get(`/${p.id}/download`, { format: 'docx' });
    assert.strictEqual(r.status, 200);
    assert.ok(/filename="SLTM-REBM-WPE-2026-0451\.docx"/.test(r.headers['content-disposition']), r.headers['content-disposition']);
    assert.ok(wordText(Buffer.from(r.data)).includes('Reference: SLTM-REBM-WPE-2026-0451'));
    storage.deleteProposal(p.id);
  });

  console.log('Product proposal');
  await ok('a product proposal with no reference downloads without an "Invalid reference number" error', async () => {
    const productTemplate = require('../services/templateStoreService').getActive();
    const p = storage.saveProposal({ refNo: '', companyName: 'Prod Co', templateId: productTemplate && productTemplate.id, templateVersion: productTemplate && productTemplate.version, fields: { companyName: 'Prod Co' }, user: { email: EMAIL } });
    const r = await get(`/${p.id}/download`, { format: 'docx' });
    assert.ok(!/Invalid reference/.test(Buffer.from(r.data).toString()), 'no reference validation');
    assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
    assert.ok(/filename="Prod_Co_Original\.docx"/.test(r.headers['content-disposition']), r.headers['content-disposition']);
    storage.deleteProposal(p.id);
  });

  server.close();
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
