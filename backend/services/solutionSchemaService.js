// The generic tag schema of a solution template, and the checks on what the AI returns for it.
// Nothing here names a tag, a column or a sheet label: the schema comes from the template's own tags (templateTagService).

// Rows of a loop may carry this flag for group / heading / total rows. It is not a template field: the template uses it as
// {#_group}...{/_group} / {^_group}...{/_group} around a cell's value (e.g. to print those rows bold). The only fixed name
// in the solution flow.
const GROUP_FLAG = '_group';

const structured = require('./structuredTextService');

// Fields of the user (the logged-in account manager) the agent may fill tags from
const USER_FIELDS = ['name', 'phone', 'email', 'designation', 'division'];

const clean = v => (v == null ? '' : String(v));
const asText = v => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// A {#_group}{item}{/_group}{^_group}{item}{/_group} cell reads as a loop called _group holding the real fields. This moves
// those fields up into the loop they belong to (once each, whichever of the two sections they were found in). Idempotent.
function flattenTags(tags) {
  const hoist = children => {
    const out = [];
    const seen = new Set();
    const add = c => {
      if (c.name === GROUP_FLAG) { (c.children || []).forEach(add); return; }
      if (seen.has(c.name)) return;
      seen.add(c.name);
      out.push(c.type === 'loop' ? { ...c, children: hoist(c.children || []) } : c);
    };
    (children || []).forEach(add);
    return out;
  };
  return (tags || []).filter(t => t.name !== GROUP_FLAG).map(t => (t.type === 'loop' ? { ...t, children: hoist(t.children || []) } : t));
}

