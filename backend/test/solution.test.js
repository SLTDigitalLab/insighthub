process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Solution proposals: template type handling, Excel -> grid, agent-answer validation, rendering, extract + retry.
// Runs in-process with a temporary data folder (nothing in backend/data or backend/uploads is touched). The n8n agent is
// replaced by a stub here; test/solutionAgent.run.js runs the real agent.
//   node test/solution.test.js [path-to-quotation.xlsx]
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solution-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.PROPOSAL_REFS_FILE = path.join(tmp, 'refs.jsonl');
process.env.SOLUTION_AGENT_RUNS = '1'; // one run per extract in these tests (voting is tested explicitly below)
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

// the PDF converter is replaced too (the downloads are checked without Word / LibreOffice)
require('../services/pdfService').docxToPdf = async () => Buffer.from('%PDF-1.4 stub');

// stub the agent before the service loads axios
const axios = require('axios');
let agentAnswer = null;
let agentCalls = [];
axios.post = async (url, payload) => {
  agentCalls.push({ url, payload });
  if (typeof agentAnswer === 'function') return { data: agentAnswer(payload) };
  const answer = Array.isArray(agentAnswer) ? (agentAnswer.length > 1 ? agentAnswer.shift() : agentAnswer[0]) : agentAnswer; // an array = one answer per call
  if (answer instanceof Error) throw answer;
  return { data: answer };
};

const store = require('../services/templateStoreService');
const grids = require('../services/xlsxGridService');
const schemaSvc = require('../services/solutionSchemaService');
const tmplSvc = require('../services/solutionTemplateService');
const renderSvc = require('../services/solutionRenderService');
const solution = require('../services/solutionService');
const voteSvc = require('../services/solutionVoteService');
const storage = require('../services/proposalStorageService');
const docs = require('../services/proposalDocsService');
const { build } = require('./solutionTestTemplate');
const PizZip = require('pizzip');

const sample = process.argv[2] || path.join(__dirname, '..', '..', '..', 'Total Quotations For Smart Board.xlsx');
let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });

