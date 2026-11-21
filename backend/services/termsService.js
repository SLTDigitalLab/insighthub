const { terms } = require('../proposal/renderSettings');

// Product terms and conditions -> bullet items. Nothing here names a product or contains terms text: the text comes from
// each selected product's `termsAndConditions` (a string, or an array of strings, or empty).

const SENTENCE_SPLIT = new RegExp(terms.sentenceSplit);
const BULLET_PREFIX = new RegExp(terms.bulletPrefix);

// string | array | anything -> trimmed items, one per sentence / line
function splitItems(value) {
  const parts = Array.isArray(value) ? value : [value];
  return parts.flatMap(part => (typeof part === 'string' ? part : '').replace(/\r\n?/g, '\n').split('\n'))
    .flatMap(line => line.replace(BULLET_PREFIX, '').trim().split(SENTENCE_SPLIT))
    .map(s => s.replace(BULLET_PREFIX, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const words = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  a.forEach(w => { if (b.has(w)) both += 1; });
  return both / (a.size + b.size - both);
}

// Removes exact and near duplicates, keeping the first one (so the order of the products is kept)
function dedupe(items) {
  const kept = [];
  items.forEach(item => {
    const w = words(item);
    if (!w.length) return;
    const set = new Set(w);
    const key = w.join(' ');
    if (kept.some(k => k.key === key || similarity(k.set, set) >= terms.nearDuplicate)) return;
    kept.push({ item, key, set });
  });
  return kept.map(k => k.item);
}

// One product's terms as a single paragraph (an array is joined with spaces); '' when it has none
const termsOf = product => {
  const v = product && product.termsAndConditions;
  return (Array.isArray(v) ? v.filter(s => typeof s === 'string').join(' ') : (typeof v === 'string' ? v : '')).replace(/\s+/g, ' ').trim();
};

// The rows of the productTerms field for the selected products (in order); also the fallback for a proposal saved without them
const termsRows = products => (products || []).filter(Boolean).map(p => ({ id: p.id, name: String(p.name == null ? '' : p.name).trim(), terms: termsOf(p) }));

// products: catalogue entries in the order they were selected. [] when none of them has terms.
const termsItems = products => dedupe((products || []).flatMap(p => splitItems(p && p.termsAndConditions)));

// the edit screen keeps the terms as text, one bullet per line
const termsText = products => termsItems(products).join('\n');
// (each line stays one bullet, even when the rep wrote more than one sentence in it)
const textItems = text => dedupe(String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(BULLET_PREFIX, '').replace(/\s+/g, ' ').trim()).filter(Boolean));

module.exports = { splitItems, dedupe, termsItems, termsText, textItems, termsOf, termsRows };
