// Runs the REAL n8n solution agent on every sheet of a quotation workbook and prints, per sheet, the returned values,
// the missing tags and the price warnings. Needs the "Solution Proposal Agent" workflow to be published in n8n.
//   node test/solutionAgent.run.js [path-to-quotation.xlsx] [path-to-solution-template.docx]
// Webhook: N8N_SOLUTION_WEBHOOK_URL (or N8N_WEBHOOK_BASE + /proposal-solution). Nothing in backend/data is changed:
// a temporary data folder is used and no proposal is saved.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solution-agent-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch { /* dotenv is optional */ }

const grids = require('../services/xlsxGridService');
const schemaSvc = require('../services/solutionSchemaService');
const { extractTags } = require('../services/templateTagService');
const solution = require('../services/solutionService');
const { colomboDate } = require('../services/draftService');
const { build } = require('./solutionTestTemplate');

const xlsxPath = process.argv[2] || path.join(__dirname, '..', '..', '..', 'Total Quotations For Smart Board.xlsx');
const templatePath = process.argv[3];

(async () => {
  const template = templatePath ? fs.readFileSync(templatePath) : build();
  const tags = extractTags(template).tags;
  const schema = schemaSvc.buildSchema(tags);
  const book = fs.readFileSync(xlsxPath);
  const rep = { name: 'Test Account Manager', phone: '0112000000', email: 'test.am@example.com', designation: '' };
  console.log(`Agent: ${solution.AGENT_URL}\nTemplate tags: ${schema.map(t => `${t.name}${t.type === 'loop' ? `[${t.children.map(c => c.name).join(',')}]` : ''}`).join(', ')}\n`);

  const summary = [];
  for (const sheet of grids.listSheets(book)) {
    const grid = grids.buildGrid(book, sheet.name);
    console.log(`==== Sheet "${sheet.name}" (${grid.cells.length} cells, ${grid.rows} rows x ${grid.cols} cols) ====`);
    try {
      const t0 = Date.now();
      const r = await solution.runAgent({ grid, schema, rep, refNo: 'TEST-00000000', today: colomboDate() });
      console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      console.log(JSON.stringify({ values: r.values, meta: r.meta }, null, 2));
      console.log('missing:', JSON.stringify(r.missing));
      console.log('price warnings:', JSON.stringify(r.warnings, null, 2));
      summary.push({ sheet: sheet.name, ok: true, missing: r.missing, warnings: r.warnings.length });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      summary.push({ sheet: sheet.name, ok: false, error: err.message });
    }
    console.log('');
  }

  console.log('==== SUMMARY ====');
  summary.forEach(s => console.log(s.ok
    ? `${s.sheet}: missing=[${s.missing.join(', ')}] priceWarnings=${s.warnings}`
    : `${s.sheet}: FAILED - ${s.error}`));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
