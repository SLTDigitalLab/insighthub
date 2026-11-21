process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Product + Solution proposals (the third proposal type). Runs the real routes and services in-process against a temporary data folder;
// the PDF converter and the n8n workflow are stubbed (no Word / LibreOffice / network).
//
// The stubbed workflow plays the AI: it reads the TAG SCHEMA it is sent (so any tag the active template has is filled, whatever its name),
// reads the quotation reference from the sheet's cells, and builds the reference number with the REAL "Build Reference" Code node taken from
// n8n-workflows/Product_Solution_Proposal_Agent.json.
//   node test/productSolution.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'product-solution-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
process.env.PRODUCT_SOLUTION_AGENT_RUNS = '1';
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

require('../services/pdfService').docxToPdf = async () => Buffer.from('%PDF-1.4 stub');

const axios = require('axios');
const express = require('express');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const userService = require('../services/userService');
const storage = require('../services/proposalStorageService');
const store = require('../services/templateStoreService');
const solutionTemplates = require('../services/solutionTemplateService');
const psTemplates = require('../services/productSolutionTemplateService');
const solution = require('../services/solutionService');
const ps = require('../services/productSolutionService');
const refService = require('../services/refService');
const { extractTags } = require('../services/templateTagService');
const { PRODUCTS } = require('../services/productCatalog');
const { build: buildSolutionTemplate } = require('./solutionTestTemplate');

// ---- the stubbed workflow ----------------------------------------------------------------------------------------------------
const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'n8n-workflows', 'Product_Solution_Proposal_Agent.json'), 'utf8'));
const buildReferenceCode = WORKFLOW.nodes.find(n => n.name === 'Build Reference').parameters.jsCode;
const CUSTOMER = 'Acme Lanka (Pvt) Ltd';
const sent = []; // every payload the backend sent to the workflow
let mode = 'normal'; // normal | noRef | invalidRef | refError | down | refErrorBody
let extraAnswer = {};

const fillTag = (tag, i = 0) => (tag.type === 'loop'
  ? [0, 1].map(j => Object.fromEntries((tag.children || []).map(c => [c.name, fillTag(c, j)])))
  : (tag.type === 'rawXml' ? `Paragraph one of ${tag.name}\nParagraph two of ${tag.name}` : `AI:${tag.name}${i}`));

// the "AI": reads the Excel generically (the cell after a "PR:" label), fills EVERY tag it was sent
function stubAnswer(payload) {
  const cells = payload.grid.cells;
  const label = cells.findIndex(c => /^pr:?$/i.test(String(c.value).trim()));
  const quotationRef = label !== -1 && cells[label + 1] && cells[label + 1].row === cells[label].row ? String(cells[label + 1].value) : ''; // the next cell of the same row
  const values = {};
  const diagramTags = [];
  payload.schema.forEach(tag => {
    values[tag.name] = fillTag(tag);
    if (tag.type === 'text' && /company/i.test(tag.name)) values[tag.name] = CUSTOMER; // customer name read from the Excel
    if (tag.type === 'rawXml' && /diagram/i.test(tag.name)) { values[tag.name] = ''; diagramTags.push(tag.name); }
  });
  return { values, missing: [], userSource: [], diagramTags, quotationRef, meta: { customerName: CUSTOMER } };
}

// the real "Build Reference" node
function buildReference(payload, answer) {
  const run = new Function('$input', '$', buildReferenceCode);
  return run({ first: () => ({ json: answer }) }, () => ({ first: () => ({ json: { body: payload } }) }))[0].json;
}

// raw texts the "AI" answers next (each: payload => text). They go through the REAL "Parse AI Output" node, then the real "Build Reference" node.
const aiQueue = [];
const parseCode = WORKFLOW.nodes.find(n => n.name === 'Parse AI Output').parameters.jsCode;
const runParse = (payload, text) => new Function('$input', '$', parseCode)({ first: () => ({ json: { output: text } }) }, () => ({ first: () => ({ json: { schema: payload.schema } }) }))[0].json;
const goodText = payload => JSON.stringify(stubAnswer(payload));

// the PRODUCT workflow (Proposal v2), asked for the product parts: a customer introduction and recommended products with reasons
const v2Sent = [];
let v2Mode = 'normal'; // normal | down
const realPost = axios.post.bind(axios);
axios.post = async (url, payload, ...rest) => {
  if (/proposal-v2/.test(url)) {
    v2Sent.push(payload);
    if (v2Mode === 'down') throw Object.assign(new Error('connect ECONNREFUSED'), { response: { status: 500 } });
    return { data: { values: { aboutDescription: `ABOUT ${payload.company.name}`, recommendations: [{ id: payload.products[0].id, reason: 'REASON A', highPriority: true }, { id: payload.catalogue.find(c => c.name === 'Managed Firewall').id, reason: 'REASON B', highPriority: false }] } } };
  }
  if (!/proposal-product-solution/.test(url)) return realPost(url, payload, ...rest);
  sent.push(payload);
  if (mode === 'down') throw Object.assign(new Error('connect ECONNREFUSED'), { response: { status: 500 } });
  if (aiQueue.length) {
    const parsedOut = runParse(payload, aiQueue.shift()(payload));
    return { data: parsedOut.error ? parsedOut : buildReference(payload, parsedOut) };
  }
  const answer = { ...stubAnswer(payload), ...extraAnswer };
  const built = buildReference(payload, answer);
  if (mode === 'noRef') return { data: { ...built, refNo: '', quotationRef: '' } };
  if (mode === 'invalidRef') return { data: { ...built, refNo: 'PR: 2026/0451' } };
  if (mode === 'refError') return { data: { ...built, refNo: '', refError: 'boom' } };
  if (mode === 'refErrorBody') { const { refNo, ...rest2 } = built; return { data: { ...rest2, error: 'reference number could not be built' } }; }
  return { data: built };
};

// ---- harness ---------------------------------------------------------------------------------------------------------------------
let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });
const wordText = b => new PizZip(b).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const workbook = rows => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Quote'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
const WITH_REF = workbook([['Customer', CUSTOMER], ['PR:', '2026/0451'], ['Item', 'Qty'], ['Smart board', 1]]);
const NO_REF = workbook([['Customer', CUSTOMER], ['PR:', ''], ['Item', 'Qty'], ['Smart board', 1]]);

// the seed template with one paragraph added (extra tag) or one tag taken out (removed tag)
const seedBuffer = () => store.readFile(store.list(store.PS_TYPE).slice().sort((a, b) => a.version - b.version)[0].id);
function changeTemplate(fn) {
  const zip = new PizZip(seedBuffer());
  zip.file('word/document.xml', fn(zip.file('word/document.xml').asText()));
  return zip.generate({ type: 'nodebuffer' });
}
const withExtraTag = () => changeTemplate(xml => xml.replace(/<w:sectPr[^>]*>(?![\s\S]*<w:sectPr)/, m => `<w:p><w:r><w:t xml:space="preserve">Warranty: {warrantyPeriod} Spare: {#spares}{sparePart}{/spares}</w:t></w:r></w:p>${m}`));
const withoutTag = name => changeTemplate(xml => { assert.ok(xml.includes(`{${name}}`), `${name} is in the seed template`); return xml.split(`{${name}}`).join(''); });

