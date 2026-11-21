const { BY_KEY, BLOCK_SLOTS } = require('./fieldSchema');
const { columnSynonyms } = require('./renderSettings');

// Template tag -> schema field(s). A binding says where the value of a {tag} comes from when the template is filled.
//   { kind: 'field',   field }                 the tag shows one schema field
//   { kind: 'compose', how, fields }           the tag is built from several fields (see renderService.composeValue)
//   { kind: 'loop',    field, columns }        a {#table} loop over a table field; columns = { tagColumn: fieldColumn }
//   { kind: 'diagrams' }                       the product pictures, inserted as raw XML (the client logo is not a tag: see services/logoService.js)
//   { kind: 'none' }                           deliberately left empty
// A tag with no binding is also left empty.
//
// Auto-binding covers (1) tags named exactly like a schema field and (2) tags named like a composed slot (letterXml,
// requirementsXml, aboutXml, address, diagramsXml). Everything else is left unbound for the admin to bind (review screen).

// Composed / image slots (fieldSchema.BLOCK_SLOTS): a tag named like the slot is bound to it
const COMPOSED = Object.fromEntries(BLOCK_SLOTS.map(b => [b.key, b.kind === 'image'
  ? { kind: b.binding }
  : { kind: 'compose', how: b.how, fields: b.fields }]));

// Table of contents page numbers are not filled in (left empty on purpose)
const NONE_PATTERN = /^toc\d+$/;

function bindLoop(tag, field) {
  const known = new Set((field.columns || []).map(c => c.key));
  const columns = {};
  (tag.children || []).forEach(c => {
    const synonyms = columnSynonyms.filter(g => g.includes(c.name)).flat();
    const target = known.has(c.name) ? c.name : synonyms.find(n => known.has(n));
    if (target) columns[c.name] = target;
  });
  return { kind: 'loop', field: field.key, columns };
}

// tags: the tag list of a template version. Returns { tagName: { ...binding, auto: true } } for the tags that could be bound.
function autoBind(tags) {
  const out = {};
  (tags || []).forEach(tag => {
    let binding = null;
    if (COMPOSED[tag.name]) binding = { ...COMPOSED[tag.name] };
    else if (NONE_PATTERN.test(tag.name)) binding = { kind: 'none' };
    else if (BY_KEY[tag.name]) {
      const field = BY_KEY[tag.name];
      if (field.type === 'table' && tag.type === 'loop') binding = bindLoop(tag, field);
      else if (field.type === 'image') binding = field.source === 'diagrams' ? { kind: 'diagrams' } : null;
      else if (field.type !== 'table' && tag.type !== 'loop') binding = { kind: 'field', field: field.key };
    }
    if (binding) out[tag.name] = { ...binding, auto: true };
  });
  return out;
}

module.exports = { autoBind };
