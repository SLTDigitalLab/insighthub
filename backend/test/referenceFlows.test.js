process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Product AND Solution reference numbers in ONE process, interleaved, so a change to the shared code (refService, the reference patterns,
// keyOf, the render / save path) for one flow cannot silently break the other.
//   Product:  user with section + sub-section -> SLTM-<SEC>-<SUB>-<8 digits>;  admin -> exactly "SLTM-"
//   Solution: (a) SLTM-<SEC>-<SUB>-<Excel ref>  (b) SLTM-<SEC>-<SUB>-  (c) admin: exactly "SLTM-"
// For every case: the generated value, the stored proposal, the Proposal Ref. No. in the Word file, and the Word / PDF downloads.
//   node test/referenceFlows.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-flows-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
process.env.SOLUTION_AGENT_RUNS = '1';
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

require('../services/pdfService').docxToPdf = async () => Buffer.from('%PDF-1.4 stub');

// both n8n workflows are stubbed
const axios = require('axios');
let solutionAnswer = {};
const realPost = axios.post.bind(axios);
axios.post = async (url, payload, ...rest) => {
  if (/proposal-v2/.test(url)) return { data: { values: {}, refNo: 'SLTM-FAKE-AI-99999999' } }; // a reference from the product workflow is ignored
  if (/proposal-solution/.test(url)) return { data: { values: { customer_name: 'x', ref_no: 'PR:' }, missing: [], meta: { customerName: 'x' }, ...solutionAnswer } };
  return realPost(url, payload, ...rest);
};

const express = require('express');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const userService = require('../services/userService');
const storage = require('../services/proposalStorageService');
const tmplSvc = require('../services/solutionTemplateService');
const solution = require('../services/solutionService');
const { PRODUCTS } = require('../services/productCatalog');
const { build } = require('./solutionTestTemplate');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });
const wordText = b => new PizZip(b).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const FULL_PRODUCT = /^SLTM-[A-Z0-9]+-[A-Z0-9]+-\d{8}$/;

(async () => {
  userService.inviteUser({ email: 'rep@example.com', name: 'Account Manager', section: 'rebm', subSection: 'wpe' });
  userService.inviteUser({ email: 'admin@example.com', name: 'Admin', section: 'REBM', subSection: 'WPE' });
  Object.assign(userService.getUserByEmail('admin@example.com'), { section: '', subSection: '', rebmArea: '' });
  tmplSvc.uploadAndActivate({ buffer: build(), filename: 'flows_template.docx', uploadedBy: 'tester' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Customer', 'Acme'], ['Item', 'Qty'], ['Smart board', 1]]), 'Quote');
  const workbook = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/proposals', require('../routes/proposals'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/proposals`;
  const headers = { 'x-user-email': 'rep@example.com' };
  const get = (url, params) => axios.get(base + url, { headers, params, responseType: 'arraybuffer', validateStatus: () => true });

  // downloads of a saved proposal: Word shows `shown`, both files come back (200)
  const downloads = async (id, shown) => {
    const word = await get(`/${id}/download`, { format: 'docx' });
    assert.strictEqual(word.status, 200, Buffer.from(word.data).toString());
    assert.ok(wordText(Buffer.from(word.data)).includes(`Ref. No. ${shown}`) || wordText(Buffer.from(word.data)).includes(`Reference: ${shown}`), `the Word file shows ${shown}`);
    const pdf = await get(`/${id}/download`, { format: 'pdf' });
    assert.strictEqual(pdf.status, 200, Buffer.from(pdf.data).toString());
  };
  const product = async (email, company) => {
    const r = await axios.request({ method: 'post', url: `${base}/generate`, data: { business: { name: company, address: 'No 1, Galle Road' }, productIds: [PRODUCTS[0].id], user: { email, name: 'Rep' } }, validateStatus: () => true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const saved = storage.getAllProposals().find(p => p.companyName === company);
    assert.ok(saved, 'saved');
    assert.strictEqual(saved.refNo, r.data.fields.refNo);
    return { ref: r.data.fields.refNo, id: saved.id };
  };
  const solutionFlow = async (email, answer, company) => {
    solutionAnswer = { values: { customer_name: company, ref_no: 'PR:' }, meta: { customerName: company }, ...answer };
    const up = solution.createUpload({ buffer: workbook, filename: 'q.xlsx', email });
    const r = await solution.extract({ uploadId: up.uploadId, sheetName: 'Quote', user: { name: 'U', email } });
    return { ref: r.proposal.refNo, field: r.proposal.fields.ref_no, id: r.proposal.id };
  };

  const checkProduct = async () => {
    const rep = await product('rep@example.com', 'Prod Rep Co');
    assert.ok(FULL_PRODUCT.test(rep.ref) && rep.ref.startsWith('SLTM-REBM-WPE-'), rep.ref);
    assert.notStrictEqual(rep.ref, 'SLTM-FAKE-AI-99999999');
    const adm = await product('admin@example.com', 'Prod Admin Co');
    assert.strictEqual(adm.ref, 'SLTM-', 'an admin gets exactly "SLTM-", not an empty reference');
    await downloads(rep.id, rep.ref);
    await downloads(adm.id, 'SLTM-');
    storage.deleteProposal(rep.id); storage.deleteProposal(adm.id);
  };
  const checkSolution = async () => {
    const a = await solutionFlow('rep@example.com', { quotationRef: 'PR: 2026/0451' }, 'Sol A');
    assert.deepStrictEqual([a.ref, a.field], ['SLTM-REBM-WPE-2026-0451', 'SLTM-REBM-WPE-2026-0451']);
    const b = await solutionFlow('rep@example.com', { quotationRef: 'PR:' }, 'Sol B');
    assert.deepStrictEqual([b.ref, b.field], ['SLTM-REBM-WPE-', 'SLTM-REBM-WPE-']);
    const c = await solutionFlow('admin@example.com', { quotationRef: 'PR: 2026/0451' }, 'Sol C');
    assert.deepStrictEqual([c.ref, c.field], ['SLTM-', 'SLTM-']);
    for (const x of [a, b, c]) { await downloads(x.id, x.ref); storage.deleteProposal(x.id); }
  };

  console.log('Product, then Solution, then Product again, then Solution again (one process)');
  await ok('Product references (user + admin) are right, saved and printed', checkProduct);
  await ok('Solution references (a, b, c) are right, saved and printed', checkSolution);
  await ok('Product is unchanged after the Solution flow ran', checkProduct);
  await ok('Solution is unchanged after the Product flow ran', checkSolution);
  await ok('both flows share the "SLTM-" reference without sharing a record', async () => {
    const p = await product('admin@example.com', 'Shared P');
    const s = await solutionFlow('admin@example.com', {}, 'Shared S');
    assert.deepStrictEqual([p.ref, s.ref], ['SLTM-', 'SLTM-']);
    assert.notStrictEqual(p.id, s.id);
    assert.strictEqual(storage.getProposalById(p.id).proposalType, 'product');
    assert.strictEqual(storage.getProposalById(s.id).proposalType, 'solution');
    await downloads(p.id, 'SLTM-'); await downloads(s.id, 'SLTM-');
    storage.deleteProposal(p.id); storage.deleteProposal(s.id);
  });

  server.close();
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
