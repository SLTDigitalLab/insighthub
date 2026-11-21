const PizZip = require('pizzip');
const store = require('./templateStoreService');
const { extractTags } = require('./templateTagService');
const { buildSchema } = require('./solutionSchemaService');
const { fill } = require('./solutionRenderService');

// Upload of a SOLUTION template: the author has already written the {tags} in the .docx; they are detected here and the file is
// stored, unchanged, as the active solution template (the product template stays active). No field schema is involved.
//
// TODO (later, not built): generic red-text auto-tagging. SLT's solution template is marked with red sample text instead of
// {tags}. A later step should let the AI name tags from that red text (no fieldSchema, names chosen from the text itself),
// write them into a copy like templateTagWriter does for products, and then continue with the same checks as below.
// Until then, upload a template that already contains its {tags}.

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });

// Test values for every tag of the schema, to prove the template fills without errors and repeats its loops
const dummyRow = (children, i) => Object.fromEntries(children.map(c => [c.name, c.type === 'loop' ? [0, 1].map(j => dummyRow(c.children || [], j)) : `TEST ${c.name}${i}`]));
const dummyValues = schema => Object.fromEntries(schema.map(t => [t.name, t.type === 'loop' ? [0, 1].map(i => dummyRow(t.children || [], i)) : `TEST ${t.name}`]));

// type / original: the Product + Solution template reuses these checks (type 'productSolution', and the uploaded file kept next to its
// tagged copy). The defaults are the solution template's.
function uploadAndActivate({ buffer, filename, uploadedBy, type = 'solution', original }) {
  const report = extractTags(buffer);
  const bad = report.errors.find(e => e.kind === 'not_docx');
  if (bad) throw fail(400, bad.message);
  if (report.errors.length) throw fail(400, `The template has tag errors, so it was not saved: ${report.errors.map(e => e.message).join('; ')}`);
  if (!report.tags.length) {
    throw fail(422, 'No {tags} were found in this template, so it was not used. Write the fill-in tags into the document first, e.g. {name} for text and {#rows}{item}{/rows} for a table.');
  }
  const schema = buildSchema(report.tags);
  const empty = schema.filter(t => t.type === 'loop' && !(t.children || []).length);
  if (empty.length) throw fail(422, `The loop ${empty.map(t => `"${t.name}"`).join(', ')} has no fields inside it, so the template was not used. Put the fill-in tags between {#${empty[0].name}} and {/${empty[0].name}}.`);

  const problems = [];
  try {
    const filled = fill(buffer, report.tags, dummyValues(schema));
    const text = new PizZip(filled).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
    if (/\{[#/@^]?[A-Za-z_]\w*\}/.test(text)) problems.push('Tag text is left in the document after filling it with test values.');
    schema.filter(t => t.type === 'loop' && (t.children || []).some(c => c.type !== 'loop')).forEach(t => {
      const first = t.children.find(c => c.type !== 'loop');
      if (!text.includes(`TEST ${first.name}1`)) problems.push(`The "${t.name}" loop did not repeat its rows.`);
    });
  } catch (err) {
    problems.push(err.message);
  }
  if (problems.length) throw fail(422, 'The solution template did not pass its checks, so nothing was saved.', { problems });

  const entry = store.addTagged({ buffer, ...(original ? { original } : {}), filename, uploadedBy, tags: report.tags, type, extra: { kind: type, bindings: {} } });
  return { template: entry, schema };
}

module.exports = { uploadAndActivate };
