process.env.PROPOSAL_UPDATE_CONTENTS = '0'; // tests do not start Word to rebuild the contents
// Placeholder colour fallback (services/placeholderColourService.js) and the three real render paths.
//   node test/placeholderColour.test.js
const assert = require('assert');

// The real-template part reads the templates that are active in backend/data (read-only: nothing is saved); a type with no template is skipped.

const PizZip = require('pizzip');
const { recolourPlaceholders } = require('../services/placeholderColourService');

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok  ${name}`); }).catch(e => { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });

const run = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const colourOfRun = (xml, text) => {
  const m = new RegExp(`<w:r>(?:(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>))?<w:t xml:space="preserve">${text.replace(/[{}]/g, '\\$&')}</w:t></w:r>`).exec(xml);
  assert.ok(m, `run "${text}" exists in ${xml}`);
  const c = /<w:color [^>]*\/>/.exec(m[1] || '');
  return c ? c[0] : '';
};
const BLUE = '<w:color w:val="74B5E3"/>';
const RED = '<w:color w:val="FF0000"/>';

(async () => {
  console.log('Rule by rule');
  await ok('a red placeholder takes the colour of the nearest label; blank runs between them are skipped; size / scaling / spacing stay', () => {
    const xml = para(run('Proposal Ref. No. ', `${BLUE}<w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="32"/>`), run('   ', '<w:color w:val="124162"/>'), run('{refNo}', `${RED}<w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="32"/>`));
    const out = recolourPlaceholders(xml);
    assert.strictEqual(colourOfRun(out, '{refNo}'), BLUE);
    assert.ok(out.includes(`${BLUE}<w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">{refNo}`), 'only the colour changed');
  });
  await ok('the blue-grey blank runs before the value are never used as the reference', () => {
    const xml = para(run('          ', '<w:color w:val="124162"/>'), run('{companyName}', RED), run('Proposal Ref. No. ', BLUE));
    assert.strictEqual(colourOfRun(recolourPlaceholders(xml), '{companyName}'), BLUE);
  });
  await ok('a placeholder with no colour (no rPr, empty rPr, or rPr without colour) gets the label colour; schema order is kept', () => {
    for (const rPr of ['', '<w:b/>', '<w:b/><w:sz w:val="28"/>']) {
      const out = recolourPlaceholders(para(run('Label ', BLUE), run('{x}', rPr)));
      assert.strictEqual(colourOfRun(out, '{x}'), BLUE);
      assert.ok(!rPr || out.includes(`<w:rPr>${rPr.replace('<w:sz', `${BLUE}<w:sz`).replace(/^<w:b\/>$/, `<w:b/>${BLUE}`)}</w:rPr>`), `colour sits before w:sz / after w:b: ${out}`);
    }
    assert.strictEqual(colourOfRun(recolourPlaceholders(para(run('Label ', BLUE), '<w:r><w:rPr/><w:t>{x}</w:t></w:r>')).replace('<w:t>{x}', '<w:t xml:space="preserve">{x}'), '{x}'), BLUE);
  });
  await ok('theme attributes are copied together with the colour', () => {
    const themed = '<w:color w:val="2E74B5" w:themeColor="accent1" w:themeShade="BF"/>';
    assert.strictEqual(colourOfRun(recolourPlaceholders(para(run('Label ', themed), run('{x}', RED))), '{x}'), themed);
  });
  await ok('a reference run with no colour removes the placeholder\'s red (it inherits the paragraph / style colour); the rest stays', () => {
    const out = recolourPlaceholders(para(run('Sentence ', '<w:sz w:val="20"/>'), run('{x}', `<w:b/>${RED}<w:sz w:val="20"/>`)));
    assert.strictEqual(colourOfRun(out, '{x}'), '');
    assert.ok(out.includes('<w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">{x}'));
  });
  await ok('another, deliberate colour is left alone', () => {
    const green = '<w:color w:val="00B050"/>';
    assert.strictEqual(colourOfRun(recolourPlaceholders(para(run('Label ', BLUE), run('{x}', green))), '{x}'), green);
  });
  await ok('red = R high, G and B low (C00000 too); 124162 / blue are not red', () => {
    assert.strictEqual(colourOfRun(recolourPlaceholders(para(run('L ', BLUE), run('{x}', '<w:color w:val="C00000"/>'))), '{x}'), BLUE);
    const dark = '<w:color w:val="124162"/>';
    assert.strictEqual(colourOfRun(recolourPlaceholders(para(run('L ', BLUE), run('{x}', dark))), '{x}'), dark);
  });
  await ok('alone on its line: a red placeholder uses the last label run of the paragraph above; a colourless one is left alone', () => {
    const xml = para(run('First ', '<w:color w:val="111111"/>'), run('Heading ', BLUE)) + para(run('{a}', RED)) + para(run('{b}'));
    const out = recolourPlaceholders(xml);
    assert.strictEqual(colourOfRun(out, '{a}'), BLUE);
    assert.strictEqual(colourOfRun(out, '{b}'), '', 'a table cell / plain line is not recoloured by a heading above it');
  });
  await ok('control tags ({#loop}, {/loop}, {@raw}) and plain text are never touched; tags and text are unchanged', () => {
    const xml = para(run('Label ', BLUE), run('{#rows}', RED), run('{@raw}', RED), run('{/rows}', RED)) + para(run('plain', RED));
    assert.strictEqual(recolourPlaceholders(xml), xml);
  });

  await ok('a tag Word split over several runs, and a header whose paragraph holds a text box, are recoloured too', () => {
    const NAVY = '<w:color w:val="002060"/>';
    const split = para(run('Proposal Ref. ', NAVY), run('{ref', RED), run('No}', RED), run(' ', NAVY));
    const out = recolourPlaceholders(split);
    assert.strictEqual(colourOfRun(out, '{ref'), NAVY);
    assert.strictEqual(colourOfRun(out, 'No}'), NAVY);
    // the paragraph holds a nested paragraph (text box) before its own runs, like the page header of the templates
    const nested = '<w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>' + run('Proposal Ref. ', NAVY) + run('{refNo}', RED) + '</w:p>';
    assert.strictEqual(colourOfRun(recolourPlaceholders(nested), '{refNo}'), NAVY);
  });

  console.log('Real templates, filled (Product, Solution, Product + Solution, admin "SLTM-")');
  const store = require('../services/templateStoreService');
  const prod = require('../services/renderService');
  const sol = require('../services/solutionRenderService');
  const ps = require('../services/productSolutionRenderService');
  const NAME = 'Mr. H.M. Mahinda';
  const cases = [['product', prod, 'SLTM-REBM-WPE-12345678'], ['solution', sol, 'SLTM-REBM-WPE-2026-0451'], ['productSolution', ps, 'SLTM-REBM-WPE-SP2026-0451'], ['productSolution', ps, 'SLTM-']];
  for (const [type, svc, ref] of cases) {
    await ok(`${type} with "${ref}": cover name and reference are the label's light blue; nothing is FF0000`, async () => {
      const a = store.getActive(type);
      if (!a) return console.log(`      (no active ${type} template here: skipped)`);
      const fields = {};
      (a.tags || []).forEach(t => { if (t.type === 'text') fields[t.name] = 'x'; });
      fields.companyName = NAME; fields.refNo = ref;
      const r = type === 'product' ? await svc.render({ templateId: a.id, fields, format: 'docx' }) : await svc.render({ templateId: a.id, fields, companyName: NAME, format: 'docx', refNo: ref });
      const xml = new PizZip(r.buffer).file('word/document.xml').asText();
      const runs = xml.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
      const colourOf = r2 => (/<w:color w:val="([0-9A-Fa-f]{6})"/.exec(r2) || [])[1] || '';
      const label = runs.find(x => /Proposal Ref\. No\./.test(x));
      assert.strictEqual(colourOf(label), '74B5E3');
      const cover = runs.filter(x => { const t = (/<w:t[^>]*>([^<]*)<\/w:t>/.exec(x) || [])[1]; return (t === NAME || t === ref) && /<w:w w:val="(?:90|75)"/.test(x); });
      assert.strictEqual(cover.length, 2, 'cover name and reference runs found');
      cover.forEach(x => assert.strictEqual(colourOf(x), '74B5E3'));
      const valueRuns = runs.filter(x => { const t = (/<w:t[^>]*>([^<]*)<\/w:t>/.exec(x) || [])[1]; return t === NAME || t === ref; });
      valueRuns.forEach(x => assert.notStrictEqual(colourOf(x).toUpperCase(), 'FF0000'));
      assert.ok(!valueRuns.some(x => colourOf(x) === '124162'));
      assert.ok(xml.includes(NAME) && xml.includes(ref), 'text still filled');
    });
  }

  console.log(`\n${passed} passed`);
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})().catch(e => { console.error(e); process.exit(1); });