(async () => {
  userService.inviteUser({ email: 'rep@example.com', name: 'Account Manager', section: 'rebm', subSection: 'wpe' });
  userService.inviteUser({ email: 'admin@example.com', name: 'Admin', section: 'REBM', subSection: 'WPE', role: 'admin' });
  Object.assign(userService.getUserByEmail('admin@example.com'), { section: '', subSection: '', rebmArea: '' });
  solutionTemplates.uploadAndActivate({ buffer: buildSolutionTemplate(), filename: 'solution_tpl.docx', uploadedBy: 'tester' });

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/proposals', require('../routes/proposals'));
  const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/proposals`;
  const asRep = { 'x-user-email': 'rep@example.com' };
  const http2 = (method, url, data, params) => axios.request({ method, url: base + url, data, params, headers: asRep, responseType: 'arraybuffer', validateStatus: () => true });

  const productIds = [PRODUCTS[0].id, PRODUCTS[1].id];
  const generate = async (email, buffer = WITH_REF) => {
    const up = solution.createUpload({ buffer, filename: 'q.xlsx', email });
    return ps.extract({ uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U', email } });
  };
  const download = async (id, format, version) => http2('get', `/${id}/download`, undefined, { format, version });

  console.log('Template: its own type, seeded, listed from its own tags');
  await ok('the shipped combined template is the first active Product + Solution version, and the other two templates are unchanged', () => {
    const t = store.getActive(store.PS_TYPE);
    assert.ok(t && t.version === 1 && t.type === 'productSolution' && t.isActive, 'seeded');
    assert.deepStrictEqual(t.tags.map(x => x.name), extractTags(seedBuffer()).tags.map(x => x.name), 'tags are those of the file');
    assert.ok(store.getActive('product').type === 'product' && store.getActive('solution').type === 'solution');
    assert.strictEqual(store.list(store.PS_TYPE).length, 1);
  });

  console.log('Reference number (built by the workflow Code node, checked by the backend)');
  const checkProposal = (p, ref) => {
    assert.strictEqual(p.proposalType, 'productSolution');
    assert.strictEqual(p.refNo, ref);
    assert.strictEqual(p.companyName, CUSTOMER, 'customer name comes from the Excel (the request has no business)');
    assert.deepStrictEqual(p.products.map(x => x.id), productIds);
  };
  await ok('user with section + sub-section and an Excel ref: SLTM-REBM-WPE-SP2026-0451', async () => {
    const r = await generate('rep@example.com');
    checkProposal(r.proposal, 'SLTM-REBM-WPE-SP2026-0451');
    const last = sent[sent.length - 1];
    assert.deepStrictEqual(last.refRequest, { type: 'productSolution', section: 'REBM', subSection: 'WPE' });
    assert.ok(!('refNo' in last), 'a new proposal sends a reference REQUEST, not a reference');
    assert.strictEqual(r.proposal.fields.refNo, 'SLTM-REBM-WPE-SP2026-0451', 'the template\'s reference tag prints the saved reference');
    assert.strictEqual(r.proposal.fields.companyName, CUSTOMER);
    assert.strictEqual(refService.sanitizeProductSolutionRef(r.proposal.refNo), r.proposal.refNo);
  });
  await ok('user with section + sub-section, Excel without a usable ref: SLTM-REBM-WPE-SP (stored under the proposal id, no ref in file names)', async () => {
    const r = await generate('rep@example.com', NO_REF);
    checkProposal(r.proposal, 'SLTM-REBM-WPE-SP');
    const docs = require('../services/proposalDocsService');
    assert.strictEqual(docs.keyOf(r.proposal), r.proposal.id);
    assert.strictEqual(docs.fileRef(r.proposal), '');
    const w = await download(r.proposal.id, 'docx');
    assert.strictEqual(w.status, 200);
    assert.strictEqual(/filename="([^"]+)"/.exec(w.headers['content-disposition'])[1], 'Acme_Lanka_Pvt_Ltd_Original.docx');
  });
  await ok('admin (no section / sub-section): exactly "SLTM-" (stored under the proposal id)', async () => {
    const r = await generate('admin@example.com');
    checkProposal(r.proposal, 'SLTM-');
    assert.ok(!('refRequest' in sent[sent.length - 1]), 'no section: nothing to build a reference from');
    assert.strictEqual(require('../services/proposalDocsService').keyOf(r.proposal), r.proposal.id);
  });
  await ok('a full reference is kept in the file name and as the storage key', async () => {
    const full = storage.getAllProposals().find(p => p.refNo === 'SLTM-REBM-WPE-SP2026-0451');
    assert.strictEqual(require('../services/proposalDocsService').keyOf(full), 'SLTM-REBM-WPE-SP2026-0451');
    const w = await download(full.id, 'docx');
    assert.strictEqual(/filename="([^"]+)"/.exec(w.headers['content-disposition'])[1], 'SLTM-REBM-WPE-SP2026-0451.docx');
  });
  await ok('the same Excel ref twice: the second proposal gets the short form (the full reference is never used twice)', async () => {
    const r = await generate('rep@example.com');
    assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-SP');
  });

  console.log('The reference can never stop generation');
  for (const [m, label] of [['noRef', 'the workflow returns no reference'], ['invalidRef', 'the workflow returns an invalid reference ("PR: 2026/0451")'], ['refError', 'the workflow reports a reference error'], ['refErrorBody', 'the workflow answers an error about the reference together with the values']]) {
    await ok(`${label}: 200-style success with the fallback reference`, async () => {
      mode = m;
      const warns = []; const w = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
      try {
        const r = await generate('rep@example.com', workbook([['Customer', CUSTOMER], ['PR:', `X${m}`], ['Item', 'Qty'], ['b', 1]]));
        assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-SP');
        assert.ok(warns.some(x => /Product \+ Solution reference/.test(x)), `a warning is logged (${warns.join(' | ')})`);
        const a = await generate('admin@example.com');
        assert.strictEqual(a.proposal.refNo, 'SLTM-');
        assert.strictEqual((await download(r.proposal.id, 'pdf')).status, 200);
        assert.strictEqual((await download(r.proposal.id, 'docx')).status, 200);
      } finally { console.warn = w; mode = 'normal'; }
    });
  }
  await ok('a reference for another section is not accepted for this user', () => {
    assert.strictEqual(refService.resolveProductSolutionRef({ section: 'rebm', subSection: 'wpe' }, 'SLTM-OTHER-SEC-SP1'), 'SLTM-REBM-WPE-SP');
    assert.strictEqual(refService.resolveProductSolutionRef({}, 'SLTM-REBM-WPE-SP1'), 'SLTM-');
  });
  await ok('the workflow being down is a retryable error (there is nothing to put in the proposal) and the Excel stays', async () => {
    mode = 'down';
    try {
      const up = solution.createUpload({ buffer: WITH_REF, filename: 'q.xlsx', email: 'rep@example.com' });
      const before = storage.getAllProposals().length;
      const r = await http2('post', '/product-solution/extract', { uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U' } });
      assert.strictEqual(r.status, 502);
      assert.strictEqual(JSON.parse(Buffer.from(r.data).toString()).retry, true);
      assert.strictEqual(storage.getAllProposals().length, before);
      mode = 'normal';
      assert.strictEqual((await http2('post', '/product-solution/extract', { uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U' } })).status, 200, 'the same upload works on retry');
    } finally { mode = 'normal'; }
  });

  await ok('generation works with NO business in the request; the customer name and the company-name tags come only from the Excel; the logo stays empty', async () => {
    const up = solution.createUpload({ buffer: workbook([['Customer', CUSTOMER], ['PR:', 'NB-1'], ['Item', 'Qty'], ['b', 1]]), filename: 'q.xlsx', email: 'rep@example.com' });
    const r = await http2('post', '/product-solution/extract', { uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U' } });
    assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
    const p = JSON.parse(Buffer.from(r.data).toString()).proposal;
    assert.strictEqual(p.refNo, 'SLTM-REBM-WPE-SPNB-1');
    assert.strictEqual(p.companyName, CUSTOMER, 'from the (stubbed) AI reading the Excel');
    assert.ok(!p.fields.__meta.leadLogo, 'no logo is looked up');
    assert.ok(!('business' in (p.solution || {})));
    const w = await download(p.id, 'docx');
    assert.strictEqual(w.status, 200);
    assert.ok(wordText(Buffer.from(w.data)).includes(CUSTOMER));
    assert.strictEqual((await download(p.id, 'pdf')).status, 200);
  });
  await ok('a request that still carries a business is not an error and the business is not used', async () => {
    const up = solution.createUpload({ buffer: workbook([['Customer', CUSTOMER], ['PR:', 'NB-2'], ['Item', 'Qty'], ['b', 1]]), filename: 'q.xlsx', email: 'rep@example.com' });
    const r = await http2('post', '/product-solution/extract', { uploadId: up.uploadId, sheetName: 'Quote', productIds, business: { name: 'Stray Biz' }, user: { name: 'U' } });
    assert.strictEqual(r.status, 200);
    const p = JSON.parse(Buffer.from(r.data).toString()).proposal;
    assert.strictEqual(p.companyName, CUSTOMER);
    assert.ok(!('company' in sent[sent.length - 1]));
  });
  await ok('at least one product is still required', async () => {
    const up = solution.createUpload({ buffer: WITH_REF, filename: 'q.xlsx', email: 'rep@example.com' });
    const r = await http2('post', '/product-solution/extract', { uploadId: up.uploadId, sheetName: 'Quote', productIds: [], user: { name: 'U' } });
    assert.strictEqual(r.status, 400);
  });

  console.log('Nothing hardcoded: a changed template needs no code change');
  await ok('the tag list is read from the active template at generation time and sent to the workflow with its context', () => {
    const last = sent[sent.length - 1];
    const active = store.getActive(store.PS_TYPE);
    assert.deepStrictEqual(last.schema.map(t => t.name), active.tags.filter(t => t.name !== '_group').map(t => t.name));
    assert.ok(last.schema.every(t => 'context' in t && 'type' in t), 'type and context travel with every tag');
    assert.ok(last.products.length === 2 && last.products[0].name === PRODUCTS[0].name, 'selected products');
    assert.ok(!('company' in last) && !('business' in last), 'no business is sent to the workflow');
    assert.ok(last.grid.cells.length > 0, 'the Excel grid');
  });
  let extraTemplateId;
  await ok('a template with an EXTRA made-up tag (text + loop) uploads, generates (200) and fills it, with no code change', async () => {
    const before = ['product', 'solution'].map(t => store.getActive(t).id);
    const r = await psTemplates.uploadAndActivate({ buffer: withExtraTag(), filename: 'extra.docx', uploadedBy: 'tester' });
    extraTemplateId = r.template.id;
    assert.ok(r.template.tags.some(t => t.name === 'warrantyPeriod') && r.template.tags.some(t => t.name === 'spares'));
    assert.deepStrictEqual(['product', 'solution'].map(t => store.getActive(t).id), before);
    const out = await http2('post', '/product-solution/extract', (() => { const up = solution.createUpload({ buffer: WITH_REF, filename: 'q.xlsx', email: 'rep@example.com' }); return { uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U' } }; })());
    assert.strictEqual(out.status, 200, Buffer.from(out.data).toString());
    const body = JSON.parse(Buffer.from(out.data).toString());
    assert.strictEqual(body.proposal.fields.warrantyPeriod, 'AI:warrantyPeriod0');
    assert.strictEqual(body.proposal.fields.spares.length, 2);
    assert.ok(body.schema.some(t => t.name === 'warrantyPeriod'), 'the edit screen gets the new tag from the schema');
    const w = await download(body.proposal.id, 'docx');
    assert.strictEqual(w.status, 200);
    const text = wordText(Buffer.from(w.data));
    assert.ok(text.includes('Warranty: AI:warrantyPeriod0') && text.includes('AI:sparePart1'), 'the new tags are printed');
    assert.ok(text.includes(CUSTOMER));
    assert.strictEqual((await download(body.proposal.id, 'pdf')).status, 200);
  });
  await ok('a template with a REMOVED tag uploads, generates (200) and the tag is simply not offered', async () => {
    const r = await psTemplates.uploadAndActivate({ buffer: withoutTag('recipientDesignation'), filename: 'removed.docx', uploadedBy: 'tester' });
    assert.ok(!r.template.tags.some(t => t.name === 'recipientDesignation'));
    const out = await generate('rep@example.com');
    assert.ok(!('recipientDesignation' in out.proposal.fields));
    assert.ok(!out.schema.some(t => t.name === 'recipientDesignation'));
    assert.ok(!sent[sent.length - 1].schema.some(t => t.name === 'recipientDesignation'), 'the workflow is not asked for it');
    const w = await download(out.proposal.id, 'docx');
    assert.strictEqual(w.status, 200);
    assert.ok(wordText(Buffer.from(w.data)).includes(CUSTOMER));
  });
  await ok('an older proposal keeps rendering from the template version it was made with', async () => {
    const old = storage.getAllProposals().find(p => p.templateId === extraTemplateId);
    assert.ok(old && store.getActive(store.PS_TYPE).id !== extraTemplateId);
    const w = await download(old.id, 'docx');
    assert.strictEqual(w.status, 200);
    assert.ok(wordText(Buffer.from(w.data)).includes('Warranty: AI:warrantyPeriod0'));
  });
  await ok('the new code names no tag, heading or cell of the current template', () => {
    const names = new Set();
    const collect = t => { names.add(t.name); (t.children || []).forEach(collect); };
    extractTags(seedBuffer()).tags.forEach(collect);
    // record fields / helper functions of the app (ooxml.diagramsXml), and the row-flag key of the generic solution mechanism (GROUP_FLAG, sent by the backend): not template tags
    const generic = new Set(['companyName', 'refNo', 'leadLogo', 'diagramsXml', '_group']);
    const needles = [...names].filter(n => /[a-z][A-Z]|_/.test(n) && !generic.has(n));
    assert.ok(needles.length > 15, 'enough camelCase tag names to look for');
    const root = path.join(__dirname, '..');
    const files = ['services/productSolutionService.js', 'services/productSolutionRenderService.js', 'services/productSolutionTemplateService.js', 'routes/productSolutionProposals.js', 'routes/productSolutionTemplates.js', '../n8n-workflows/Product_Solution_Proposal_Agent.json'];
    files.forEach(f => {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      needles.forEach(n => assert.ok(!new RegExp(`\\b${n}\\b`).test(src), `${f} mentions the template tag "${n}"`));
      ['TERMS AND CONDITIONS', 'YOUR INVESTMENT', 'PROPOSED SOLUTION', 'CUSTOMER ACKNOWLEDGEMENTS', 'Bill of Quantities'].forEach(h => assert.ok(!src.includes(h), `${f} mentions the heading "${h}"`));
    });
    // no fixed cell address or sheet label is used to read the Excel in the backend code of this feature
    ['services/productSolutionService.js', 'services/productSolutionRenderService.js', '../n8n-workflows/Product_Solution_Proposal_Agent.json'].forEach(f => {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      assert.ok(!/['"`][A-Z]{1,2}[0-9]{1,4}['"`]/.test(src), `${f} has a quoted cell address such as 'B7'`);
      assert.ok(!/\.(?:getCell|Sheets)\b|sheet_to_json|\.cells\[\d/.test(src), `${f} reads fixed cells`);
    });
  });

  console.log('Word / PDF, editing, versions, regenerate');
  let first;
  await ok('Word and PDF download (archive route and editor route) for a generated proposal', async () => {
    first = (await generate('rep@example.com', workbook([['Customer', CUSTOMER], ['PR:', 'ED-7'], ['Item', 'Qty'], ['b', 1]]))).proposal;
    assert.strictEqual(first.refNo, 'SLTM-REBM-WPE-SPED-7');
    const w = await download(first.id, 'docx');
    assert.strictEqual(w.status, 200);
    assert.ok(wordText(Buffer.from(w.data)).includes('SLTM-REBM-WPE-SPED-7'));
    assert.strictEqual((await download(first.id, 'pdf')).status, 200);
    const ex = await http2('post', '/product-solution/export', { fields: first.fields, templateId: first.templateId, companyName: first.companyName, format: 'docx', id: first.id });
    assert.strictEqual(ex.status, 200, Buffer.from(ex.data).toString());
    assert.ok(/Acme_Lanka_Pvt_Ltd_Product_Solution\.docx/.test(ex.headers['content-disposition']), ex.headers['content-disposition']);
    const exPdf = await http2('post', '/product-solution/export', { fields: first.fields, templateId: first.templateId, companyName: first.companyName, format: 'pdf', id: first.id });
    assert.strictEqual(exPdf.status, 200);
  });
  await ok('the diagram tag chosen by the workflow gets the products\' diagrams (pictures), nothing else does', async () => {
    const w = await download(first.id, 'docx');
    const zip = new PizZip(Buffer.from(w.data));
    const media = Object.keys(zip.files).filter(f => /ih_diagram_/.test(f));
    assert.ok(media.length >= 1, `diagram pictures were added (${media.length})`);
    assert.ok(first.fields.__meta.diagramTags.length === 1);
  });
  await ok('Save: an edit creates v2 with the SAME reference; v1 is still downloadable and different', async () => {
    const fields = { ...first.fields, projectScope: 'Edited scope text' };
    const s = await http2('put', `/product-solution/${first.id}/fields`, { fields, companyName: first.companyName });
    assert.strictEqual(s.status, 200, Buffer.from(s.data).toString());
    const p = JSON.parse(Buffer.from(s.data).toString()).proposal;
    assert.strictEqual(p.currentVersion, 2);
    assert.strictEqual(p.refNo, 'SLTM-REBM-WPE-SPED-7');
    assert.ok(p.fields.__meta && p.fields.__meta.diagramTags.length === 1, 'picture settings are kept');
    const v1 = wordText(Buffer.from((await download(first.id, 'docx', 1)).data));
    const v2 = wordText(Buffer.from((await download(first.id, 'docx', 2)).data));
    assert.ok(!v1.includes('Edited scope text') && v2.includes('Edited scope text'));
    assert.ok(v1.includes('SLTM-REBM-WPE-SPED-7') && v2.includes('SLTM-REBM-WPE-SPED-7'));
  });
  await ok('Save ignores a __meta (logo / diagram settings) sent by the browser', async () => {
    const fields = { ...first.fields, projectScope: 'Edited again', __meta: { diagramTags: [], leadLogo: 'http://169.254.169.254/x' } };
    const s = await http2('put', `/product-solution/${first.id}/fields`, { fields });
    const p = JSON.parse(Buffer.from(s.data).toString()).proposal;
    assert.strictEqual(p.fields.__meta.leadLogo, undefined);
    assert.strictEqual(p.fields.__meta.diagramTags.length, 1);
  });
  await ok('Regenerate: a new version, same reference, same customer name, the stored Excel and products are used', async () => {
    const before = sent.length;
    const r = await http2('post', `/product-solution/${first.id}/regenerate`, { user: { name: 'U' } });
    assert.strictEqual(r.status, 200, Buffer.from(r.data).toString());
    const p = JSON.parse(Buffer.from(r.data).toString()).proposal;
    assert.strictEqual(p.refNo, 'SLTM-REBM-WPE-SPED-7');
    assert.ok(p.currentVersion >= 3);
    const last = sent[sent.length - 1];
    assert.strictEqual(sent.length, before + 1);
    assert.strictEqual(last.refNo, 'SLTM-REBM-WPE-SPED-7', 'the saved reference is only echoed');
    assert.ok(!('company' in last), 'still no business');
    assert.deepStrictEqual(last.products.map(x => x.id), productIds);
    assert.strictEqual(p.fields.refNo, 'SLTM-REBM-WPE-SPED-7');
  });
  await ok('the original Excel can be downloaded; the product editor route refuses to save this type', async () => {
    const src = await http2('get', `/product-solution/${first.id}/source`);
    assert.strictEqual(src.status, 200);
    const bad = await http2('put', `/${first.id}/fields`, { fields: { a: 1 } });
    assert.strictEqual(bad.status, 400);
    const get = await http2('get', `/product-solution/${first.id}`);
    assert.strictEqual(JSON.parse(Buffer.from(get.data).toString()).proposal.proposalType, 'productSolution');
    const sol = await http2('get', `/solution/${first.id}`);
    assert.strictEqual(sol.status, 404, 'the solution routes do not open it');
  });

  console.log('Archive: status, history, delete permissions work as for the other types');
  await ok('listed with its type; status updates and version history work; only admins / section managers delete', async () => {
    const list = JSON.parse(Buffer.from((await http2('get', '/saved')).data).toString()).proposals;
    const mine = list.find(p => p.id === first.id);
    assert.strictEqual(mine.proposalType, 'productSolution');
    assert.ok(mine.versions.length >= 3 && mine.versions[0].versionNumber === 1);
    const form = new FormData(); form.append('status', 'Sent'); form.append('note', 'sent');
    const st = await axios.post(`${base}/${first.id}/status`, form, { headers: asRep, validateStatus: () => true });
    assert.strictEqual(st.status, 200, JSON.stringify(st.data));
    const hist = JSON.parse(Buffer.from((await http2('get', `/${first.id}/history`)).data).toString());
    assert.strictEqual(hist.status, 'Sent');
    assert.strictEqual((await http2('delete', `/saved/${first.id}`)).status, 403, 'an account manager cannot delete');
    const del = await axios.delete(`${base}/saved/${first.id}`, { headers: { 'x-user-email': 'admin@example.com' }, validateStatus: () => true });
    assert.strictEqual(del.status, 200);
    assert.ok(!storage.getAllProposals().some(p => p.id === first.id));
  });

  console.log('Malformed AI output: tolerated, retried, partly accepted');
  const firstText = payload => payload.schema.find(t => t.type === 'text' && !/company|ref/i.test(t.name)).name;
  const sheet = tag => workbook([['Customer', CUSTOMER], ['PR:', tag], ['Item', 'Qty'], ['b', 1]]);
  const FENCE = '`'.repeat(3);
  let n = 0;
  for (const [label, make, check] of [
    ['JSON wrapped in ```json fences', p => FENCE + 'json\n' + goodText(p) + '\n' + FENCE, null],
    ['text before and after the JSON', p => 'Here is the proposal:\n' + goodText(p) + '\nHope this helps!', null],
    ['an unescaped 65" and a trailing comma', p => goodText(p).replace('"AI:' + firstText(p) + '0"', '"Wall mount for a 65" screen"').replace(/\}$/, ',}'), v => v.includes('65" screen')],
    ['raw line breaks inside a string', p => goodText(p).replace('"AI:' + firstText(p) + '0"', '"line one\nline two"'), v => /line one\s*line two/.test(v)],
    ['an answer cut off at the end', p => goodText(p).slice(0, goodText(p).lastIndexOf('"quotationRef"') - 2), null],
  ]) {
    await ok(`${label}: generates on the first try (no retry)`, async () => {
      let tag; const before = sent.length;
      aiQueue.push(p => { tag = firstText(p); return make(p); });
      const r = await generate('rep@example.com', sheet('F' + (n += 1)));
      assert.strictEqual(sent.length - before, 1, 'one workflow call');
      assert.ok(r.proposal && r.proposal.id);
      assert.ok(String(r.proposal.fields[tag]).length > 0, 'the tag is filled');
      if (check) assert.ok(check(String(r.proposal.fields[tag])), String(r.proposal.fields[tag]));
    });
  }
  await ok('invalid output, then a valid one: succeeds after a retry', async () => {
    const before = sent.length;
    aiQueue.push(() => 'I could not do that {"values": ', () => 'sorry, no JSON here', p => goodText(p));
    const r = await generate('rep@example.com', sheet('RETRY1'));
    assert.strictEqual(sent.length - before, 3, 'two retries were used');
    assert.ok(r.proposal.id);
    aiQueue.length = 0;
  });
  await ok('partial output: valid values are used, a missing / wrong-typed tag stays empty, the proposal is still generated', async () => {
    let tag, other;
    aiQueue.push(p => {
      const tags = p.schema.filter(t => t.type === 'text' && !/company|ref/i.test(t.name));
      tag = tags[0].name; other = tags[1].name;
      return JSON.stringify({ values: { [tag]: 'Kept value', [other]: { not: 'a string' } }, quotationRef: '', meta: { customerName: CUSTOMER } });
    });
    const r = await generate('rep@example.com', sheet('PART1'));
    assert.strictEqual(r.proposal.fields[tag], 'Kept value');
    assert.strictEqual(r.proposal.fields[other] || '', '', 'the invalid value is empty');
    assert.ok(r.missing.includes(other));
  });
  await ok('every attempt invalid (or no usable content): the same friendly error after 3 tries, the Excel is kept, raw output is logged', async () => {
    for (const bad of [() => 'not json at all', () => JSON.stringify({ values: {}, meta: {} })]) {
      const before = sent.length; const proposalsBefore = storage.getAllProposals().length;
      aiQueue.push(bad, bad, bad);
      const up = solution.createUpload({ buffer: sheet('FAILALL'), filename: 'q.xlsx', email: 'rep@example.com' });
      const warns = []; const w = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
      let err;
      try { await ps.extract({ uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U', email: 'rep@example.com' } }); } catch (e) { err = e; } finally { console.warn = w; }
      assert.ok(err && err.status === 502 && /could not read this sheet/.test(err.message) && /Your Excel file is kept/.test(err.message), err && err.message);
      assert.strictEqual(sent.length - before, 3, 'exactly 3 attempts');
      assert.ok(warns.some(x => /unusable workflow output/.test(x)), 'raw output logged');
      assert.ok(solution.loadPending(up.uploadId), 'the pending Excel is still there');
      assert.strictEqual(storage.getAllProposals().length, proposalsBefore, 'nothing saved');
      aiQueue.length = 0;
    }
  });
  await ok('a workflow that is unreachable is not retried', async () => {
    mode = 'down'; const before = sent.length;
    try { await assert.rejects(generate('rep@example.com', sheet('DOWN1')), /could not be reached/); } finally { mode = 'normal'; }
    assert.strictEqual(sent.length - before, 1);
  });

  console.log('Rendering by the proposal\'s own type (never "Solution template version not found")');
  const jsonOf = r => { try { return JSON.parse(Buffer.from(r.data).toString()); } catch (e) { return {}; } };
  const FILE_ERR = /template version not found/i;
  await ok('preview, Word, PDF, Save + preview of the new version, Regenerate, older version and Excel all work for a Product + Solution proposal', async () => {
    const r = await generate('rep@example.com', workbook([['Customer', CUSTOMER], ['PR:', 'R1/2026'], ['Item', 'Qty'], ['b', 1]]));
    const p = r.proposal;
    const tplId = p.templateId;
    assert.strictEqual(store.get(tplId).type, store.PS_TYPE);
    // Refresh preview = PDF export of the editor's fields, from the Product + Solution page
    const prev = await http2('post', '/product-solution/export', { fields: p.fields, templateId: tplId, companyName: p.companyName, format: 'pdf', id: p.id });
    assert.strictEqual(prev.status, 200, Buffer.from(prev.data).toString());
    // the Solution endpoint, given a Product + Solution proposal (what the page used to call), renders it with the Product + Solution template
    const viaSolution = await http2('post', '/solution/export', { fields: p.fields, templateId: tplId, companyName: p.companyName, format: 'docx', id: p.id });
    assert.strictEqual(viaSolution.status, 200, Buffer.from(viaSolution.data).toString());
    assert.ok(/Product_Solution/.test(viaSolution.headers['content-disposition']));
    assert.ok(wordText(viaSolution.data).includes(`AI:${store.get(tplId).tags[0].name}`) || wordText(viaSolution.data).length > 50);
    assert.strictEqual((await http2('post', '/solution/export', { fields: p.fields, templateId: tplId, companyName: p.companyName, format: 'pdf' })).status, 200, 'even without an id, the template version decides');
    for (const f of ['docx', 'pdf']) {
      const d = await download(p.id, f);
      assert.strictEqual(d.status, 200, `${f} download`);
      const e = await http2('post', '/product-solution/export', { fields: p.fields, templateId: tplId, companyName: p.companyName, format: f, id: p.id });
      assert.strictEqual(e.status, 200, `${f} export`);
    }
    // Save (new version) then preview it
    const edited = { ...p.fields, [Object.keys(p.fields).find(k => k !== 'refNo' && typeof p.fields[k] === 'string' && !/^_/.test(k))]: 'Edited text' };
    const saved = await http2('put', `/product-solution/${p.id}/fields`, { fields: edited, companyName: p.companyName });
    assert.strictEqual(saved.status, 200, Buffer.from(saved.data).toString());
    const sp = jsonOf(saved).proposal;
    assert.strictEqual(sp.currentVersion, 2);
    assert.strictEqual((await http2('post', '/product-solution/export', { fields: sp.fields, templateId: sp.templateId, companyName: sp.companyName, format: 'pdf', id: sp.id })).status, 200);
    // Regenerate, then the old version 1 and the new one
    const regen = await http2('post', `/product-solution/${p.id}/regenerate`, { user: { name: 'U', email: 'rep@example.com' } });
    assert.strictEqual(regen.status, 200, Buffer.from(regen.data).toString());
    for (const v of [1, 2, 3]) for (const f of ['docx', 'pdf']) {
      const d = await download(p.id, f, v);
      assert.strictEqual(d.status, 200, `v${v} ${f}: ${Buffer.from(d.data).toString().slice(0, 120)}`);
    }
    const src = await http2('get', `/product-solution/${p.id}/source`);
    assert.strictEqual(src.status, 200);
    const open = await http2('get', `/product-solution/${p.id}`);
    assert.strictEqual(open.status, 200);
    assert.ok(!FILE_ERR.test(Buffer.from(open.data).toString()));
  });
  await ok('the proposal\'s template version is missing: the active Product + Solution template is used (200) and a warning is logged', async () => {
    const r = await generate('rep@example.com', workbook([['Customer', CUSTOMER], ['PR:', 'M2/2026'], ['Item', 'Qty'], ['b', 1]]));
    const p = r.proposal;
    const active = store.getActive(store.PS_TYPE);
    storage.updateProposal(p.id, rec => ({
      ...rec,
      templateId: 'deleted-template-id',
      versions: rec.versions.map(v => ({ ...v, templateId: 'deleted-template-id' })),
    }));
    const warns = []; const w = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
    try {
      for (const f of ['docx', 'pdf']) {
        const e = await http2('post', '/product-solution/export', { fields: p.fields, templateId: 'deleted-template-id', companyName: p.companyName, format: f, id: p.id });
        assert.strictEqual(e.status, 200, `${f} export: ${Buffer.from(e.data).toString()}`);
        const viaSolution = await http2('post', '/product-solution/export', { fields: p.fields, templateId: undefined, companyName: p.companyName, format: f, id: p.id });
        assert.strictEqual(viaSolution.status, 200);
        const d = await download(p.id, f);
        assert.strictEqual(d.status, 200, `${f} download: ${Buffer.from(d.data).toString().slice(0, 120)}`);
        const v1 = await download(p.id, f, 1);
        assert.strictEqual(v1.status, 200, `v1 ${f}`);
      }
      // the Solution route, given the PS proposal whose version is gone, also renders it (by the proposal's type)
      assert.strictEqual((await http2('post', '/solution/export', { fields: p.fields, templateId: 'deleted-template-id', companyName: p.companyName, format: 'docx', id: p.id })).status, 200);
      const get = await http2('get', `/product-solution/${p.id}`);
      assert.strictEqual(get.status, 200);
      assert.strictEqual(jsonOf(get).schema.length > 0, true, 'the form uses the active template\'s schema');
      const regen = await http2('post', `/product-solution/${p.id}/regenerate`, { user: { name: 'U', email: 'rep@example.com' } });
      assert.strictEqual(regen.status, 200);
      assert.strictEqual(jsonOf(regen).proposal.templateId, active.id, 'a regenerated version records the active template');
    } finally { console.warn = w; }
    assert.ok(warns.some(x => /not found; using the active Product \+ Solution template/.test(x)), `warning logged: ${warns.join(' | ')}`);
  });
  await ok('Solution and Product rendering are unchanged: the Solution export still refuses a deleted Solution template version', async () => {
    const sol = store.getActive('solution');
    const good = await http2('post', '/solution/export', { fields: {}, templateId: sol.id, companyName: 'X', format: 'docx' });
    assert.notStrictEqual(good.status, 404, 'a real solution template version is found');
    const bad = await http2('post', '/solution/export', { fields: {}, templateId: 'nope', companyName: 'X', format: 'docx' });
    assert.strictEqual(bad.status, 404);
  });

  console.log('Product parts (same as the Product proposal), editable sections, customer logo');
  const sharp = require('sharp');
  const png = async (w, h) => `data:image/png;base64,${(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()).toString('base64')}`;
  const docXml = buf => new PizZip(buf).file('word/document.xml').asText();
  const bodyOf = r => Buffer.from(r.data);
  const paragraphsOf = xml => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(p => p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const logoExtent = xml => { const m = /<wp:extent cx="(\d+)" cy="(\d+)"\/><wp:docPr id="\d+" name="Client logo"/.exec(xml); return m ? { cx: +m[1], cy: +m[2] } : null; };
  const pick = r => jsonOf(r).proposal;
  const upload2 = async (email, tag) => {
    const up = solution.createUpload({ buffer: sheet(tag), filename: 'q.xlsx', email });
    return ps.extract({ uploadId: up.uploadId, sheetName: 'Quote', productIds, user: { name: 'U', email } });
  };
  const NAMES = productIds.map(id => PRODUCTS.find(p => p.id === id).name);

  await ok('generation asks the Product flow for the product parts: About = intro + recommended products, Proposed Solution = the selected products, diagrams on', async () => {
    const before = v2Sent.length;
    aiQueue.push(p => { const a = stubAnswer(p); a.values[Object.keys(a.values).find(k => /requirementsXml/i.test(k))] = 'The proposed solution is a quoted smart board package.\n\n' + NAMES[0].split(' (')[0] + ' is described here by the workflow.'; return JSON.stringify(a); });
    const r = await upload2('rep@example.com', 'PARTS1');
    assert.strictEqual(v2Sent.length - before, 1, 'the Product workflow was asked once, for this customer');
    assert.strictEqual(v2Sent[v2Sent.length - 1].company.name, CUSTOMER);
    assert.deepStrictEqual(v2Sent[v2Sent.length - 1].products.map(p => p.id), productIds);
    const f = r.proposal.fields;
    assert.strictEqual(f.aboutXml.intro, `ABOUT ${CUSTOMER}`);
    assert.deepStrictEqual(f.aboutXml.items.map(i => i.title), [`${NAMES[0]} — High priority`, 'Managed Firewall']);
    assert.deepStrictEqual(f.aboutXml.items.map(i => i.text), ['REASON A', 'REASON B']);
    assert.deepStrictEqual(f.requirementsXml.items.map(i => i.title), NAMES, 'the selected products');
    assert.ok(f.requirementsXml.items.every(i => i.text && i.text.length > 20), 'catalogue descriptions');
    assert.strictEqual(f.requirementsXml.intro, 'The proposed solution is a quoted smart board package.', 'the solution summary stays; the workflow\'s paragraph about a selected product is replaced by the Product flow\'s');
    assert.deepStrictEqual(f.__meta.diagramTags, ['diagramsXml']);
    const word = await download(r.proposal.id, 'docx');
    const xml = docXml(bodyOf(word));
    assert.ok(/<w:drawing>/.test(xml), 'the product diagrams are in the Word file');
    assert.ok((xml.match(/<w:drawing>/g) || []).length >= 2, 'one diagram per selected product');
    const paras = paragraphsOf(xml);
    const i1 = paras.findIndex(p => p === `1. ${NAMES[0]} — High priority`);
    assert.ok(i1 >= 0 && paras[i1 + 1] === 'REASON A', 'numbered recommended item, then its reason');
    assert.ok(paras.indexOf(`1. ${NAMES[0]}`) > paras.indexOf('The proposed solution is a quoted smart board package.'), 'solution summary first, then the product items');
  });
  await ok('when the workflow names no diagram tag, the template\'s diagrams block is used; when the Product workflow is down the product items come from the catalogue', async () => {
    v2Mode = 'down';
    aiQueue.push(p => { const a = stubAnswer(p); a.diagramTags = []; return JSON.stringify(a); });
    const warns = []; const w = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
    try {
      const r = await upload2('rep@example.com', 'PARTS2');
      const f = r.proposal.fields;
      assert.deepStrictEqual(f.__meta.diagramTags, ['diagramsXml']);
      assert.deepStrictEqual(f.requirementsXml.items.map(i => i.title), NAMES);
      assert.ok(f.requirementsXml.items.every(i => i.text.length > 20));
      assert.deepStrictEqual(f.aboutXml.items, [], 'no AI recommendations without the Product workflow');
      assert.ok(f.aboutXml.intro.length > 0, 'the workflow\'s own text is the introduction');
      assert.ok(warns.some(x => /Product flow could not write the product parts/.test(x)));
    } finally { console.warn = w; v2Mode = 'normal'; }
  });

  let edited;
  await ok('edits on the left: intro, items (add / remove / reorder) and project scope are kept by Save, Refresh preview and later versions', async () => {
    const r = await upload2('rep@example.com', 'EDIT1');
    const p = r.proposal;
    const f = { ...p.fields };
    delete f.__meta;
    f.aboutXml = { intro: 'MY OWN INTRO', items: [{ title: 'Second thing', text: 'two' }, { title: NAMES[0], text: 'first, edited' }, { title: 'Added item', text: 'brand new' }] };
    f.requirementsXml = { intro: 'MY SOLUTION TEXT', items: [{ title: NAMES[1], text: 'only this product now' }] };
    f.projectScope = 'MY PROJECT SCOPE';
    // Refresh preview: what is on the screen is what is printed (nothing is replaced by AI text)
    const prev = await http2('post', '/product-solution/export', { fields: f, templateId: p.templateId, companyName: p.companyName, format: 'docx', id: p.id });
    assert.strictEqual(prev.status, 200);
    let paras = paragraphsOf(docXml(bodyOf(prev)));
    assert.ok(paras.includes('MY OWN INTRO') && paras.includes('MY SOLUTION TEXT') && paras.some(x => x.includes('MY PROJECT SCOPE')));
    assert.ok(!paras.includes('1. ' + NAMES[0]) && paras.includes('1. ' + NAMES[1]), 'the removed product item is not printed, the kept one is');
    assert.ok(paras.indexOf('1. Second thing') >= 0 && paras.indexOf('1. Second thing') < paras.indexOf(`2. ${NAMES[0]}`) && paras.indexOf(`2. ${NAMES[0]}`) < paras.indexOf('3. Added item'), 'items print in the order of the screen, renumbered');
    // Save: a new version, stored as structured text (never XML)
    const saved = await http2('put', `/product-solution/${p.id}/fields`, { fields: f, companyName: p.companyName });
    assert.strictEqual(saved.status, 200, Buffer.from(saved.data).toString());
    edited = pick(saved);
    assert.strictEqual(edited.currentVersion, 2, 'the edit is a new version in the history');
    assert.deepStrictEqual(edited.fields.aboutXml, { intro: 'MY OWN INTRO', items: f.aboutXml.items });
    assert.ok(!/<w:/.test(JSON.stringify(edited.fields.aboutXml) + JSON.stringify(edited.fields.requirementsXml)), 'no XML is stored');
    assert.strictEqual(edited.fields.projectScope, 'MY PROJECT SCOPE');
    // reopened from the archive and downloaded, in every format
    const again = jsonOf(await http2('get', `/product-solution/${p.id}`));
    assert.deepStrictEqual(again.proposal.fields.aboutXml, edited.fields.aboutXml);
    assert.ok(again.schema.find(t => t.name === 'aboutXml').editor === 'structured' && again.schema.find(t => t.name === 'requirementsXml').editor === 'structured');
    paras = paragraphsOf(docXml(bodyOf(await download(p.id, 'docx'))));
    assert.ok(paras.includes('MY OWN INTRO') && paras.includes('first, edited') && paras.some(x => x.includes('MY PROJECT SCOPE')));
    assert.strictEqual((await download(p.id, 'pdf')).status, 200);
    // an unchanged Save is not a new version; v1 still has the AI text
    const same = await http2('put', `/product-solution/${p.id}/fields`, { fields: f, companyName: p.companyName });
    assert.strictEqual(pick(same).currentVersion, 2);
    paras = paragraphsOf(docXml(bodyOf(await download(p.id, 'docx', 1))));
    assert.ok(!paras.includes('MY OWN INTRO') && paras.includes(`ABOUT ${CUSTOMER}`), 'version 1 is the generated text');
    paras = paragraphsOf(docXml(bodyOf(await download(p.id, 'docx', 2))));
    assert.ok(paras.includes('MY OWN INTRO'), 'version 2 is the edit');
    // Regenerate replaces the AI text again (the screen warns first); the edit stays in version 2
    const regen = pick(await http2('post', `/product-solution/${p.id}/regenerate`, { user: { name: 'U', email: 'rep@example.com' } }));
    assert.strictEqual(regen.fields.aboutXml.intro, `ABOUT ${CUSTOMER}`);
    assert.strictEqual(regen.currentVersion, 3);
    paras = paragraphsOf(docXml(bodyOf(await download(p.id, 'docx', 2))));
    assert.ok(paras.includes('MY OWN INTRO'), 'the edited version is still there');
  });
  await ok('an older proposal whose about / requirements are plain text still opens, edits and prints (the text is the introduction)', async () => {
    const r = await upload2('rep@example.com', 'LEGACY1');
    const p = r.proposal;
    storage.updateProposal(p.id, rec => ({ ...rec, fields: { ...rec.fields, aboutXml: 'Old plain\nAbout text' } }));
    const got = jsonOf(await http2('get', `/product-solution/${p.id}`)).proposal;
    assert.strictEqual(got.fields.aboutXml, 'Old plain\nAbout text');
    const out = await http2('post', '/product-solution/export', { fields: got.fields, templateId: p.templateId, companyName: p.companyName, format: 'docx', id: p.id });
    const paras = paragraphsOf(docXml(bodyOf(out)));
    assert.ok(paras.includes('Old plain') && paras.includes('About text'));
  });

  let withLogo;
  await ok('customer logo: PNG saved with the proposal, fitted into the template\'s box with its aspect ratio, in Word and PDF, kept in later versions and after Regenerate', async () => {
    const r = await upload2('rep@example.com', 'LOGO1');
    const p = r.proposal;
    assert.ok(!logoExtent(docXml(bodyOf(await download(p.id, 'docx')))), 'no logo yet: nothing is printed');
    const logo = await png(400, 100); // 4 : 1
    // Refresh preview before Save shows it
    const prev = await http2('post', '/product-solution/export', { fields: p.fields, templateId: p.templateId, companyName: p.companyName, format: 'docx', id: p.id, logo });
    assert.strictEqual(prev.status, 200);
    const ext0 = logoExtent(docXml(bodyOf(prev)));
    assert.ok(ext0 && ext0.cx > 0 && ext0.cy > 0 && Math.abs(ext0.cx / ext0.cy - 4) < 0.05, `4:1 kept (${JSON.stringify(ext0)})`);
    assert.strictEqual((await http2('post', '/product-solution/export', { fields: p.fields, templateId: p.templateId, companyName: p.companyName, format: 'pdf', id: p.id, logo })).status, 200);
    // Save keeps it
    const saved = await http2('put', `/product-solution/${p.id}/fields`, { fields: p.fields, companyName: p.companyName, logo });
    assert.strictEqual(saved.status, 200, Buffer.from(saved.data).toString());
    withLogo = pick(saved);
    assert.strictEqual(withLogo.currentVersion, 2, 'adding a logo is a new version');
    assert.strictEqual(withLogo.fields.__meta.leadLogo, logo);
    assert.ok(withLogo.fields.__meta.diagramTags.length, 'the picture settings that are not the logo are kept');
    const ext = logoExtent(docXml(bodyOf(await download(p.id, 'docx'))));
    assert.ok(ext && Math.abs(ext.cx / ext.cy - 4) < 0.05);
    assert.strictEqual((await download(p.id, 'pdf')).status, 200);
    // a Save from the screen without a `logo` keeps the stored one
    const keep = pick(await http2('put', `/product-solution/${p.id}/fields`, { fields: { ...p.fields, projectScope: 'changed' }, companyName: p.companyName }));
    assert.strictEqual(keep.fields.__meta.leadLogo, logo);
    // the first version has none, the later ones have it
    assert.ok(!logoExtent(docXml(bodyOf(await download(p.id, 'docx', 1)))));
    assert.ok(logoExtent(docXml(bodyOf(await download(p.id, 'docx', 2)))));
    // Regenerate keeps the customer's logo
    const regen = pick(await http2('post', `/product-solution/${p.id}/regenerate`, { user: { name: 'U', email: 'rep@example.com' } }));
    assert.strictEqual(regen.fields.__meta.leadLogo, logo);
    assert.ok(logoExtent(docXml(bodyOf(await download(p.id, 'docx')))));
    // Replace with a JPG, then Remove
    const jpg = `data:image/jpeg;base64,${(await sharp({ create: { width: 90, height: 300, channels: 3, background: { r: 10, g: 80, b: 200 } } }).jpeg().toBuffer()).toString('base64')}`;
    const repl = pick(await http2('put', `/product-solution/${p.id}/fields`, { fields: regen.fields, companyName: p.companyName, logo: jpg }));
    const tall = logoExtent(docXml(bodyOf(await download(p.id, 'docx'))));
    assert.ok(tall && Math.abs(tall.cy / tall.cx - (300 / 90)) < 0.05, 'a tall logo keeps its ratio too');
    const removed = pick(await http2('put', `/product-solution/${p.id}/fields`, { fields: repl.fields, companyName: p.companyName, logo: '' }));
    assert.ok(!removed.fields.__meta.leadLogo);
    const xml = docXml(bodyOf(await download(p.id, 'docx')));
    assert.ok(!logoExtent(xml) && !/client_logo/.test(xml) && !/<w:drawing>[^]*?descr="\{%client_logo\}"/.test(xml), 'no picture and no placeholder text is left');
  });
  await ok('no logo: the tag prints nothing, no empty line is left where it was', async () => {
    const r = await upload2('rep@example.com', 'NOLOGO1');
    const xml = docXml(bodyOf(await download(r.proposal.id, 'docx')));
    assert.ok(!/client_logo/.test(xml) && !/rIdIHLogo/.test(xml));
    const tplXml = docXml(store.readFile(r.proposal.templateId));
    const tplParas = paragraphsOf(tplXml);
    const at = tplParas.findIndex(x => x.includes('{%client_logo}'));
    assert.ok(at >= 0);
    // the paragraph that held only the logo tag is gone (the heading above it and the next block are neighbours now)
    const paras = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []);
    const emptyHeading2 = paras.filter(p => /w:pStyle w:val="Heading2"/.test(p) && !/<w:t[ >]/.test(p) && !/<w:drawing|<w:sectPr/.test(p));
    assert.strictEqual(emptyHeading2.length, 0, 'no empty heading-styled line');
  });
  await ok('wrong logo files give a clear error and change nothing', async () => {
    const r = await upload2('rep@example.com', 'BADLOGO1');
    const p = r.proposal;
    const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 10, 1).toString('base64')}`;
    const cases = [
      ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', /PNG or JPG/],
      ['data:image/svg+xml;base64,PHN2Zy8+', /PNG or JPG/],
      ['not an image at all', /PNG or JPG/],
      [`data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`, /PNG or JPG/],
      [big, /larger than 2 MB/],
    ];
    for (const [logo, msg] of cases) {
      const save = await http2('put', `/product-solution/${p.id}/fields`, { fields: p.fields, companyName: p.companyName, logo });
      assert.strictEqual(save.status, 400, logo.slice(0, 30));
      assert.ok(msg.test(jsonOf(save).error), jsonOf(save).error);
      const prev = await http2('post', '/product-solution/export', { fields: p.fields, templateId: p.templateId, companyName: p.companyName, format: 'docx', id: p.id, logo });
      assert.strictEqual(prev.status, 400);
    }
    assert.strictEqual(storage.getProposalById(p.id).currentVersion, 1);
  });
  await ok('Solution proposals take the same logo and structured values (the template decides whether it prints)', async () => {
    const renderSvc = require('../services/solutionRenderService');
    const tplId = store.getActive('solution').id;
    const entry = store.get(tplId);
    const values = Object.fromEntries(entry.tags.filter(t => t.type !== 'loop').map(t => [t.name, 'x']));
    const noLogo = await renderSvc.render({ templateId: tplId, fields: values, companyName: 'X', format: 'docx' });
    const withIt = await renderSvc.render({ templateId: tplId, fields: { ...values, __meta: { leadLogo: await png(100, 100) } }, companyName: 'X', format: 'docx' });
    assert.ok(noLogo.buffer.length > 1000 && withIt.buffer.length > 1000, 'both render');
    assert.ok(!/client_logo/.test(docXml(noLogo.buffer)) && !/client_logo/.test(docXml(withIt.buffer)));
  });

  await ok('the edit screen (shared by the Solution and Product + Solution pages) has the structured editor, the logo upload and sends the logo with Save and the preview', () => {
    const src = n => fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', n), 'utf8');
    const count = (text, part) => text.split(part).length - 1;
    const page = src('pages/SolutionProposal.jsx');
    assert.ok(page.includes('import StructuredTextEditor') && page.includes('import CustomerLogoField'));
    assert.ok(page.includes("tag.editor === 'structured'"), 'tags marked by the server get the editor');
    assert.ok(page.includes('<CustomerLogoField'));
    assert.ok(count(page, 'logoChange(fields, proposal)') >= 2, 'Save and the preview carry the logo');
    assert.ok(page.includes('plainFields'), '__meta is not sent back as fields');
    const editor = src('components/StructuredTextEditor.jsx');
    assert.ok(editor.includes('Add {itemName}') && editor.includes('Move up') && editor.includes('Move down') && editor.includes('Remove this'), 'add, remove and reorder');
    const logo = src('components/CustomerLogoField.jsx');
    assert.ok(logo.includes('2 * 1024 * 1024') && logo.includes('PNG or JPG') && logo.includes('Replace') && logo.includes('Remove'), 'PNG / JPG, 2 MB, Replace / Remove');
    const labels = src('utils/fieldLabels.js');
    assert.ok(labels.includes('aboutXml') && labels.includes('requirementsXml'), 'headings');
  });

  await ok('the logo upload goes in the section of the logo place in the template (the tag nearest to it), else the About block, else it stands alone', async () => {
    const logoSvc = require('../services/proposalLogoService');
    const schema = [{ name: 'projectScope', type: 'text' }, { name: 'aboutXml', type: 'rawXml', editor: 'structured' }, { name: 'requirementsXml', type: 'rawXml', editor: 'structured' }];
    const at = name => ({ logoPlaceholders: [{ kind: 'text', nearField: name }] });
    assert.strictEqual(logoSvc.logoFieldOf(at('requirementsXml'), schema), 'requirementsXml', 'a template with the logo in another section: that section');
    assert.strictEqual(logoSvc.logoFieldOf(at('projectScope'), schema), 'projectScope', 'a plain field: above that field');
    assert.strictEqual(logoSvc.logoFieldOf(at('notInThisSchema'), schema), 'aboutXml', 'unknown neighbour: the About block');
    assert.strictEqual(logoSvc.logoFieldOf({ logoPlaceholders: [] }, schema), 'aboutXml', 'no logo place: still the About block (with the note)');
    assert.strictEqual(logoSvc.logoFieldOf(at('x'), [{ name: 'projectScope', type: 'text' }]), '', 'no About block: it stands alone (the Solution page)');
    // what the screen is told, for the real templates
    const tpl = jsonOf(await http2('get', '/product-solution/template'));
    assert.strictEqual(tpl.logoField, 'aboutXml');
    assert.strictEqual(tpl.logoPlace, true);
    const sol = jsonOf(await http2('get', '/solution/template'));
    assert.strictEqual(sol.logoField, '', 'the Solution template has no About block');
    assert.strictEqual(sol.logoPlace, false);
  });

  console.log('Templates: the three types are independent');
  await ok('uploading and restoring a Product + Solution template never changes the Product or Solution template (and the reverse)', async () => {
    const ids = () => ({ product: store.getActive('product').id, solution: store.getActive('solution').id, ps: store.getActive(store.PS_TYPE).id });
    const productVersions = store.list('product').map(t => t.version).join();
    const solutionVersions = store.list('solution').map(t => t.version).join();
    const start = ids();
    const up = await psTemplates.uploadAndActivate({ buffer: withExtraTag(), filename: 'again.docx', uploadedBy: 'tester' });
    const afterUpload = ids();
    assert.strictEqual(afterUpload.product, start.product); assert.strictEqual(afterUpload.solution, start.solution);
    assert.strictEqual(afterUpload.ps, up.template.id);
    const v1 = store.list(store.PS_TYPE).find(t => t.version === 1);
    const act = await http2('post', `/templates/${v1.id}/activate`);
    assert.strictEqual(act.status, 200);
    const afterRestore = ids();
    assert.strictEqual(afterRestore.product, start.product); assert.strictEqual(afterRestore.solution, start.solution); assert.strictEqual(afterRestore.ps, v1.id);
    assert.strictEqual(store.list('product').map(t => t.version).join(), productVersions, 'product version numbers did not move');
    assert.strictEqual(store.list('solution').map(t => t.version).join(), solutionVersions);
    assert.ok(store.list(store.PS_TYPE).every(t => t.type === 'productSolution'));
    // the reverse: a new solution template does not touch the Product + Solution one
    solutionTemplates.uploadAndActivate({ buffer: buildSolutionTemplate(), filename: 'solution_tpl2.docx', uploadedBy: 'tester' });
    assert.strictEqual(store.getActive(store.PS_TYPE).id, v1.id);
    assert.strictEqual(store.getActive('product').id, start.product);
    // versions of each type are listed separately
    const listed = JSON.parse(Buffer.from((await http2('get', '/templates', undefined, { type: 'productSolution' })).data).toString()).templates;
    assert.ok(listed.length >= 3 && listed.every(t => t.type === 'productSolution'));
    const info = JSON.parse(Buffer.from((await http2('get', '/template/info', undefined, { type: 'productSolution' })).data).toString()).template;
    assert.strictEqual(info.filename, v1.filename);
  });
  await ok('upload keeps the file unchanged next to a tagged copy; tags already in the file are kept as they are; a draft shows what changed', async () => {
    const buf = withoutTag('recipientDesignation');
    const draft = await psTemplates.analyse({ buffer: buf, filename: 'review.docx', uploadedBy: 'tester' });
    assert.strictEqual(draft.autoTagged, false, 'a file that has tags is not changed');
    assert.ok(draft.comparedWith.removed.includes('recipientDesignation'));
    assert.ok(draft.tags.length > 15);
    const done = psTemplates.confirm(draft.id, 'tester');
    const entry = store.get(done.template.id);
    assert.ok(Buffer.compare(store.readFile(entry.id), buf) === 0, 'the tagged copy equals the file when it already had tags');
    assert.ok(Buffer.compare(store.readOriginal(entry.id), buf) === 0, 'the upload is kept');
    assert.throws(() => psTemplates.view(draft.id), /no longer available/, 'the draft is gone after Confirm');
    restore();
  });
  await ok('a template with no tags at all, or tag errors, is refused and nothing changes', async () => {
    const id = store.getActive(store.PS_TYPE).id;
    await assert.rejects(psTemplates.uploadAndActivate({ buffer: Buffer.from('not a docx'), filename: 'x.docx' }), /not a valid \.docx/);
    await assert.rejects(psTemplates.uploadAndActivate({ buffer: changeTemplate(xml => xml.replace('{amName}', '{#oops}{amName}')), filename: 'bad.docx' }), /tag errors|unbalanced|loop/i);
    assert.strictEqual(store.getActive(store.PS_TYPE).id, id);
  });
  function restore() { const v1 = store.list(store.PS_TYPE).find(t => t.version === 1); store.activate(v1.id); }

  server.close();
  console.log(`\n${passed} passed`);
  setTimeout(() => process.exit(process.exitCode || 0), 200);
})().catch(e => { console.error(e); process.exit(1); });
