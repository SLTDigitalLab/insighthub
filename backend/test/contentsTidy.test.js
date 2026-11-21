process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Table of contents tidy-up of generated proposals (services/contentsTidyService.js): one TOC field stays one, none stays none, and a heading
// with no text is not a contents entry. The real active templates are read from backend/data (read-only); a type with none is skipped.
//   node test/contentsTidy.test.js
const assert = require('assert');
const PizZip = require('pizzip');
const { tidyContents } = require('../services/contentsTidyService');
const { buildOutline } = require('../services/templateOutlineService');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;
const docx = body => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
};
const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const fld = (type) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const instr = '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>';
const tocEntries = (...titles) => titles.map((t, i) => `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>${i === 0 ? fld('begin') + instr + fld('separate') : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`).join('') + `<w:p>${fld('end')}</w:p>`;
const read = buf => new PizZip(buf).file('word/document.xml').asText();
const tocCount = buf => buildOutline(buf).fields.filter(f => f.kind === 'TOC').length;

(async () => {
  console.log('Rules');
  await ok('a document with ONE table of contents keeps exactly one (and no TOC is added)', () => {
    const buf = docx(p('Contents') + tocEntries('A', 'B') + p('A', 'Heading1') + p('B', 'Heading1'));
    assert.strictEqual(tocCount(buf), 1);
    const out = tidyContents(buf);
    assert.strictEqual(out.changed, false);
    assert.strictEqual(tocCount(out.buffer), 1);
  });
  await ok('a document with NO table of contents gets none', () => {
    const buf = docx(p('A', 'Heading1') + p('text'));
    assert.strictEqual(tocCount(tidyContents(buf).buffer), 0);
  });
  await ok('two TOC fields, one inside the other: one is left, with its entries', () => {
    const inner = tocEntries('A', 'B');
    const buf = docx(`<w:p>${fld('begin')}${instr}${fld('separate')}</w:p>` + inner + `<w:p>${fld('end')}</w:p>` + p('A', 'Heading1') + p('B', 'Heading1'));
    assert.strictEqual(tocCount(buf), 2);
    const out = tidyContents(buf);
    assert.strictEqual(out.changed, true);
    assert.strictEqual(tocCount(out.buffer), 1);
    assert.ok(/>A</.test(read(out.buffer)) && /TOC1/.test(read(out.buffer)));
  });
  await ok('an empty TOC field next to the real one is removed', () => {
    const buf = docx(`<w:p>${fld('begin')}${instr}${fld('separate')}${fld('end')}</w:p>` + tocEntries('A') + p('A', 'Heading1'));
    assert.strictEqual(tocCount(buf), 2);
    assert.strictEqual(tocCount(tidyContents(buf).buffer), 1);
  });
  await ok('a heading with no text (or only a picture) becomes body text for the contents; real headings are not touched', () => {
    const picture = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:drawing/></w:r></w:p>';
    const buf = docx(p('Real heading', 'Heading1') + p('', 'Heading1') + picture + p('Another', 'Heading1'));
    const xml = read(tidyContents(buf).buffer);
    const paras = xml.match(/<w:p>[\s\S]*?<\/w:p>/g);
    assert.ok(!/outlineLvl/.test(paras[0]) && !/outlineLvl/.test(paras[3]), 'headings with text are unchanged');
    assert.ok(/<w:outlineLvl w:val="9"\/>/.test(paras[1]) && /<w:outlineLvl w:val="9"\/>/.test(paras[2]), 'empty ones are body text');
    assert.ok(/Heading1/.test(paras[1]) && /w:drawing/.test(paras[2]), 'style and picture stay');
  });
  await ok('a broken document is returned as it was (never throws)', () => {
    const junk = Buffer.from('not a docx');
    assert.strictEqual(tidyContents(junk).buffer, junk);
  });

  console.log('Real templates, generated');
  const store = require('../services/templateStoreService');
  const prod = require('../services/renderService');
  const sol = require('../services/solutionRenderService');
  const ps = require('../services/productSolutionRenderService');
  for (const [type, svc] of [['product', prod], ['solution', sol], ['productSolution', ps]]) {
    await ok(`${type}: the generated document has one table of contents and no blank heading entry`, async () => {
      const a = store.getActive(type);
      if (!a) return console.log(`      (no active ${type} template here: skipped)`);
      const fields = {};
      (a.tags || []).forEach(t => { if (t.type === 'text') fields[t.name] = 'Sample'; });
      fields.companyName = 'Mr. H.M. Mahinda'; fields.refNo = 'SLTM-';
      const r = type === 'product' ? await svc.render({ templateId: a.id, fields, format: 'docx' }) : await svc.render({ templateId: a.id, fields, companyName: 'Mr. H.M. Mahinda', format: 'docx', refNo: 'SLTM-' });
      assert.strictEqual(tocCount(r.buffer), 1, 'one TOC field');
      const empty = buildOutline(r.buffer).paragraphs.filter(x => x.outlineLevel !== undefined && x.outlineLevel < 9 && !x.text.trim());
      assert.strictEqual(empty.length, 0, `no heading without text is left (found ${empty.length})`);
    });
  }

  console.log(`\n${passed} passed`);
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})().catch(e => { console.error(e); process.exit(1); });