// The template text around a tag, without the tag syntax itself ({#x}{y}{/x}) which only adds noise
const readable = text => clean(text).replace(/\{[#/@^!]?[A-Za-z_][\w.]*\}/g, ' ').replace(/\{[^}]*$/, ' ').replace(/^[^{]*\}/, ' ').replace(/(\s*\|\s*)+/g, ' | ').replace(/\s+/g, ' ').replace(/^[\s|]+|[\s|]+$/g, '');

const slim = tag => ({
  name: tag.name,
  type: tag.type === 'loop' ? 'loop' : (tag.type === 'rawXml' ? 'rawXml' : 'text'),
  context: readable(tag.context).slice(0, 200),
  ...(tag.section ? { section: tag.section } : {}),
  // the edit screen shows the "about" / "requirements" blocks as an introduction + items (structuredTextService.js), not as one text box
  ...(structured.isStructuredTag(tag) ? { editor: 'structured', role: structured.roleOf(tag.name) } : {}),
  ...(tag.type === 'loop' ? { children: (tag.children || []).map(slim) } : {}),
});

// tags: the tag list of a stored template version -> [{ name, type: text|rawXml|loop, context, section?, children? }]
function buildSchema(tags) {
  return flattenTags(tags).map(slim);
}

// The schema as the agent gets it: every loop carries a one-line note built from the loop's own fields (no tag names are written
// here). Whether a loop has money fields is left to the agent to judge from the field names, per loop.
function agentSchema(schema) {
  const note = tag => {
    const own = (tag.children || []).filter(c => c.type !== 'loop').map(c => c.name);
    const nested = (tag.children || []).filter(c => c.type === 'loop').map(c => c.name);
    return `fields: ${own.join(', ')}${nested.length ? `; nested list(s): ${nested.join(', ')}` : ''}. `
      + 'If none of these fields can hold an amount (a price, cost, tax or total), this loop has NO money fields: never put total or sub-total rows in it. '
      + 'If some of them hold amounts, this loop has money fields: include the table\'s total / sub-total rows as rows with the row flag. '
      + 'Never return the table\'s row of column headings as a row.';
  };
  const walk = tag => (tag.type === 'loop' ? { ...tag, note: note(tag), children: (tag.children || []).map(walk) } : tag);
  return schema.map(walk);
}

const emptyRow = children => Object.fromEntries((children || []).map(c => [c.name, c.type === 'loop' ? [] : '']));

// A well-formed value for one tag from whatever the AI (or an edit) gave. `drift`, when given, collects the keys the AI
// returned that are not fields of the template (path -> key), so prompt drift can be seen.
// strict (used on the AI's answer, not on the user's own edits): a row that holds nested loops and has nothing in any of them
// (e.g. a term heading with no lines) is dropped, unless it is a flagged group / heading row.
function cleanValue(tag, raw, path, drift, strict = false) {
  // a structured block keeps its introduction + items; plain text stays plain text
  if (tag.type !== 'loop') return structured.isStructuredTag(tag) && structured.isStructured(raw) ? structured.normalize(raw) : asText(raw);
  const rows = Array.isArray(raw) ? raw.filter(isObj) : [];
  const names = new Set((tag.children || []).map(c => c.name));
  const nested = (tag.children || []).filter(c => c.type === 'loop');
  return rows.map(row => {
    if (drift) Object.keys(row).forEach(k => { if (k !== GROUP_FLAG && !names.has(k)) drift.add(`${path}\u0000${k}`); });
    const out = {};
    (tag.children || []).forEach(c => { out[c.name] = cleanValue(c, row[c.name], `${path}.${c.name}`, drift, strict); });
    if (row[GROUP_FLAG] === true) out[GROUP_FLAG] = true;
    return out;
  }).filter(row => {
    if (row[GROUP_FLAG] === true) return true;
    if (strict && nested.length && nested.every(c => !row[c.name].length)) return false;
    return Object.entries(row).some(([k, v]) => k !== GROUP_FLAG && (Array.isArray(v) ? v.length : v.trim()));
  });
}

// Keeps only schema tags (unknown keys dropped), missing tags become "" (loops: no rows)
function sanitize(schema, values, strict = false) {
  const src = isObj(values) ? values : {};
  return Object.fromEntries(schema.map(tag => [tag.name, cleanValue(tag, src[tag.name], tag.name, null, strict)]));
}

const isEmptyValue = v => (Array.isArray(v) ? v.length === 0 : (structured.isStructured(v) ? structured.isEmpty(v) : !clean(v).trim()));

// ---- Numbers must come from the sheet ----------------------------------------------------------------------------------
// A value counts as a number only when the whole text is one (optional short currency prefix / "%" / "/=" suffix).
const NUMBER_ONLY = /^(?:[A-Za-z]{1,4}\.?\s*|[$£€₹]\s*)?([-+]?\d[\d,]*(?:\.\d+)?)\s*(%|\/[=-])?$/;
const TOKEN = /-?\d[\d,]*(?:\.\d+)?/g;

function parseNumber(text) {
  const m = NUMBER_ONLY.exec(clean(text).trim());
  if (!m) return null;
  const raw = m[1].replace(/,/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const decimals = (raw.split('.')[1] || '').length;
  return { n, decimals, percent: m[2] === '%' };
}

// All numbers that exist in the sheet: numeric cells, their displayed text, and number tokens inside text cells
function sheetNumbers(grid) {
  const nums = [];
  const add = t => { (clean(t).match(TOKEN) || []).forEach(tok => { const n = Number(tok.replace(/,/g, '')); if (Number.isFinite(n)) nums.push(n); }); };
  (grid.cells || []).forEach(c => {
    if (typeof c.value === 'number') nums.push(c.value);
    else if (typeof c.value === 'string') add(c.value);
    if (c.text) add(c.text);
  });
  return nums;
}

function numberInSheet(parsed, nums) {
  const tol = 0.5 * Math.pow(10, -parsed.decimals) + 1e-9; // "1,235" may stand for 1234.567 shown without decimals
  const near = target => nums.some(g => Math.abs(g - target) <= tol);
  return near(parsed.n) || (parsed.percent && near(parsed.n / 100));
}

// Walks the values and returns [{ kind: 'number', path, tag, row, column, value, reason }] for numbers not found in the sheet.
// allowed = free text (the user's phone, the reference number ...) whose digits may appear without being in the sheet.
function priceWarnings(schema, values, grid, allowed = []) {
  const nums = sheetNumbers(grid);
  allowed.forEach(a => (clean(a).match(TOKEN) || []).forEach(tok => nums.push(Number(tok.replace(/,/g, '')))));
  const warnings = [];
  const check = (value, path, tag, row, column) => {
    const parsed = parseNumber(value);
    if (parsed && !numberInSheet(parsed, nums)) warnings.push({ kind: 'number', path, tag, row, column, value, reason: 'This number was not found in the Excel sheet.' });
  };
  const walk = (defs, vals, prefix, tagName, row) => {
    defs.forEach(tag => {
      const v = vals[tag.name];
      const base = prefix ? `${prefix}.${tag.name}` : tag.name;
      if (tag.type === 'loop') {
        (Array.isArray(v) ? v : []).forEach((r, i) => walk(tag.children || [], r, `${base}[${i}]`, tagName || tag.name, tagName ? row : i));
      } else if (typeof v === 'string') {
        check(v, base, tagName || tag.name, row == null ? null : row, tagName ? tag.name : null);
      }
    });
  };
  walk(schema, values, '', null, null);
  return warnings;
}

// ---- A row repeated by mistake ------------------------------------------------------------------------------------------------
// The agent sometimes returns the same row twice in a row. A row is dropped when it is an exact copy (every field, normalised) of
// the row directly above it in the same loop AND the text of its first field appears in just one cell of the sheet. If the sheet
// itself holds that text twice (or the text is not found at all) both rows stay. No labels or tag names are involved.
const normText = x => clean(x).replace(/(\d),(?=\d{3}(\D|$))/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
const rowSig = row => JSON.stringify(Object.keys(row).sort().map(k => [k, k === GROUP_FLAG ? row[k] === true : (Array.isArray(row[k]) ? row[k].map(rowSig) : normText(row[k]))]));

function dropDuplicateRows(schema, values, grid) {
  const counts = new Map();
  ((grid && grid.cells) || []).forEach(c => { new Set([normText(c.value), normText(c.text)]).forEach(t => { if (t) counts.set(t, (counts.get(t) || 0) + 1); }); });
  const changes = [];
  schema.filter(t => t.type === 'loop').forEach(tag => {
    const first = (tag.children || []).find(c => c.type !== 'loop');
    const rows = Array.isArray(values[tag.name]) ? values[tag.name] : [];
    if (!first || rows.length < 2) return;
    values[tag.name] = rows.filter((row, i) => {
      const label = normText(row[first.name]);
      if (i === 0 || !label || counts.get(label) !== 1 || rowSig(row) !== rowSig(rows[i - 1])) return true;
      changes.push({ tag: tag.name, row: clean(row[first.name]).trim(), action: 'dropped duplicate row' });
      return false;
    });
  });
  return changes;
}

// ---- Rows that appear in two loops: keep them consistent ----------------------------------------------------------------------
// The same table can feed several loops (a plain item list and a priced table). The agent is unreliable about total rows and flags
// in the plain one, so after its answer:
//   money loop     = a loop in which some row has 2 or more numeric fields (not counting the first field)
//   no-money loop  = any other loop with at least two fields
// A row of a no-money loop is matched to its twin in a money loop by the text of its first field (trimmed, case-insensitive):
//   twin flagged AND with amounts (2+ numeric fields)  -> it is a total row: dropped from the no-money loop
//   twin flagged, no amounts                           -> kept, flagged like the twin (a heading)
//   twin not flagged                                   -> kept, not flagged
// No labels or tag names are involved. Returns what it changed, for the log / tests.
const normKey = x => clean(x).toLowerCase().replace(/\s+/g, ' ').trim();
const flatLoops = schema => schema.filter(t => t.type === 'loop' && !(t.children || []).some(c => c.type === 'loop'))
  .map(tag => ({ tag, names: (tag.children || []).map(c => c.name) })).filter(i => i.names.length >= 2);
const numericFields = (row, names) => names.slice(1).filter(n => parseNumber(row[n]) !== null).length;

function reconcileTwins(schema, values) {
  const info = flatLoops(schema);
  const rowsOf = i => (Array.isArray(values[i.tag.name]) ? values[i.tag.name] : []);
  const money = info.filter(i => rowsOf(i).some(r => numericFields(r, i.names) >= 2));
  const plain = info.filter(i => !money.includes(i));
  const changes = [];
  if (!money.length || !plain.length) return changes;
  const twinOf = k => {
    for (const m of money) { const row = rowsOf(m).find(r => normKey(r[m.names[0]]) === k); if (row) return { row, m }; }
    return null;
  };
  plain.forEach(i => {
    values[i.tag.name] = rowsOf(i).filter(r => {
      const k = normKey(r[i.names[0]]);
      const twin = k && twinOf(k);
      if (!twin) return true;
      const flagged = twin.row[GROUP_FLAG] === true;
      if (flagged && numericFields(twin.row, twin.m.names) >= 2) { changes.push({ tag: i.tag.name, row: clean(r[i.names[0]]).trim(), action: 'dropped total row' }); return false; }
      if (flagged && r[GROUP_FLAG] !== true) { r[GROUP_FLAG] = true; changes.push({ tag: i.tag.name, row: clean(r[i.names[0]]).trim(), action: 'flagged like its twin' }); }
      if (!flagged && r[GROUP_FLAG] === true) { delete r[GROUP_FLAG]; changes.push({ tag: i.tag.name, row: clean(r[i.names[0]]).trim(), action: 'unflagged like its twin' }); }
      return true;
    });
  });
  return changes;
}

// ---- Rows worth a second look (no label knowledge: only emptiness and the template's own header text) ---------------------------
// For a loop without nested lists:
//   - a flagged (heading / total) row with nothing in any field,
//   - an unflagged row with only its first filled field and everything else empty (e.g. a stray heading),
//   - a row whose every filled value is text that also appears in the template's own header text around the loops (a repeated
//     column-heading row).
function rowWarnings(schema, values) {
  const norm = x => clean(x).toLowerCase().replace(/\s+/g, ' ').trim();
  // headings that appear flagged in more than one loop are the sheet's own section titles, not stray rows
  const flaggedIn = {};
  schema.filter(t => t.type === 'loop').forEach(t => (Array.isArray(values[t.name]) ? values[t.name] : []).forEach(r => {
    const first = (t.children || []).find(c => c.type !== 'loop');
    const k = first && norm(r[first.name]);
    if (k && r[GROUP_FLAG] === true) (flaggedIn[k] = flaggedIn[k] || new Set()).add(t.name);
  }));
  const headerCells = new Set(schema.filter(t => t.type === 'loop').flatMap(function ctx(t) { return [t.context, ...(t.children || []).flatMap(ctx)]; })
    .flatMap(c => clean(c).split('|')).map(norm).filter(c => c.length >= 2));
  const warnings = [];
  schema.filter(t => t.type === 'loop' && !(t.children || []).some(c => c.type === 'loop')).forEach(tag => {
    const names = (tag.children || []).map(c => c.name);
    (Array.isArray(values[tag.name]) ? values[tag.name] : []).forEach((row, i) => {
      const filled = names.filter(n => clean(row[n]).trim());
      const flagged = row[GROUP_FLAG] === true;
      const reasons = [];
      if (flagged && !filled.length) reasons.push('A heading / total row with nothing in it.');
      if (!flagged && names.length >= 2 && filled.length === 1 && filled[0] === names[0]) reasons.push('A row with only its first field filled and not marked as a heading / total row.');
      const texts = filled.map(n => norm(row[n]));
      const sharedHeading = flagged && filled.length === 1 && flaggedIn[texts[0]] && flaggedIn[texts[0]].size > 1;
      if (!sharedHeading && texts.length && texts.some(t => /[a-z]/.test(t)) && texts.every(t => headerCells.has(t))) reasons.push('Same text as a heading printed in the template (a repeated column or section heading?).');
      if (reasons.length) warnings.push({ kind: 'row', path: `${tag.name}[${i}]`, tag: tag.name, row: i, column: null, value: filled.length ? clean(row[filled[0]]).trim().slice(0, 60) : '', reason: reasons.join(' ') });
    });
  });
  return warnings;
}

// Keys the agent returned that are not template fields (e.g. "sscLevy" for "sscl"): reported, then dropped by sanitising
function driftWarnings(schema, body) {
  const warnings = [];
  const src = isObj(body.values) ? body.values : {};
  const names = new Set(schema.map(t => t.name));
  Object.keys(src).forEach(k => { if (!names.has(k)) warnings.push({ kind: 'drift', path: k, tag: k, column: null, value: '', reason: `The agent returned "${k}", which is not a field of the template (dropped).` }); });
  const keys = new Set();
  schema.forEach(tag => cleanValue(tag, src[tag.name], tag.name, keys));
  keys.forEach(entry => {
    const [path, key] = entry.split('\u0000');
    warnings.push({ kind: 'drift', path: `${path}.${key}`, tag: path.split('.')[0], column: key, value: '', reason: `The agent returned the field "${key}" for "${path}", which is not a field of the template (dropped).` });
  });
  return warnings;
}

// raw = what the agent returned { values, missing, userSource, meta }. user = the logged-in user's details.
// userSource lists the tags that stand for an account-manager detail; THIS function fills them from the user's record (the
// agent's own value for them is dropped), and a detail the user's record lacks goes to userMissing ("Add your phone number
// in your profile"), never to `missing`. Returns the clean values plus the lists the edit screen shows.
function validate(schema, raw, grid, allowed, user = {}, storedUserSource = {}) {
  const body = isObj(raw) ? raw : {};
  const values = sanitize(schema, isObj(body.values) ? body.values : body, true);
  const adjustments = [...dropDuplicateRows(schema, values, grid), ...reconcileTwins(schema, values)];
  const byName = Object.fromEntries(schema.map(t => [t.name, t]));

  // Which tags are account-manager details depends on the TEMPLATE, not the sheet: the list stored with the template version
  // always applies (even when the agent forgot a tag in this run), and tags the agent names are added to it. The stored list wins
  // when the agent disagrees about a tag.
  const seen = new Set();
  const fromStore = Object.entries(isObj(storedUserSource) ? storedUserSource : {}).map(([tag, field]) => ({ tag, field }));
  const userSource = [...fromStore, ...(Array.isArray(body.userSource) ? body.userSource : [])]
    .filter(u => isObj(u) && byName[u.tag] && byName[u.tag].type !== 'loop' && USER_FIELDS.includes(u.field) && !seen.has(u.tag) && seen.add(u.tag))
    .map(u => ({ tag: u.tag, field: u.field }));
  userSource.forEach(u => { values[u.tag] = clean(user[u.field]).trim(); });
  const userMissing = userSource.filter(u => !values[u.tag]);
  const fromUser = new Set(userSource.map(u => u.tag));

  // A text tag with no value is missing. A loop with no rows is missing only when the agent said so or left the loop out
  // altogether: an explicit [] the agent did not complain about is intentional (e.g. no separate optional-items table).
  const returned = isObj(body.values) ? body.values : body;
  const agentMissing = new Set(Array.isArray(body.missing) ? body.missing.map(String) : []);
  const missing = [...new Set([
    ...[...agentMissing].filter(n => byName[n]),
    ...schema.filter(t => isEmptyValue(values[t.name]) && (t.type !== 'loop' || !Array.isArray(returned[t.name]))).map(t => t.name),
  ])].filter(n => !fromUser.has(n));
  const meta = isObj(body.meta) ? body.meta : {};
  return {
    values,
    missing,
    userSource,
    userMissing,
    adjustments,
    warnings: [...priceWarnings(schema, values, grid, allowed), ...driftWarnings(schema, body), ...rowWarnings(schema, values)],
    meta: { customerName: asText(meta.customerName).trim() },
  };
}

// ---- The reference placeholder ------------------------------------------------------------------------------------------------
// The tag that prints the proposal reference number ("{ref_no}", "Proposal Ref. No. {refNo}" ...). Only top-level text tags count: found by
// its name (ref, ref_no, refNo, proposal_reference ...) or, failing that, by the template text around it ("Ref. No.").
// strict (used by the Product + Solution flow): the context is the text around the tag, which in a combined template also holds the neighbouring
// tags' labels ("Proposal Ref. No. {refNo}" sits next to {companyName}). Strict mode therefore reads only the label printed directly BEFORE
// this tag (back to the previous "|", i.e. paragraph / cell, or tag). The default (strict = false) is the solution flow's own behaviour.
function labelBefore(tag) {
  const ctx = String(tag.context || '');
  const hits = [];
  const re = new RegExp('\\{[@#^%]?' + String(tag.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g');
  let m;
  while ((m = re.exec(ctx))) hits.push(m.index);
  if (!hits.length) return '';
  const centre = ctx.length / 2;
  const at = hits.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0];
  return ctx.slice(0, at).split('|').pop().split('}').pop();
}
const REF_LABEL = /\bref(erence)?\.?\s*(no|number|num)\b/i;
const isReferenceTag = (tag, strict = false) => !!tag && tag.type === 'text' && (
  /(^|[^a-z])ref(erence)?([^a-z]|$)|reference/i.test(String(tag.name || '').replace(/([a-z])([A-Z])/g, '$1_$2'))
  || REF_LABEL.test(strict ? labelBefore(tag) : String(tag.context || ''))
);

// The reference tags' values are NEVER taken from the AI or the sheet: with `force` they are set to `refNo` (the backend-built reference).
// Without it (Save, render) what is there is kept when it is an SLTM reference or text the user typed; empty values and leftovers of the
// sheet's label ("PR:", "Ref No:", "undefined", "null", "N/A") become `refNo`. Returns a copy.
function applyReference(schema, values, refNo, force = false, strict = false) {
  const refService = require('./refService');
  const out = isObj(values) ? { ...values } : {};
  const ref = String(refNo || '');
  (schema || []).filter(tag => isReferenceTag(tag, strict)).forEach(tag => {
    const current = String(out[tag.name] == null ? '' : out[tag.name]).trim();
    const typed = current && (refService.SOLUTION_REF_PATTERN.test(current) || (refService.cleanQuotationRef(current) && !/^(undefined|null|n[/]a|na)$/i.test(current)));
    out[tag.name] = !force && typed ? current : ref;
  });
  return out;
}

module.exports = { isReferenceTag, applyReference, GROUP_FLAG, USER_FIELDS, flattenTags, buildSchema, agentSchema, sanitize, validate, priceWarnings, rowWarnings, reconcileTwins, dropDuplicateRows, emptyRow, parseNumber };
