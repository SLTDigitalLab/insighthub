process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Product terms and conditions: the per-product loop {#productTerms} and the older {@productTermsXml} block.
// Runs in an isolated copy of the backend with a temporary data folder: nothing in backend/data (the running app's templates,
// proposals, references) is changed. The app's active template is only READ, as the base for the test templates.
//   node test/productTerms.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// pdf.js (inside pdf-parse) dies on font loading after the first document of a process, so every PDF is read by a short-lived
// child process of this same file: node productTerms.test.js --pdf <file>  ->  one JSON line with the pages
if (process.argv[2] === '--pdf') {
  const IMG = new Set([82, 83, 84, 85, 86, 87, 88, 89]); // pdf.js paint-image operators
  const out = [];
  require('pdf-parse')(fs.readFileSync(process.argv[3]), { pagerender: async pg => {
    const tc = await pg.getTextContent();
    const ops = await pg.getOperatorList();
    const items = tc.items.filter(i => i.str.trim() && i.transform[5] > 70 && i.transform[5] < 790 && !/^(Proposal Ref|Page d|# )/i.test(i.str.trim()) && !/^d{1,2}$/.test(i.str.trim()));
    out.push({ images: ops.fnArray.filter(f => IMG.has(f)).length, items: items.length, text: items.map(i => i.str).join('') });
    return '';
  } }).then(() => { process.stdout.write('JSON:' + JSON.stringify(out) + '\n'); process.exit(0); }, e => { console.error(e); process.exit(1); });
} else main();

function main() {
const REAL = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-terms-'));
const COPY = path.join(TMP, 'backend');
const DATA = path.join(TMP, 'data');

// ---- the isolated copy --------------------------------------------------------------------------------------------------
['proposal', 'routes', 'services', 'templates'].forEach(d => fs.cpSync(path.join(REAL, d), path.join(COPY, d), { recursive: true }));
fs.mkdirSync(path.join(COPY, 'data'), { recursive: true });
fs.cpSync(path.join(REAL, '..', 'scripts'), path.join(TMP, 'scripts'), { recursive: true }); // the Word PDF converter, found relative to services/
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(COPY, 'package.json'));
fs.symlinkSync(path.join(REAL, 'node_modules'), path.join(COPY, 'node_modules'), 'junction');
fs.mkdirSync(DATA, { recursive: true });
process.env.DATA_DIR = DATA;
process.env.N8N_PROPOSAL_V2_WEBHOOK_URL = 'http://127.0.0.1:1/none'; // the AI is never called for real

// Fixture catalogue: the copy's products.json is replaced, so no real product name or text is needed
const T1 = 'Alpha clause one applies. Alpha clause two applies to every site. Charges may change.';
const longTerms = tag => Array.from({ length: 70 }, (_, i) => `${tag} long clause ${i + 1} describes what the customer must provide and what may be charged separately.`).join(' ');
const PRODUCTS = [
  { id: 'p1', name: 'Product One', diagram: 'premium-vpn.png', termsAndConditions: T1 },
  { id: 'p2', name: 'Product Two', diagram: 'ssl-vpn-remote-vpn.png', termsAndConditions: T1 }, // exactly the same terms as p1
  { id: 'p3', name: 'Product Three', termsAndConditions: '' }, // no terms
  { id: 'p4', name: 'Product Four', termsAndConditions: ['Gamma item one.', 'Gamma item two. Gamma item three.'] }, // array
  { id: 'p5', name: 'Product Five', termsAndConditions: 'Delta clause only.' },
  { id: 'p6', name: 'Product Six' }, // field missing
  { id: 'p7', name: 'Product Seven', termsAndConditions: longTerms('Seven') }, // runs across pages
  { id: 'p8', name: 'Product Eight', termsAndConditions: longTerms('Eight') },
].map(p => ({ pillar: 'x', description: `${p.name} description.`, proposalDescription: `${p.name} description.`, features: [], service: 's', accessMedia: 'm', ntu: 'n', ...p }));
fs.writeFileSync(path.join(COPY, 'data', 'products.json'), JSON.stringify(PRODUCTS));
const termsOf = id => { const v = PRODUCTS.find(p => p.id === id).termsAndConditions; return Array.isArray(v) ? v.join(' ') : (v || ''); };

const PizZip = require(path.join(COPY, 'node_modules', 'pizzip'));
const store = require(path.join(COPY, 'services', 'templateStoreService'));
const draft = require(path.join(COPY, 'services', 'draftService'));
const render = require(path.join(COPY, 'services', 'renderService'));
const { extractTags } = require(path.join(COPY, 'services', 'templateTagService'));
const { captureFormats } = require(path.join(COPY, 'services', 'templateFormats'));
const terms = require(path.join(COPY, 'services', 'termsService'));
const { slots } = require(path.join(COPY, 'proposal', 'fieldSchema'));
const { docxToPdf } = require(path.join(COPY, 'services', 'pdfService'));
const pdfParse = require(path.join(COPY, 'node_modules', 'pdf-parse'));
const axios = require(path.join(COPY, 'node_modules', 'axios'));
const drafts = require(path.join(COPY, 'services', 'templateDraftService'));
require(path.join(COPY, 'services', 'userService')).inviteUser({ email: 'terms-test@example.com', name: 'Terms Test', section: 'REBM', subSection: 'WPE' });

// The AI template mapper is replaced by a stand-in that finds nothing (the test templates are already tagged); the slots the
// upload asked for are recorded so a test can see whether a terms tag was ever offered
let askedSlots = [];
const realPost = axios.post.bind(axios);
axios.post = async (url, body, ...rest) => {
  // the proposal workflow is stood in too: it builds the reference number (no AI text is needed here)
  if (body && body.refRequest) return { data: { values: {}, refNo: `SLTM-REBM-WPE-${Math.floor(10000000 + Math.random() * 89999999)}` } };
  if (String(url).includes('template-mapper')) { askedSlots = (body.slots || []).map(s => s.key); return { data: { mappings: [] } }; }
  return realPost(url, body, ...rest);
};

// base template = the app's active tagged version (read only), or the bundled default
const liveIndex = (() => { try { return JSON.parse(fs.readFileSync(path.join(REAL, 'data', 'proposal_templates.json'), 'utf8')); } catch { return []; } })();
const live = liveIndex.find(t => t.isActive);
const BASE = live && fs.existsSync(path.join(REAL, 'data', 'templates', `${live.id}.docx`))
  ? fs.readFileSync(path.join(REAL, 'data', 'templates', `${live.id}.docx`))
  : fs.readFileSync(path.join(REAL, 'templates', 'Product_Proposal_Template.docx'));

// ---- helpers --------------------------------------------------------------------------------------------------------------
const paras = xml => xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
const textOf = p => (p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map(s => s.replace(/<[^>]+>/g, '')).join('')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const isHeading = p => /<w:pStyle w:val="Heading1"/.test(p);
const HEADING = /^terms and conditions$/i;
const SUB1 = 'Product-Specific Terms & Conditions';
const SUB2 = 'Common Terms & Conditions';
const esc = s => s.replace(/&/g, '&amp;');
const para = (text, pPr = '', rPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
// the author's own look of the loop lines (checked in the output): title left + bold, terms justified with an indent
const TITLE_PPR = '<w:spacing w:before="200" w:after="40"/><w:jc w:val="left"/>';
const TERMS_PPR = '<w:spacing w:after="80"/><w:ind w:left="351"/><w:jc w:val="both"/>';

// the base template with its own terms tag taken out, and the given paragraphs directly under the Terms and Conditions heading
function variant(kind, { titleStyle = '' } = {}) {
  const zip = new PizZip(BASE);
  let xml = zip.file('word/document.xml').asText();
  paras(xml).filter(p => /\{@productTermsXml\}/.test(textOf(p))).forEach(p => { xml = xml.replace(p, ''); });
  const h = paras(xml).find(p => isHeading(p) && HEADING.test(textOf(p).trim()));
  assert(h, 'base template has no Terms and Conditions heading');
  const body = {
    none: '',
    legacy: para('{@productTermsXml}'),
    loop: para(SUB1, '<w:spacing w:before="120"/>', '<w:b/>') + para('{#productTerms}')
      + para('{number}. {name}', (titleStyle ? `<w:pStyle w:val="${titleStyle}"/>` : '') + TITLE_PPR, '<w:b/>')
      + para('{terms}', TERMS_PPR) + para('{/productTerms}') + para(SUB2, '<w:spacing w:before="120"/>', '<w:b/>'),
  }[kind];
  const at = xml.indexOf(h) + h.length;
  zip.file('word/document.xml', xml.slice(0, at) + body + xml.slice(at));
  return zip.generate({ type: 'nodebuffer' });
}

function register(buffer) {
  return store.addTagged({ buffer, filename: 'terms-test.docx', uploadedBy: 'test', tags: extractTags(buffer).tags });
}

async function fieldsFor(ids) {
  const g = await draft.generate({ business: { name: 'TEST COMPANY (PVT) LTD', address: 'No 1, Test Road, Colombo 03, Sri Lanka' }, productIds: ids, user: { email: 'terms-test@example.com' } });
  g.fields.investment = ids.map(id => ({ description: `INV-${id}`, bandwidth: '10 Mbps', qosTemplate: '', oneTimeCharge: '1000', monthlyRental: '2000' }));
  return g.fields;
}

// paragraphs between the T&C heading and the next heading
function termsPage(buffer) {
  const ps = paras(new PizZip(buffer).file('word/document.xml').asText());
  const h = ps.findIndex(p => isHeading(p) && HEADING.test(textOf(p).trim()));
  assert(h !== -1, 'rendered document lost the Terms and Conditions heading');
  const out = [];
  for (let i = h + 1; i < ps.length && !isHeading(ps[i]); i += 1) out.push({ text: textOf(ps[i]).trim(), xml: ps[i] });
  return out;
}

const GENERIC_FIRST = 'All prices are valid for 30 days';
// the texts above the common terms; empty paragraphs right above them are the template's own spacer, not generated
const above = page => {
  const at = page.findIndex(p => p.text.startsWith(GENERIC_FIRST));
  assert(at !== -1, 'common (generic) terms missing');
  const t = page.slice(0, at);
  while (t.length && !t[t.length - 1].text) t.pop();
  return t;
};
const squash = s => s.replace(/\s+/g, '');
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, true]); console.log('  ok   ', name); } catch (err) { results.push([name, false]); console.log('  FAIL ', name, '\n        ', err.message.split('\n')[0], err.problems ? JSON.stringify(err.problems) : ''); }
}
// per PDF page: the body text (the page header / footer / page number strip is left out)
async function pageTexts(buffer) {
  const pdf = await docxToPdf(buffer);
  const tmp = path.join(TMP, `page-check-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, pdf);
  const r = require('child_process').spawnSync(process.execPath, [__filename, '--pdf', tmp], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('JSON:'));
  if (!line) throw new Error('PDF check failed: ' + (r.stderr || '').slice(0, 300));
  return JSON.parse(line.slice(5));
}

(async () => {
  console.log('isolated copy:', COPY, '\ndata folder  :', DATA, '\n');

  console.log('Row building (termsService)');
  await check('one paragraph per product; arrays joined; empty / missing -> ""', () => {
    assert.strictEqual(terms.termsOf(PRODUCTS[0]), T1);
    assert.strictEqual(terms.termsOf(PRODUCTS[3]), 'Gamma item one. Gamma item two. Gamma item three.');
    assert.strictEqual(terms.termsOf(PRODUCTS[2]), '');
    assert.strictEqual(terms.termsOf(PRODUCTS[5]), '');
  });
  await check('rows keep every product in order, with no merging of identical terms', () => {
    const rows = terms.termsRows([PRODUCTS[0], PRODUCTS[1], PRODUCTS[2]]);
    assert.deepStrictEqual(rows.map(r => [r.id, r.terms]), [['p1', T1], ['p2', T1], ['p3', '']]);
  });
  await check('(older block form) sentence items and duplicates', () => {
    assert.deepStrictEqual(terms.splitItems(T1), ['Alpha clause one applies.', 'Alpha clause two applies to every site.', 'Charges may change.']);
    assert.deepStrictEqual(terms.dedupe(terms.splitItems(`${T1} ${T1}`)), terms.splitItems(T1));
  });

  console.log('\nTemplate versions');
  const loopV = register(variant('loop'));
  const noneV = register(variant('none'));
  const legacyV = register(variant('legacy'));
  await check('the loop is bound to the product rows (number computed, name, terms)', () => {
    const b = loopV.bindings.productTerms;
    assert(b && b.kind === 'loop' && b.field === 'productTerms', 'loop not bound');
    assert.deepStrictEqual(b.columns, { number: 'number', name: 'name', terms: 'terms' });
  });
  await check('the mapper is never asked for either terms tag', () => assert(!slots().some(s => /^productTerms/.test(s.key))));
  await check('no tag in the template: none is invented', () => assert(!noneV.tags.some(t => /^productTerms/.test(t.name))));
  await check('(older tag) bullet format still read from the template\'s own list and stored', () => {
    assert(legacyV.formats.terms && /<w:numPr>/.test(legacyV.formats.terms.pPr));
    assert.deepStrictEqual(legacyV.formats.terms, captureFormats(variant('none')).terms);
    assert.deepStrictEqual(loopV.formats.terms, legacyV.formats.terms, 'sub-headings / loop lines must not become the bullet sample');
  });

  console.log('\nRendering');
  const file = id => store.readFile(id);
  const idsOf = c => c.ids.filter(id => termsOf(id));
  const cases = [
    { name: '1 product with terms', ids: ['p1'] },
    { name: '2 products sharing the same terms (both print)', ids: ['p1', 'p2'] },
    { name: '4 products: terms, same terms, none, array', ids: ['p1', 'p2', 'p3', 'p4'] },
    { name: '4 products: missing field first, then 3 with terms', ids: ['p6', 'p5', 'p1', 'p4'] },
    { name: '1 product without terms', ids: ['p3'] },
    { name: '2 products, none with terms', ids: ['p3', 'p6'] },
    { name: '2 products with long terms (across pages)', ids: ['p7', 'p8'] },
    { name: '4 products: long, short, none, long', ids: ['p7', 'p5', 'p3', 'p8'] },
  ];
  const docs = {};
  for (const c of cases) {
    await check(c.name, async () => {
      const fields = await fieldsFor(c.ids);
      const out = await render.fillTemplate(file(loopV.id), store.get(loopV.id), fields);
      docs[c.name] = out;
      const page = termsPage(out);
      const printed = above(page).map(p => p.text);
      assert(printed.every(t => t), 'an empty paragraph among the generated lines');
      const want = [SUB1, ...idsOf(c).flatMap((id, i) => [`${i + 1}. ${PRODUCTS.find(p => p.id === id).name}`, termsOf(id)]), SUB2];
      try { assert.deepStrictEqual(printed, want); } catch (e) { console.log('GOT ', JSON.stringify(printed).slice(0, 700), '| WANT', JSON.stringify(want).slice(0, 400)); throw new Error('sub-heading, each product title + its terms in order, sub-heading, then the common terms'); }
      // the author's own formatting is what each line carries
      idsOf(c).forEach((id, i) => {
        assert(page[1 + 2 * i].xml.includes('w:val="left"') && page[1 + 2 * i].xml.includes('<w:b/>'), `title ${i + 1} lost the template's style`);
        assert(page[2 + 2 * i].xml.includes('w:left="351"') && page[2 + 2 * i].xml.includes('w:val="both"'), `terms ${i + 1} lost the template's style`);
        assert(!/<w:pStyle w:val="Heading/.test(page[1 + 2 * i].xml), 'a title uses a heading style');
      });
      const xml = new PizZip(out).file('word/document.xml').asText();
      assert(!/\{[#/@]?(productTerms|number|name|terms)\w*\}/.test(xml), 'tag text left in the document');
      c.ids.forEach(id => assert(xml.includes(`INV-${id}`), `investment row INV-${id} missing`));
    });
  }

  await check('no product has terms: the sub-headings stay (template text), no title and no empty paragraph', async () => {
    const out = await render.fillTemplate(file(loopV.id), store.get(loopV.id), await fieldsFor(['p3', 'p6']));
    assert.deepStrictEqual(above(termsPage(out)).map(p => p.text), [SUB1, SUB2]);
  });
  await check('edited terms print per proposal; a cleared box skips that product and the numbering closes up', async () => {
    const fields = await fieldsFor(['p1', 'p4', 'p5']);
    fields.productTerms[0].terms = 'Custom terms for one.';
    fields.productTerms[1].terms = '   ';
    const out = await render.fillTemplate(file(loopV.id), store.get(loopV.id), fields);
    assert.deepStrictEqual(termsPage(out).slice(0, 6).map(p => p.text), [SUB1, '1. Product One', 'Custom terms for one.', '2. Product Five', 'Delta clause only.', SUB2]);
  });
  await check('a proposal saved without product terms falls back to the products\' terms', async () => {
    const fields = await fieldsFor(['p5', 'p3', 'p1']);
    delete fields.productTerms;
    const out = await render.fillTemplate(file(loopV.id), store.get(loopV.id), fields);
    assert.deepStrictEqual(termsPage(out).slice(0, 6).map(p => p.text), [SUB1, '1. Product Five', 'Delta clause only.', '2. Product One', T1, SUB2]);
  });
  await check('a template with neither tag prints no product terms', async () => {
    const out = await render.fillTemplate(file(noneV.id), store.get(noneV.id), await fieldsFor(['p1', 'p4']));
    assert.deepStrictEqual(above(termsPage(out)), []);
    assert(!new PizZip(out).file('word/document.xml').asText().includes('Alpha clause'));
  });
  await check('(older tag) {@productTermsXml} still prints bullets above the common terms, duplicates removed', async () => {
    const out = await render.fillTemplate(file(legacyV.id), store.get(legacyV.id), await fieldsFor(['p1', 'p2', 'p3', 'p4']));
    const page = above(termsPage(out));
    assert.deepStrictEqual(page.map(p => p.text), ['Alpha clause one applies.', 'Alpha clause two applies to every site.', 'Charges may change.', 'Gamma item one.', 'Gamma item two.', 'Gamma item three.']);
    assert(page.every(p => p.xml.includes(legacyV.formats.terms.pPr)), 'bullets lost the template\'s list format');
  });

  console.log('\nOne-click upload');
  await check('upload with the loop: kept and bound; a heading style on its lines is removed; title kept with its text', async () => {
    const r = await drafts.uploadAndActivate({ buffer: variant('loop', { titleStyle: 'Heading1' }), filename: 'loop-heading.docx', uploadedBy: 'test' });
    const t = store.get(r.template.id);
    assert(t.isActive && t.tags.some(x => x.name === 'productTerms' && x.type === 'loop'), 'loop lost by the upload');
    assert.strictEqual(t.bindings.productTerms.kind, 'loop');
    assert(r.template.changes.termsLoop && r.template.changes.termsLoop.headingStyleRemoved === 1, 'heading style not reported as removed');
    assert(!askedSlots.includes('productTerms') && !askedSlots.includes('productTermsXml'));
    const out = await render.fillTemplate(store.readFile(t.id), t, await fieldsFor(['p1', 'p4']));
    const page = termsPage(out); // termsPage stops at the next Heading1: the title lines must not have ended it
    assert.deepStrictEqual(page.slice(0, 6).map(p => p.text), [SUB1, '1. Product One', T1, '2. Product Four', terms.termsOf(PRODUCTS[3]), SUB2]);
    assert(page.slice(0, 6).filter(p => /<w:pStyle w:val="Heading/.test(p.xml)).length === 0);
    assert(/<w:keepNext\/>/.test(page[1].xml), 'title not kept with its text');
    const toc = new PizZip(out).file('word/document.xml').asText();
    assert(!/<w:pStyle w:val="Heading1"\/>(?:(?!<\/w:p>)[\s\S])*1\. Product One/.test(toc), 'a product title is a heading');
  });
  await check('upload with neither tag: succeeds, nothing is invented', async () => {
    const r = await drafts.uploadAndActivate({ buffer: variant('none'), filename: 'none.docx', uploadedBy: 'test' });
    assert(r.template.isActive && !r.template.tags.some(t => /^productTerms/.test(t.name)));
    assert(!askedSlots.some(k => /^productTerms/.test(k)));
    assert(!new PizZip(store.readFile(r.template.id)).file('word/document.xml').asText().includes('productTerms'));
  });
  await check('upload with the older tag: kept and bound', async () => {
    const r = await drafts.uploadAndActivate({ buffer: variant('legacy'), filename: 'legacy.docx', uploadedBy: 'test' });
    const t = store.get(r.template.id);
    assert(t.tags.some(x => x.name === 'productTermsXml') && t.bindings.productTermsXml.how === 'terms' && t.formats.terms);
  });

  console.log('\nPages (converted with Word / LibreOffice)');
  let converter = true;
  try { await pageTexts(docs[cases[0].name]); } catch (err) { converter = false; console.log('  SKIP  no PDF converter available here:', err.message.split('\n')[0]); }
  if (converter) {
    const base = (await pageTexts(await render.fillTemplate(file(noneV.id), store.get(noneV.id), await fieldsFor(['p3'])))).length;
    console.log(`  (pages of the template without product terms: ${base})`);
    for (const c of cases) {
      await check(`${c.name}: no blank page, titles + terms in order above the common terms`, async () => {
        const p = await pageTexts(docs[c.name]);
        const blank = p.map((pg, i) => (pg.items < 2 && pg.images === 0 ? i + 1 : 0)).filter(Boolean);
        assert(blank.length === 0, `blank page(s) ${blank}`);
        const all = squash(p.map(pg => pg.text).join(''));
        const common = all.indexOf(squash(GENERIC_FIRST));
        assert(common !== -1, 'common terms not in the PDF');
        let last = -1;
        idsOf(c).forEach((id, i) => {
          const title = all.indexOf(squash(`${i + 1}. ${PRODUCTS.find(x => x.id === id).name}`), last + 1);
          assert(title !== -1 && title > last, `title ${i + 1} out of order / missing`);
          const end = all.indexOf(squash(termsOf(id).slice(-40)), title);
          assert(end !== -1 && end < common, `terms of ${id} not complete above the common terms`);
          last = end;
        });
        console.log(`        pages: ${p.length}`);
      });
    }
  }

  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
}
