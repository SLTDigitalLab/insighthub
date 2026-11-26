const { BLOCK_SLOTS } = require('../proposal/fieldSchema');
const { wording } = require('../proposal/renderSettings');
const { blocksToOoxml } = require('./ooxml');

// Structured text for the template's "about" and "requirements" blocks (Product + Solution and Solution proposals).
//
// A proposal stores the block as { intro, items: [{ title, text }] }: plain text the user edits on the left of the edit screen (an
// introduction and one item per product, which can be added, removed and reordered). It is never Word XML: the XML is built from this text
// when the document is rendered, with the same numbered-item layout the Product proposal uses (ooxml.blocksToOoxml), so the user never
// sees or edits XML. A value that is still plain text (written by the AI workflow, or saved before this existed) is shown as the
// introduction and prints exactly as it did.
//
// Which tags this applies to is the Product flow's own list of composed blocks (proposal/fieldSchema BLOCK_SLOTS: the "about" and the
// "requirements" block); no template is named here.

const STRUCTURED = BLOCK_SLOTS.filter(s => s.how === 'about' || s.how === 'requirements');
const STRUCTURED_TAGS = new Set(STRUCTURED.map(s => s.key));
// 'about' (About You & How We Can Help You) or 'requirements' (Proposed Solution) for a structured tag name, else ''
const roleOf = name => { const s = STRUCTURED.find(x => x.key === name); return s ? s.how : ''; };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = v => (v == null ? '' : String(v));

// a template tag (as in the schema: { name, type }) that takes the structured editor
const isStructuredTag = tag => !!tag && tag.type === 'rawXml' && STRUCTURED_TAGS.has(tag.name);

// a stored value that is structured text (not a plain string)
const isStructured = v => isObj(v) && (Array.isArray(v.items) || 'intro' in v);

// Any value (structured, plain text, nothing) -> { intro, items: [{ title, text }] }; items with no title and no text are dropped
function normalize(value) {
  if (isStructured(value)) {
    const items = (Array.isArray(value.items) ? value.items : []).filter(isObj)
      .map(it => ({ title: clean(it.title).trim(), text: clean(it.text).trim() })).filter(it => it.title || it.text);
    return { intro: clean(value.intro).trim(), items, ...(value.removed === true ? { removed: true } : {}) };
  }
  return { intro: clean(value).trim(), items: [] };
}

// the rep pressed "Remove section" on the edit screen: the block is stored as { intro, items, removed: true }
const isRemoved = value => isObj(value) && value.removed === true;

const isEmpty = value => { const v = normalize(value); return !v.intro && !v.items.length; };

// the paragraphs of the block, as the Product flow prints them: the introduction, then "1. Title" + text for every item
function toBlocks(value) {
  const v = normalize(value);
  return [
    ...(v.intro ? [{ text: v.intro }] : []),
    ...v.items.flatMap((it, i) => [
      ...(it.title ? [{ title: wording.itemTitle(i + 1, it.title) }] : []),
      ...(it.text ? [{ text: it.text }] : []),
    ]),
  ];
}

const toXml = value => blocksToOoxml(toBlocks(value));

// plain text of the whole block (checks that read text, never printed)
const toPlainText = value => toBlocks(value).map(b => b.title || b.text).join('\n');

module.exports = { STRUCTURED_TAGS, roleOf, isStructuredTag, isStructured, isRemoved, normalize, isEmpty, toBlocks, toXml, toPlainText };