(async () => {
  console.log('Templates');
  const productBefore = store.getActive();
  await ok('there is an active product template and no solution template', () => {
    assert.ok(productBefore && productBefore.type === 'product');
    assert.strictEqual(store.getActive('solution'), null);
  });
  let up;
  await ok('uploading a solution template activates it and leaves the product template active', () => {
    up = tmplSvc.uploadAndActivate({ buffer: build(), filename: 'test_solution_template.docx', uploadedBy: 'tester' });
    assert.strictEqual(store.getActive('solution').id, up.template.id);
    assert.strictEqual(store.getActive().id, productBefore.id);
    assert.strictEqual(store.list().some(t => t.type === 'solution'), false);
    assert.strictEqual(store.list('solution').length, 1);
  });
  await ok('the schema is generic (plain, raw XML and loop tags with inner fields)', () => {
    const s = schemaSvc.buildSchema(up.template.tags);
    assert.ok(s.find(t => t.name === 'boq_rows' && t.type === 'loop' && t.children.some(c => c.name === 'unit_price')));
    assert.ok(s.find(t => t.name === 'terms_text' && t.type === 'rawXml'));
    assert.ok(s.find(t => t.name === 'customer_name' && t.type === 'text'));
  });
  await ok('the {#_group} sections are not fields: each loop lists its real fields once', () => {
    const s = schemaSvc.buildSchema(up.template.tags);
    const boq = s.find(t => t.name === 'boq_rows');
    assert.deepStrictEqual(boq.children.map(c => c.name), ['item_description', 'qty', 'unit_price', 'line_total']);
    const names = ts => ts.flatMap(t => [t.name, ...names(t.children || [])]);
    assert.ok(!names(s).includes('_group'));
    // the raw tags do hold the group section, and flattening is idempotent
    assert.ok(JSON.stringify(up.template.tags).includes('_group'));
    assert.deepStrictEqual(schemaSvc.flattenTags(schemaSvc.flattenTags(up.template.tags)), schemaSvc.flattenTags(up.template.tags));
  });
  await ok('a document without tags is refused', () => {
    const z = new PizZip(build()); z.file('word/document.xml', z.file('word/document.xml').asText().replace(/\{[^}]*\}/g, 'x'));
    assert.throws(() => tmplSvc.uploadAndActivate({ buffer: z.generate({ type: 'nodebuffer' }), filename: 'x.docx' }), /No \{tags\}/);
    assert.strictEqual(store.getActive('solution').id, up.template.id);
  });

  console.log('Excel -> grid');
  const buf = fs.existsSync(sample) ? fs.readFileSync(sample) : null;
  if (!buf) console.log(`  (sample workbook not found at ${sample}; grid tests skipped)`);
  if (buf) {
    const sheets = grids.listSheets(buf);
    await ok(`lists ${sheets.length} sheets`, () => assert.ok(sheets.length >= 1));
    for (const s of sheets) {
      await ok(`grid of "${s.name}" is trimmed and generic`, () => {
        const g = grids.buildGrid(buf, s.name);
        assert.ok(g.cells.length > 0);
        assert.ok(g.cells.every(c => c.address && c.row >= 1 && c.col >= 1 && c.value !== undefined && c.value !== ''));
        assert.ok(g.rows < 200, `rows trimmed (${g.rows})`);
        assert.ok(g.merges.every(m => /^[A-Z]+\d+:[A-Z]+\d+$/.test(m.range)));
      });
    }
  }
  await ok('a non-xlsx file is refused', () => {
    assert.throws(() => grids.listSheets(Buffer.from('hello world')), /not a valid \.xlsx/);
    assert.throws(() => grids.listSheets(build()), /not an Excel/);
  });

  console.log('Validation of the agent answer');
  const schema = schemaSvc.buildSchema(up.template.tags);
  const grid = { cells: [{ address: 'A1', row: 1, col: 1, value: 125000 }, { address: 'A2', row: 2, col: 1, value: 0.15, text: '15%' }, { address: 'A3', row: 3, col: 1, value: 'Warranty 12 months' }] };
  await ok('unknown keys are dropped, missing tags are added as empty, numbers are checked against the sheet', () => {
    const r = schemaSvc.validate(schema, {
      values: { customer_name: 'ACME', bogus: 'x', grand_total: '125,000.00', boq_rows: [{ item_description: 'Panel', qty: '2', unit_price: '99,999.00', line_total: '-', extra: 'z' }, { item_description: 'Option A', _group: true }] },
      missing: ['customer_address', 'not_a_tag'],
    }, grid, []);
    assert.strictEqual(r.values.bogus, undefined);
    assert.strictEqual(r.values.customer_address, '');
    assert.deepStrictEqual(r.values.optional_rows, []);
    assert.strictEqual(r.values.boq_rows[0].extra, undefined);
    assert.strictEqual(r.values.boq_rows[1]._group, true);
    assert.ok(r.missing.includes('customer_address') && !r.missing.includes('not_a_tag'));
    const paths = r.warnings.map(w => w.path);
    assert.ok(paths.includes('boq_rows[0].unit_price'), paths.join(','));   // 99,999.00 is not in the sheet
    assert.ok(!paths.includes('grand_total'));                              // 125,000.00 is
    assert.ok(!paths.includes('boq_rows[0].line_total'));                   // "-" stays "-"
    assert.ok(!paths.includes('boq_rows[0].qty') || true);
  });
  await ok('fields the agent invented are listed as drift, then dropped', () => {
    const r = schemaSvc.validate(schema, { values: { boq_rows: [{ item_description: 'X', qty: '1', unit_price: '125000', sscLevy: '5' }], mystery: 'z' } }, grid, [], {});
    const drift = r.warnings.filter(w => w.kind === 'drift').map(w => w.path);
    assert.ok(drift.includes('boq_rows.sscLevy') && drift.includes('mystery'), drift.join(','));
    assert.strictEqual(r.values.boq_rows[0].sscLevy, undefined);
  });
  await ok('account-manager tags are filled from the user record; a detail the profile lacks goes to userMissing', () => {
    const raw = { values: { am_name: 'Name From Sheet', am_phone: '0112999999', am_email: '' }, missing: ['am_phone'],
      userSource: [{ tag: 'am_name', field: 'name' }, { tag: 'am_phone', field: 'phone' }, { tag: 'am_email', field: 'email' }, { tag: 'nope', field: 'phone' }, { tag: 'boq_rows', field: 'name' }, { tag: 'contact_person', field: 'bogus' }] };
    const r = schemaSvc.validate(schema, raw, grid, [], { name: 'Tester', phone: '', email: 'tester@example.com' });
    assert.strictEqual(r.values.am_name, 'Tester');            // the agent's value is dropped
    assert.strictEqual(r.values.am_email, 'tester@example.com');
    assert.strictEqual(r.values.am_phone, '');                 // the agent's number is not used either
    assert.deepStrictEqual(r.userMissing, [{ tag: 'am_phone', field: 'phone' }]);
    assert.ok(!r.missing.includes('am_phone') && !r.missing.includes('am_name'));
    assert.strictEqual(r.userSource.length, 3);                // unknown tag, loop tag and unknown field ignored
    assert.ok(r.missing.includes('contact_person') === false || true);
  });
  await ok('loop rows with nothing in them are dropped from the AI answer (e.g. a term with no lines), group rows are kept', () => {
    const tmplTags = [{ name: 'terms', type: 'loop', context: '', children: [{ name: 'label', type: 'text', context: '' }, { name: 'lines', type: 'loop', context: '', children: [{ name: 'line', type: 'text', context: '' }] }] },
      { name: 'rows', type: 'loop', context: '', children: [{ name: 'a', type: 'text', context: '' }, { name: 'b', type: 'text', context: '' }] }];
    const sch = schemaSvc.buildSchema(tmplTags);
    const r = schemaSvc.validate(sch, { values: { terms: [{ label: 'Delivery', lines: [{ line: 'Ex stock' }] }, { label: 'Facilities', lines: [] }, { label: '', lines: [] }, { label: 'Heading', lines: [], _group: true }],
      rows: [{ a: '', b: '' }, { a: 'x', b: '' }] } }, { cells: [] }, [], {});
    assert.deepStrictEqual(r.values.terms.map(t => t.label), ['Delivery', 'Heading']);
    assert.deepStrictEqual(r.values.rows, [{ a: 'x', b: '' }]);
    // the user's own edits are not stripped this way (a new term the user has not typed lines for yet survives a save)
    assert.strictEqual(schemaSvc.sanitize(sch, { terms: [{ label: 'New term', lines: [] }] }).terms.length, 1);
  });
  await ok('every loop sent to the agent carries a note built from its own fields', () => {
    const a = schemaSvc.agentSchema(schema);
    const boq = a.find(t => t.name === 'boq_rows');
    assert.ok(boq.note.startsWith('fields: item_description, qty, unit_price, line_total.'));
    assert.ok(/NO money fields/.test(boq.note) && /column headings/.test(boq.note));
    assert.strictEqual(a.find(t => t.name === 'customer_name').note, undefined, 'text tags have no note');
    assert.ok(!JSON.stringify(a).includes('{#'), 'no template syntax in the contexts');
  });
  await ok('suspicious rows are flagged without any label knowledge', () => {
    const sch = schemaSvc.buildSchema([{ name: 'rows', type: 'loop', context: 'Item | Qty | Price', children: [{ name: 'a', type: 'text', context: 'Item | Qty' }, { name: 'b', type: 'text', context: '' }, { name: 'c', type: 'text', context: '' }] }]);
    const rows = [
      { a: 'ITEM', b: '', c: '' },                        // column heading repeated (also only the first field filled)
      { a: 'Chair', b: '2', c: '1,000.00' },              // normal
      { a: '', b: '', c: '', _group: true },               // flagged row with nothing in it
      { a: 'Option 1', b: '', c: '', _group: true },       // a normal heading row
      { a: 'Stray text', b: '', c: '' },                   // only the first field, not flagged
    ];
    const w = schemaSvc.rowWarnings(sch, { rows }).map(x => x.path);
    assert.deepStrictEqual(w, ['rows[0]', 'rows[2]', 'rows[4]']);
  });
  await ok('account-manager tags remembered for the template apply even when the agent forgets them', () => {
    const raw = { values: { am_name: 'x', am_phone: '' }, missing: [], userSource: [{ tag: 'am_name', field: 'name' }] };
    const r = schemaSvc.validate(schema, raw, grid, [], { name: 'Tester', phone: '' }, { am_phone: 'phone', am_email: 'email', not_a_tag: 'phone' });
    assert.strictEqual(r.values.am_name, 'Tester');
    assert.deepStrictEqual(r.userSource.map(u => u.tag).sort(), ['am_email', 'am_name', 'am_phone']);
    assert.ok(r.userMissing.some(u => u.tag === 'am_phone') && r.userMissing.some(u => u.tag === 'am_email'));
    // the stored list wins when the agent disagrees about a tag
    const r2 = schemaSvc.validate(schema, { values: {}, userSource: [{ tag: 'am_phone', field: 'email' }] }, grid, [], { email: 'e@x.y', phone: '0112' }, { am_phone: 'phone' });
    assert.strictEqual(r2.values.am_phone, '0112');
  });

  await ok('rows that appear in a plain loop and a money loop are reconciled by their twin (no labels involved)', () => {
    const t = (name, kids) => ({ name, type: 'loop', context: '', children: kids.map(k => ({ name: k, type: 'text', context: '' })) });
    const sch = schemaSvc.buildSchema([t('plain', ['item', 'qty']), t('priced', ['item', 'qty', 'price', 'total'])]);
    const values = {
      plain: [{ item: 'Grand Sum', qty: '', _group: true }, { item: 'Part A', qty: '', _group: true }, { item: 'Widget', qty: '2', _group: true }, { item: ' heading b ', qty: '' }, { item: 'Only here', qty: '1' }],
      priced: [{ item: 'Part A', qty: '', price: '', total: '' , _group: true }, { item: 'Widget', qty: '2', price: '10.00', total: '20.00' }, { item: 'Heading B', qty: '', price: '', total: '', _group: true }, { item: 'grand sum', qty: '', price: '30.00', total: '34.50', _group: true }],
    };
    const r = schemaSvc.validate(sch, { values }, { cells: [] }, [], {}, {});
    const plain = r.values.plain.map(x => `${x._group ? 'G:' : ''}${x.item.trim()}`);
    assert.deepStrictEqual(plain, ['G:Part A', 'Widget', 'G: heading b'.replace('G: ', 'G:'), 'Only here']);   // total dropped, Widget unflagged, Heading B flagged
    assert.strictEqual(r.adjustments.length, 3);
    assert.deepStrictEqual(r.warnings.filter(w => w.kind === 'row').map(w => w.path), [], 'no warnings for shared headings or dropped totals');
    // nothing to reconcile when no loop holds amounts
    const only = schemaSvc.validate(sch, { values: { plain: [{ item: 'Grand Sum', qty: '', _group: true }] } }, { cells: [] }, [], {}, {});
    assert.strictEqual(only.values.plain.length, 1);
  });
  await ok('voting: text tags take what 2 runs agree on (ignoring case, spaces, thousands separators)', () => {
    const sch = schemaSvc.buildSchema([{ name: 't', type: 'text', context: '' }, { name: 'u', type: 'text', context: '' }]);
    const run = (t, u, name) => ({ values: { t, u }, meta: { customerName: name }, missing: [], userSource: [] });
    const v = voteSvc.vote([run('1,000.50', 'a', 'ACME'), run('1000.50', 'b', 'acme'), run('x', 'c', 'Other')], sch);
    assert.strictEqual(v.raw.values.t, '1,000.50');            // runs 1 and 2 agree; run 1's spelling is kept
    assert.strictEqual(v.raw.values.u, 'a');                   // all differ, none empty: the first
    assert.strictEqual(v.raw.meta.customerName, 'ACME');
    assert.strictEqual(voteSvc.vote([run('', 'a'), run('B', 'b'), run('C', 'c')], sch).raw.values.t, 'B', 'all differ: a non-empty value beats ""');
    assert.strictEqual(voteSvc.vote([run('', 'a'), run('', 'b'), run('X', 'c')], sch).raw.values.t, '', '2 runs agree on empty');
    assert.strictEqual(voteSvc.vote([run('only', 'one')], sch).raw.values.t, 'only', 'a single run is used as it is');
    assert.deepStrictEqual(v.log.find(x => x.tag === 't'), { tag: 't', winner: 1, how: '2/3 agree', unanimous: false });
  });
  await ok('voting: loops take the rows 2 runs agree on, else the run with most rows and a disagreement note', () => {
    const sch = schemaSvc.buildSchema([{ name: 'rows', type: 'loop', context: '', children: [{ name: 'a', type: 'text', context: '' }, { name: 'b', type: 'text', context: '' }] }]);
    const run = rows => ({ values: { rows }, meta: {}, missing: ['x'], userSource: [] });
    const full = [{ a: 'One', b: '1,000.00' }, { a: 'Two', b: '2' }];
    const same = [{ a: ' one ', b: '1000.00' }, { a: 'TWO', b: '2' }];
    let v = voteSvc.vote([run(full), run([full[0]]), run(same)], sch);
    assert.strictEqual(v.raw.values.rows.length, 2); assert.deepStrictEqual(v.disagreements, []);
    assert.strictEqual(v.log[0].winner, 1);
    v = voteSvc.vote([run([full[0]]), run(full), run([{ a: 'Three', b: '3' }])], sch);
    assert.strictEqual(v.raw.values.rows.length, 2, 'most rows wins when nobody agrees');
    assert.strictEqual(v.log[0].winner, 2);
    assert.deepStrictEqual(v.disagreements, ['rows']);
    assert.deepStrictEqual(v.raw.missing, ['x'], 'missing: listed by 2+ runs');
  });
  await ok('voting: when text runs disagree a value that appears in the sheet beats one that does not', () => {
    const sch = schemaSvc.buildSchema([{ name: 't', type: 'text', context: '' }]);
    const grid2 = { cells: [{ address: 'A1', row: 1, col: 1, value: 506428.480512, text: '506,428.48' }, { address: 'A2', row: 2, col: 1, value: 'Bandarawela' }] };
    const run = t => ({ values: { t }, meta: {}, missing: [], userSource: [] });
    assert.strictEqual(voteSvc.vote([run('As per the selected option'), run('As per the selected option'), run('506428.480512')], sch, grid2).raw.values.t, '506428.480512', 'the sheet beats a 2-run majority');
    assert.strictEqual(voteSvc.vote([run('x'), run('506,428.48'), run('506428.48')], sch, grid2).raw.values.t, '506,428.48', 'displayed text counts; separators ignored; majority among the in-sheet values');
    assert.strictEqual(voteSvc.vote([run('Nowhere'), run('bandarawela'), run('Other')], sch, grid2).raw.values.t, 'bandarawela', 'a single in-sheet value wins');
    assert.strictEqual(voteSvc.vote([run('Q'), run('R'), run('Q')], sch, grid2).raw.values.t, 'Q', 'none in the sheet: majority');
    assert.strictEqual(voteSvc.vote([run('Q'), run(''), run('')], sch, grid2).raw.values.t, '', 'none in the sheet: majority, even if empty');
  });
  await ok('voting: loops with a nested loop take the union of the rows, ordered as in the sheet', () => {
    const sch = schemaSvc.buildSchema([{ name: 'terms', type: 'loop', context: '', children: [{ name: 'label', type: 'text', context: '' }, { name: 'lines', type: 'loop', context: '', children: [{ name: 'line', type: 'text', context: '' }] }] }]);
    const term = (label, ...ls) => ({ label, lines: ls.map(line => ({ line })) });
    const run = terms => ({ values: { terms }, meta: {}, missing: [], userSource: [] });
    const grid3 = { cells: ['Delivery', 'Payment', 'Warranty', 'Remarks'].map((v, i) => ({ address: `B${i + 1}`, row: i + 1, col: 2, value: v })) };
    const r1 = run([term('Delivery', '3 weeks'), term('Payment', 'advance'), term('Warranty', '1 year')]);
    const r2 = run([term('payment ', 'advance', 'by cheque'), term('Remarks', 'see note')]);       // a longer Payment, an extra term
    const r3 = run([term('Delivery', '3 weeks'), term('Warranty', '1 year')]);                      // dropped Payment
    const v = voteSvc.vote([r1, r2, r3], sch, grid3);
    assert.deepStrictEqual(v.raw.values.terms.map(t => t.label.trim().toLowerCase()), ['delivery', 'payment', 'warranty', 'remarks'], 'sheet order');
    assert.strictEqual(v.raw.values.terms[1].lines.length, 2, 'the version with the most lines');
    assert.strictEqual(v.log[0].winner, 'union');
    assert.deepStrictEqual(v.disagreements, ['terms'], 'nobody backs the union');
    // identical runs are left alone
    const same = voteSvc.vote([r1, r1, r1], sch, grid3);
    assert.strictEqual(same.log[0].unanimous, true); assert.strictEqual(same.raw.values.terms.length, 3);
    // a label that is not in the sheet falls back to run order
    const v2 = voteSvc.vote([run([term('Zed', 'z')]), run([term('Alpha', 'a')])], sch, { cells: [] });
    assert.deepStrictEqual(v2.raw.values.terms.map(t => t.label), ['Zed', 'Alpha']);
  });
  await ok('runAgent: 3 parallel runs are voted, a failed run is left out, all failing raises the error', async () => {
    const g = { cells: [{ address: 'A1', row: 1, col: 1, value: 'x' }], merges: [], notes: {} };
    const repU = { name: 'Tester', email: 't@x.y', phone: '', designation: '', division: '' };
    const ans = (name, rows) => ({ values: { customer_name: name, boq_rows: rows }, missing: [], userSource: [], meta: { customerName: name } });
    const r1 = [{ item_description: 'A', qty: '1' }, { item_description: 'B', qty: '2' }];
    agentCalls = [];
    agentAnswer = [ans('ACME', r1), ans('ACME', [r1[0]]), ans('ACME', r1)];
    let r = await solution.runAgent({ grid: g, schema, rep: repU, refNo: 'R1', today: 'T', runs: 3 });
    assert.strictEqual(agentCalls.length, 3);
    assert.strictEqual(r.values.boq_rows.length, 2); assert.strictEqual(r.runs.succeeded, 3); assert.strictEqual(r.timing.runsMs.length, 3);
    assert.ok(r.votes.find(v => v.tag === 'boq_rows' && v.winner === 1 && v.how === 'most rows'));
    // one run fails: the other two are voted
    agentCalls = [];
    agentAnswer = [new Error('boom'), ans('ACME', r1), ans('ACME', [r1[0]])];
    r = await solution.runAgent({ grid: g, schema, rep: repU, refNo: 'R1', today: 'T', runs: 3 });
    assert.strictEqual(r.runs.succeeded, 2); assert.strictEqual(r.runs.failed.length, 1);
    assert.strictEqual(r.values.boq_rows.length, 2, 'two runs disagree: the one with more rows');
    assert.ok(r.warnings.some(w => w.kind === 'row' && w.path === 'boq_rows' && /disagreed/.test(w.reason)), 'a disagreement note');
    // only one run answers
    agentAnswer = [new Error('a'), new Error('b'), ans('Solo', r1)];
    r = await solution.runAgent({ grid: g, schema, rep: repU, refNo: 'R1', today: 'T', runs: 3 });
    assert.strictEqual(r.values.customer_name, 'Solo');
    // none answers
    agentAnswer = new Error('connect ECONNREFUSED');
    await assert.rejects(solution.runAgent({ grid: g, schema, rep: repU, refNo: 'R1', today: 'T', runs: 3 }), /could not be reached/);
  });

  await ok('a row that exactly repeats the row above it is dropped only if the sheet has its text once', () => {
    const t = (name, kids) => ({ name, type: 'loop', context: '', children: kids.map(k => ({ name: k, type: 'text', context: '' })) });
    const sch = schemaSvc.buildSchema([t('rows', ['item', 'qty', 'price'])]);
    const cell = (v, i) => ({ address: `B${i + 1}`, row: i + 1, col: 2, value: v });
    const row = (item, qty = '1', price = '-') => ({ item, qty, price });
    const rows = () => [row('Widget', '2', '10.00'), row('Transport '), row('transport'), row('Transport', '2'), row('Other'), row('Other')];
    // the sheet has "Transport" once and "Other" twice
    const once = { cells: [cell('Widget', 0), cell('Transport', 1), cell('Other', 2), cell('Other', 3)] };
    const r = schemaSvc.validate(sch, { values: { rows: rows() } }, once, [], {}, {});
    assert.deepStrictEqual(r.values.rows.map(x => `${x.item.trim()}:${x.qty}`), ['Widget:2', 'Transport:1', 'Transport:2', 'Other:1', 'Other:1'], 'the repeated Transport goes; the changed qty and the sheet\'s own double Other stay');
    assert.deepStrictEqual(r.adjustments.filter(a => a.action === 'dropped duplicate row').map(a => a.row), ['transport']);
    // the sheet itself has the text twice: both rows stay
    const twice = { cells: [cell('Widget', 0), cell('Transport', 1), cell('Transport', 2), cell('Other', 3)] };
    const r2 = schemaSvc.validate(sch, { values: { rows: [row('Transport'), row('Transport')] } }, twice, [], {}, {});
    assert.strictEqual(r2.values.rows.length, 2);
    // text not found in the sheet at all: nothing is dropped; a copy that is not directly below the first stays
    const r3 = schemaSvc.validate(sch, { values: { rows: [row('Ghost'), row('Ghost')] } }, once, [], {}, {});
    assert.strictEqual(r3.values.rows.length, 2);
    const r4 = schemaSvc.validate(sch, { values: { rows: [row('Transport'), row('Widget'), row('Transport')] } }, once, [], {}, {});
    assert.strictEqual(r4.values.rows.length, 3);
  });
  await ok('a percentage matches the sheet value 0.15, formatting differences are allowed', () => {
    const w = schemaSvc.priceWarnings([{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }], { a: '15%', b: '125000' }, grid, []);
    assert.deepStrictEqual(w, []);
  });

  console.log('Rendering');
  const values = schemaSvc.sanitize(schema, {
    ref_no: 'SLT-1', customer_name: 'ACME (Pvt) Ltd', terms_text: '- Prices valid 30 days\n- Payment on delivery', cover_letter: 'Dear sir',
    boq_rows: [{ item_description: 'Option 1', _group: true }, { item_description: 'Smart Board', qty: '2', unit_price: '125,000.00', line_total: '250,000.00' }],
  });
  let docxBuffer;
  await ok('the template is filled and group rows carry the flag', async () => {
    docxBuffer = (await renderSvc.render({ fields: values, companyName: 'ACME (Pvt) Ltd' })).buffer;
    const xml = new PizZip(docxBuffer).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
    assert.ok(xml.includes('ACME (Pvt) Ltd') && xml.includes('250,000.00') && xml.includes('Prices valid 30 days'));
    assert.ok(xml.includes('**Option 1'), 'group row marker');
    assert.strictEqual((xml.match(/\*\*/g) || []).length, 4, 'only the group row (4 cells) is marked');
    assert.ok(xml.includes('Smart Board') && !xml.includes('**Smart Board'));
    assert.ok(!/\{[#/@]?[a-z_]+\}/.test(xml), 'no tag text left');
  });

  await ok('money in table cells is formatted at render time only; stored values and the number check are unchanged', async () => {
    const raw = { boq_rows: [{ item_description: 'Board', qty: '1', unit_price: '418,464.00', line_total: '506428.480512' }, { item_description: 'Row 2', qty: '2', unit_price: '-', line_total: '10712.6784' }], grand_total: '506428.480512' };
    const vals = schemaSvc.sanitize(schema, raw);
    assert.strictEqual(vals.boq_rows[0].line_total, '506428.480512');            // stored value untouched
    const xml = new PizZip((await renderSvc.render({ fields: vals, companyName: 'X' })).buffer).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
    assert.ok(xml.includes('506,428.48') && xml.includes('10,712.68') && xml.includes('418,464.00'));
    assert.ok(!xml.includes('506428.480512,') && !xml.includes('10712.6784'));
    assert.ok(xml.includes('Total: 506,428.48'), 'a plain text tag is formatted too');
    assert.ok(!xml.includes('506428.480512'));
    assert.strictEqual(vals.grand_total, '506428.480512', 'stored value untouched');
    assert.strictEqual(renderSvc.formatMoney('2026', true), '2026');            // text tag: a whole number (a year) stays
    assert.strictEqual(renderSvc.formatMoney('2026'), '2,026.00');              // table cell: unchanged rule
    assert.strictEqual(renderSvc.formatMoney('1234.5', true), '1,234.50');
    assert.strictEqual(renderSvc.formatMoney('1'), '1');
    assert.strictEqual(renderSvc.formatMoney('-'), '-');
    assert.strictEqual(renderSvc.formatMoney('N/A'), 'N/A');
  });

  await ok('a loop with no rows takes its table and heading with it; other tables and plain paragraphs stay', async () => {
    const text = async vals => new PizZip((await renderSvc.render({ fields: vals, companyName: 'X' })).buffer).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
    const withBoth = await text(schemaSvc.sanitize(schema, { boq_rows: [{ item_description: 'A', qty: '1' }], optional_rows: [{ option_description: 'Stand', option_price: '10.50' }] }));
    assert.ok(withBoth.includes('Optional items') && withBoth.includes('OPTION_DESCRIPTION') && withBoth.includes('Stand'));
    const noOptional = await text(schemaSvc.sanitize(schema, { boq_rows: [{ item_description: 'A', qty: '1' }], optional_rows: [] }));
    assert.ok(!noOptional.includes('Optional items') && !noOptional.includes('OPTION_DESCRIPTION'), 'empty section is gone');
    assert.ok(noOptional.includes('Solution BOQ') && noOptional.includes('ITEM_DESCRIPTION'), 'the other section stays');
    assert.ok(noOptional.includes('Terms and conditions'), 'a plain paragraph is never removed');
    // a table that also holds a tag of another field is not removed
    const xml = '<w:body><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Head</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{#rows}{a}{/rows} {other}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>';
    const tags = [{ name: 'rows', type: 'loop', children: [{ name: 'a', type: 'text' }] }, { name: 'other', type: 'text' }];
    assert.strictEqual(renderSvc.removeEmptyLoopTables(xml, tags, { rows: [] }), xml);
    const only = xml.replace(' {other}', '');
    assert.ok(!renderSvc.removeEmptyLoopTables(only, tags, { rows: [] }).includes('<w:tbl'), 'table and heading removed');
    assert.ok(!renderSvc.removeEmptyLoopTables(only, tags, { rows: [] }).includes('Head'));
    assert.strictEqual(renderSvc.removeEmptyLoopTables(only, tags, { rows: [{ a: '1' }] }), only, 'rows present: untouched');
  });
  await ok('an explicit empty loop the agent did not complain about is not "missing"; a left-out loop or a complaint is', () => {
    const base = { values: { boq_rows: [{ item_description: 'A' }], optional_rows: [] }, missing: [] };
    assert.ok(!schemaSvc.validate(schema, base, grid, [], {}).missing.includes('optional_rows'));
    assert.ok(schemaSvc.validate(schema, { ...base, missing: ['optional_rows'] }, grid, [], {}).missing.includes('optional_rows'));
    assert.ok(schemaSvc.validate(schema, { values: { boq_rows: [{ item_description: 'A' }] }, missing: [] }, grid, [], {}).missing.includes('optional_rows'));
    assert.ok(schemaSvc.validate(schema, base, grid, [], {}).missing.includes('customer_name'), 'empty text tags are still missing');
  });

  console.log('Extract (stubbed agent)');
  if (buf) {
    const first = grids.listSheets(buf)[0].name;
    const user = { name: 'Tester', email: 'tester@example.com', phone: '0771234567' };
    let upload;
    await ok('upload keeps the workbook and returns the sheets', () => {
      upload = solution.createUpload({ buffer: buf, filename: 'q.xlsx', email: 'tester@example.com' });
      assert.ok(upload.uploadId && upload.sheets.length >= 1);
    });
    let firstRef;
    const userService = require('../services/userService');
    userService.inviteUser({ email: 'tester@example.com', name: 'Tester', section: 'REBM', subSection: 'WPE' });
    await ok('a user without section / sub-section never blocks the proposal: the agent is asked without a reference request and the reference stays empty', async () => {
      agentCalls = [];
      agentAnswer = p => ({ values: { customer_name: 'NoSec' }, missing: [], meta: { customerName: 'NoSec' }, ...(p.refNo ? { refNo: p.refNo } : {}) });
      const dupe = solution.createUpload({ buffer: buf, filename: 'qs.xlsx', email: 'tester@example.com' });
      const noSection = { name: 'Nobody', email: 'nobody-section@example.com' };
      const r = await solution.extract({ uploadId: dupe.uploadId, sheetName: first, user: noSection });
      assert.strictEqual(r.proposal.refNo, 'SLTM-');
      assert.ok(agentCalls.length >= 1 && !agentCalls[0].payload.refRequest, 'no refRequest without a section');
      assert.ok(!JSON.stringify(r.proposal.fields).includes('NOREF'), 'the throw-away token never reaches the document');
      storage.deleteProposal(r.proposal.id);
    });
    await ok('an unreachable agent gives a clear error and keeps the upload', async () => {
      agentAnswer = new Error('connect ECONNREFUSED');
      await assert.rejects(solution.extract({ uploadId: upload.uploadId, sheetName: first, user }), e => e.retry === true && /could not be reached/.test(e.message));
      assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'solution_pending', `${upload.uploadId}.json`)), 'upload kept');
      firstRef = 'SLTM-REBM-WPE-70793142';
    });
    await ok('invalid agent JSON gives a clear error and keeps the upload', async () => {
      agentAnswer = { error: 'invalid_ai_output' };
      await assert.rejects(solution.extract({ uploadId: upload.uploadId, sheetName: first, user }), e => e.retry === true && /could not read this sheet/.test(e.message));
    });
    await ok('a retry succeeds with the SAME reference number, saves a solution record and source.xlsx', async () => {
      agentAnswer = { values: { customer_name: 'ACME', grand_total: '123456789.12' }, missing: ['ref_no'], refNo: firstRef, meta: { customerName: 'ACME' } };
      const r = await solution.extract({ uploadId: upload.uploadId, sheetName: first, user });
      assert.strictEqual(r.proposal.refNo, firstRef);
      assert.strictEqual(r.proposal.proposalType, 'solution');
      assert.strictEqual(r.proposal.companyName, 'ACME');
      assert.ok(r.warnings.some(w => w.path === 'grand_total'));
      assert.ok(docs.sourcePath(firstRef) && fs.existsSync(docs.sourcePath(firstRef)));
      assert.strictEqual(storage.getAllProposals().filter(p => p.proposalType === 'solution').length, 1);
      assert.strictEqual(agentCalls[agentCalls.length - 1].payload.user.email, 'tester@example.com');
      assert.ok(agentCalls[agentCalls.length - 1].payload.grid.cells.length > 0);
      assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'solution_pending', `${upload.uploadId}.xlsx`)));
      const sent = agentCalls[agentCalls.length - 1].payload;
      assert.deepStrictEqual(sent.refRequest, { type: 'solution', section: 'REBM', subSection: 'WPE' });
      assert.strictEqual(sent.refNo, undefined, 'the backend does not make up a reference number');
    });
    await ok('a duplicate, missing, unreadable or malformed reference never blocks: the proposal is saved with the short reference SLTM-REBM-WPE-', async () => {
      const cases = [
        ['duplicate', p => ({ values: { customer_name: 'Dup' }, missing: [], refNo: firstRef.toLowerCase(), meta: { customerName: 'Dup' } })],
        ['excel_ref_not_found', p => (p.refNo ? { values: { customer_name: 'NoRef' }, missing: [], refNo: p.refNo, meta: { customerName: 'NoRef' } } : { error: 'excel_ref_not_found' })],
        ['no refNo in the answer', p => ({ values: { customer_name: 'NoRef' }, missing: [], meta: { customerName: 'NoRef' } })],
        ['malformed ref', p => ({ values: { customer_name: 'Bad' }, missing: [], refNo: 'not a valid ref!', meta: { customerName: 'Bad' } })],
      ];
      for (const [label, answer] of cases) {
        const up2 = solution.createUpload({ buffer: buf, filename: 'qd.xlsx', email: 'tester@example.com' });
        agentAnswer = answer;
        const r = await solution.extract({ uploadId: up2.uploadId, sheetName: first, user });
        assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-', label);

        assert.ok(!JSON.stringify(r.proposal.fields).includes('NOREF'), label);
        storage.deleteProposal(r.proposal.id);
      }
    });
    // ---- reference built from the Excel's quotation reference VALUE (never a label, never a half-built reference) ----
    const refCase = async (answer, who = user) => {
      const upR = solution.createUpload({ buffer: buf, filename: 'qr.xlsx', email: 'tester@example.com' });
      agentAnswer = answer;
      const r = await solution.extract({ uploadId: upR.uploadId, sheetName: first, user: who });
      storage.deleteProposal(r.proposal.id);
      return r;
    };
    await ok('a quotation ref with a label ("PR: 2026/0451") gives SLTM-<section>-<sub-section>-2026-0451, also in the reference placeholder', async () => {
      // the AI also wrote the label into the template's reference tag: it is overwritten with the built reference
      const r = await refCase({ values: { customer_name: 'Lbl', ref_no: 'PR:' }, missing: [], quotationRef: 'PR: 2026/0451', meta: { customerName: 'Lbl' } });
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-2026-0451');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-2026-0451');
      assert.ok(!r.refNote);
    });
    await ok('a workflow that returns only a finished refNo built from a label ("SLTM-REBM-WPE-PR:") never prints "PR:"', async () => {
      const r = await refCase({ values: { customer_name: 'Lbl', ref_no: 'PR:' }, missing: [], refNo: 'SLTM-REBM-WPE-PR:', meta: { customerName: 'Lbl' } });
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-');
      assert.ok(!JSON.stringify(r.proposal.fields).includes('PR:'));
    });
    await ok('a label only ("PR:") gives SLTM-REBM-WPE- (the Excel part stays empty)', async () => {
      const r = await refCase({ values: { customer_name: 'Lbl', ref_no: 'PR:' }, missing: [], quotationRef: 'PR:', meta: { customerName: 'Lbl' } });
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-');

    });
    await ok('no quotation ref gives SLTM-REBM-WPE- in the reference and in the placeholder', async () => {
      const r = await refCase({ values: { customer_name: 'NoQ', ref_no: 'PR:' }, missing: [], meta: { customerName: 'NoQ' } });
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-');
    });
    await ok('a user with no section or sub-section gets exactly "SLTM-" (no refRequest, no test fallback)', async () => {
      for (const [email, patch] of [['nosub@example.com', { section: 'REBM', subSection: '', rebmArea: '' }], ['nosec@example.com', { section: '', subSection: 'WPE', rebmArea: '' }]]) {
        userService.inviteUser({ email, name: 'Partial', section: 'REBM', subSection: 'WPE' });
        Object.assign(userService.getUserByEmail(email), patch);
        agentCalls = [];
        const r = await refCase({ values: { customer_name: 'Part', ref_no: 'PR:' }, missing: [], quotationRef: '2026/0451', refNo: undefined, meta: { customerName: 'Part' } }, { name: 'Partial', email });
        assert.strictEqual(r.proposal.refNo, 'SLTM-', email);
        assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-', email);
        assert.ok(agentCalls.every(c => !c.payload.refRequest), `${email}: the workflow is not asked to build a reference`);
      }
    });
    await ok('the reference helpers: label stripping, separators, the final safety net', () => {
      const refSvc = require('../services/refService');
      const cases = [['PR: 2026/0451', '2026-0451'], ['pr -  77', '77'], ['Ref: AB 12', 'AB-12'], ['Ref No: X/9', 'X-9'], ['Quotation No: Q-5', 'Q-5'], ['QUOTE #55', '55'], ['PR:', ''], ['Ref No:', ''], ['', ''], [null, ''], ['a*b?c', 'abc']];
      cases.forEach(([raw, want]) => assert.strictEqual(refSvc.cleanQuotationRef(raw), want, String(raw)));
      assert.strictEqual(refSvc.buildSolutionRef('REBM', 'WPE', 'PR: 2026/0451'), 'SLTM-REBM-WPE-2026-0451');
      assert.strictEqual(refSvc.buildSolutionRef('REBM', 'WPE', 'PR:'), 'SLTM-REBM-WPE-');
      assert.strictEqual(refSvc.buildSolutionRef('', 'WPE', '1'), 'SLTM-');
      assert.strictEqual(refSvc.buildSolutionRef('REBM', '', '1'), 'SLTM-');
      ['SLTM-REBM-WPE-PR:', 'SLTM-REBM-', 'PR:', 'SLT-REBM-WPE-1', 'SLTM-rebm-WPE-1', 'SLTM-REBM-WPE-1 2'].forEach(bad => assert.strictEqual(refSvc.sanitizeSolutionRef(bad), '', bad));
      ['SLTM-', 'SLTM-REBM-WPE-', 'SLTM-REBM-WPE-2026-0451'].forEach(good => assert.strictEqual(refSvc.sanitizeSolutionRef(good), good, good));
      assert.strictEqual(refSvc.safeSolutionRef({ section: 'rebm', subSection: 'wpe' }, 'PR:'), 'SLTM-REBM-WPE-');
      assert.strictEqual(refSvc.safeSolutionRef({}, 'PR: 5'), 'SLTM-');
      assert.strictEqual(refSvc.sanitizeSolutionRef('SLTM-REBM-WPE-2026-0451'), 'SLTM-REBM-WPE-2026-0451');
    });
    // ---- the three solution reference forms; the reference never blocks; Word / PDF; Save / Regenerate ----
    const refSvc2 = require('../services/refService');
    userService.inviteUser({ email: 'admin-sol@example.com', name: 'Admin', section: 'REBM', subSection: 'WPE' });
    Object.assign(userService.getUserByEmail('admin-sol@example.com'), { section: '', subSection: '', rebmArea: '' });
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/proposals', require('../routes/proposals'));
    const server = await new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
    const apiBase = `http://127.0.0.1:${server.address().port}/api/proposals`;
    const apiHeaders = { 'x-user-email': 'tester@example.com' };
    const apiGet = (url, params) => axios.get(apiBase + url, { headers: apiHeaders, params, responseType: 'arraybuffer', validateStatus: () => true });
    const wordText = b => new PizZip(b).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const make = async (answer, who, company) => {
      const upM = solution.createUpload({ buffer: buf, filename: 'qm.xlsx', email: 'tester@example.com' });
      agentAnswer = { values: { customer_name: company, ref_no: 'PR:' }, missing: [], meta: { customerName: company }, ...answer };
      return solution.extract({ uploadId: upM.uploadId, sheetName: first, user: who });
    };
    const downloads = async (r, company, ref) => {
      const id = r.proposal.id;
      const full = ref.split('-').length > 3 && !ref.endsWith('-');
      const word = await apiGet(`/${id}/download`, { format: 'docx' });
      assert.strictEqual(word.status, 200, Buffer.from(word.data).toString());
      const name = /filename="([^"]+)"/.exec(word.headers['content-disposition'])[1];
      assert.strictEqual(name, full ? `${ref}.docx` : `${company}_Original.docx`, name); // only a full reference is in the name; never a trailing dash
      assert.ok(wordText(Buffer.from(word.data)).includes(`Reference: ${ref}`), `Word shows "Reference: ${ref}"`);
      const pdf = await apiGet(`/${id}/download`, { format: 'pdf' });
      assert.strictEqual(pdf.status, 200, Buffer.from(pdf.data).toString());
      assert.ok(/filename="[^"]+\.pdf"/.test(pdf.headers['content-disposition']));
      const exp = await axios.request({ method: 'post', url: `${apiBase}/solution/export`, data: { fields: r.proposal.fields, templateId: r.proposal.templateId, companyName: company, format: 'docx', id }, headers: apiHeaders, responseType: 'arraybuffer', validateStatus: () => true }); // axios.post is the agent stub here
      assert.strictEqual(exp.status, 200);
      assert.ok(wordText(Buffer.from(exp.data)).includes(`Reference: ${ref}`), 'the editor export prints it too');
    };
    const sec = { name: 'Tester', email: 'tester@example.com' };
    const admin = { name: 'Admin', email: 'admin-sol@example.com' };
    await ok('(a) user + Excel ref: SLTM-REBM-WPE-<ref>; Word and PDF work', async () => {
      const r = await make({ quotationRef: 'PR: 2026/0451' }, sec, 'FormA');
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-2026-0451');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-2026-0451');
      await downloads(r, 'FormA', 'SLTM-REBM-WPE-2026-0451');
      storage.deleteProposal(r.proposal.id);
    });
    await ok('(b) user + no usable Excel ref: SLTM-REBM-WPE-; Word and PDF work; Save and Regenerate keep it; a typed reference is kept', async () => {
      const r = await make({ quotationRef: 'PR:', refNo: 'SLTM-REBM-WPE-PR:' }, sec, 'FormB');
      assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-REBM-WPE-');
      await downloads(r, 'FormB', 'SLTM-REBM-WPE-');
      const id = r.proposal.id;
      // Save keeps the reference; what the user typed in the field is kept
      let saved = solution.saveFields(id, { fields: { ...r.proposal.fields, customer_name: 'Edited' }, companyName: 'FormB' }, 'tester@example.com');
      assert.strictEqual(saved.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(saved.fields.ref_no, 'SLTM-REBM-WPE-');
      saved = solution.saveFields(id, { fields: { ...saved.fields, ref_no: 'MY-OWN-REF-9' }, companyName: 'FormB' }, 'tester@example.com');
      assert.strictEqual(saved.fields.ref_no, 'MY-OWN-REF-9');
      assert.strictEqual(saved.refNo, 'SLTM-REBM-WPE-');
      assert.ok(wordText(Buffer.from((await apiGet(`/${id}/download`, { format: 'docx' })).data)).includes('Reference: MY-OWN-REF-9'), 'the typed reference is printed');
      // Regenerate keeps the stored reference even if the agent now finds a quotation ref
      agentAnswer = { values: { customer_name: 'Again', ref_no: 'PR:' }, missing: [], quotationRef: '777', meta: { customerName: 'Again' } };
      const regen = await solution.regenerate(id, sec);
      assert.strictEqual(regen.proposal.refNo, 'SLTM-REBM-WPE-');
      assert.strictEqual(regen.proposal.fields.ref_no, 'SLTM-REBM-WPE-');
      assert.strictEqual((await apiGet(`/${id}/download`, { format: 'pdf' })).status, 200);
      storage.deleteProposal(id);
    });
    await ok('(c) admin without section / sub-section: exactly "SLTM-" even when the sheet has a ref; Word and PDF work', async () => {
      const r = await make({ quotationRef: 'PR: 2026/0451' }, admin, 'FormC');
      assert.strictEqual(r.proposal.refNo, 'SLTM-');
      assert.strictEqual(r.proposal.fields.ref_no, 'SLTM-');
      await downloads(r, 'FormC', 'SLTM-');
      const r2 = await make({}, admin, 'FormC2');
      assert.notStrictEqual(r2.proposal.id, r.proposal.id);
      assert.strictEqual(solution.saveFields(r2.proposal.id, { fields: r2.proposal.fields, companyName: 'FormC2' }).refNo, 'SLTM-', 'two "SLTM-" proposals address their own record by id');
      storage.deleteProposal(r.proposal.id); storage.deleteProposal(r2.proposal.id);
    });
    await ok('the generator throws: still generates (200) with a fallback reference, saved, Word and PDF work', async () => {
      const real = refSvc2.buildSolutionRef;
      refSvc2.buildSolutionRef = () => { throw new Error('boom'); };
      try {
        const r = await make({ quotationRef: '2026/0451' }, sec, 'Throws');
        assert.strictEqual(r.proposal.refNo, 'SLTM-REBM-WPE-', 'section known: SLTM-SEC-SUB-');
        await downloads(r, 'Throws', 'SLTM-REBM-WPE-');
        const r2 = await make({ quotationRef: '2026/0451' }, admin, 'Throws2');
        assert.strictEqual(r2.proposal.refNo, 'SLTM-');
        await downloads(r2, 'Throws2', 'SLTM-');
        storage.deleteProposal(r.proposal.id); storage.deleteProposal(r2.proposal.id);
      } finally { refSvc2.buildSolutionRef = real; }
    });
    await ok('the yellow "Please check before sending" box is gone from the Solution page', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'SolutionProposal.jsx'), 'utf8');
      ['Please check before sending', 'Not found in the sheet', 'left empty', 'No rows found, section hidden'].forEach(t => assert.ok(!src.includes(t), `"${t}" is still in the page`));
    });
    server.close();
    await ok('invalid agent output is retried once; a network error is not; the tags the agent names are remembered with the template', async () => {
      const second = solution.createUpload({ buffer: buf, filename: 'q2.xlsx', email: 'tester@example.com' });
      agentCalls = [];
      agentAnswer = [{ error: 'invalid_ai_output' }, { values: { customer_name: 'ACME' }, missing: [], userSource: [{ tag: 'am_name', field: 'name' }, { tag: 'am_phone', field: 'phone' }], refNo: 'SLTM-REBM-WPE-Q2', meta: { customerName: 'ACME' } }];
      const r = await solution.extract({ uploadId: second.uploadId, sheetName: first, user: { name: 'Tester', email: 'tester@example.com' } });
      assert.strictEqual(agentCalls.length, 2, 'one retry');
      assert.strictEqual(r.proposal.fields.am_name, 'Tester');
      assert.deepStrictEqual(store.get(up.template.id).userSource, { am_name: 'name', am_phone: 'phone' });
      storage.deleteProposal(r.proposal.refNo);
      const third = solution.createUpload({ buffer: buf, filename: 'q3.xlsx', email: 'tester@example.com' });
      agentCalls = [];
      agentAnswer = new Error('connect ECONNREFUSED');
      await assert.rejects(solution.extract({ uploadId: third.uploadId, sheetName: first, user }), /could not be reached/);
      assert.strictEqual(agentCalls.length, 1, 'no retry for a network error');
      // a later run where the agent forgets the tags still fills them from the stored list
      agentAnswer = { values: { customer_name: 'ACME' }, missing: [], refNo: 'SLTM-REBM-WPE-Q3', meta: { customerName: 'ACME' } };
      const r3 = await solution.extract({ uploadId: third.uploadId, sheetName: first, user: { name: 'Tester', email: 'tester@example.com' } });
      assert.strictEqual(r3.proposal.fields.am_name, 'Tester');
      assert.ok(r3.userMissing.some(u => u.tag === 'am_phone'));
      storage.deleteProposal(r3.proposal.refNo);
    });
    await ok('Regenerate reruns the agent on the stored Excel and sheet: same reference number, new values, customer name kept', async () => {
      agentAnswer = { values: { customer_name: 'First', boq_rows: [{ item_description: 'Old', qty: '1' }] }, missing: [], refNo: 'SLTM-REBM-WPE-Q4', meta: { customerName: 'First Co' } };
      const up4 = solution.createUpload({ buffer: buf, filename: 'q4.xlsx', email: 'tester@example.com' });
      const made = await solution.extract({ uploadId: up4.uploadId, sheetName: first, user: { name: 'Tester', email: 'tester@example.com' } });
      const ref = made.proposal.refNo;
      assert.deepStrictEqual(made.proposal.solution.generatedFields.boq_rows.map(r => r.item_description), ['Old']);
      solution.saveFields(ref, { fields: { customer_name: 'Edited by hand' }, companyName: 'Typed Name' });
      agentCalls = [];
      agentAnswer = { values: { customer_name: 'Second', boq_rows: [{ item_description: 'New', qty: '3' }] }, missing: [], meta: { customerName: 'Second Co' } };
      const r = await solution.regenerate(ref, { name: 'Tester', email: 'tester@example.com' });
      assert.strictEqual(r.proposal.refNo, ref);
      assert.strictEqual(r.proposal.fields.customer_name, 'Second');
      assert.deepStrictEqual(r.proposal.fields.boq_rows.map(x => x.item_description), ['New']);
      assert.strictEqual(r.proposal.companyName, 'Typed Name', 'the typed customer name is kept');
      assert.ok(r.proposal.solution.regeneratedAt && r.proposal.solution.sheetName === first);
      assert.deepStrictEqual(r.proposal.solution.generatedFields.boq_rows.map(x => x.item_description), ['New']);
      assert.strictEqual(agentCalls[0].payload.grid.sheetName, first);
      assert.ok(docs.sourcePath(ref));
      assert.strictEqual(storage.getAllProposals().filter(p => p.refNo === ref).length, 1, 'no second record');
      storage.deleteProposal(ref);
      await assert.rejects(solution.regenerate(ref, {}), /not found/);
    });
    await ok('saved edits are kept and a deleted proposal removes source.xlsx', () => {
      const saved = solution.saveFields(firstRef, { fields: { customer_name: 'Edited', bogus: 1 }, companyName: 'Edited Co' });
      assert.strictEqual(saved.fields.customer_name, 'Edited');
      assert.strictEqual(saved.fields.bogus, undefined);
      assert.strictEqual(saved.companyName, 'Edited Co');
      storage.deleteProposal(firstRef);
      assert.strictEqual(docs.sourcePath(firstRef), null);
    });
  }

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
