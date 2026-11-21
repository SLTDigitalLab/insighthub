const axios = require('axios');
const { compactOutline } = require('./templateOutlineService');
const { slots, BLOCK_SLOTS, ITEM_LOOP, CLAIM_FIRST_SECTIONS } = require('../proposal/fieldSchema');
const { autoBind } = require('../proposal/autoBind');

// Maps an uploaded template to the field schema.
//   1. Tags already in the template are bound by name (proposal/autoBind.js); those slots are not sent to the AI.
//   2. The remaining slots + the outline go to the n8n "Proposal Template Mapper" workflow, which answers, per slot,
//      WHERE it is in the document (paragraph / runs / table row) and WHAT to do there. It never writes the document.
//   3. Every answer is checked against the outline here. The rules are the same whatever the AI says:
//        - only RED text and Word REF field values are variable; black text is template wording and is never mapped
//        - the location must exist and the quoted evidence must really be there
//        - two slots may not claim the same place
//      A proposed location that fails a rule is kept for the review screen as "needs review", with the reason.
//
// A mapping entry:
//   { key, label, kind, source: 'tag'|'ai',
//     status: 'tagged' | 'found' | 'needs_review' | 'not_found',
//     action?, evidence?, confidence?, note?,
//     ...location of the accepted part,
//     review?: [{ proposed, reason }] }       what the AI proposed but was not accepted, and why
// Locations by action:
//   replaceSpan  locations: [{ paragraph, runs: [from, to], evidence, context, field? }]   kind span (one per place; field = a REF field)
//   replaceBlock paragraphs: [from, to]                                                    kind block
//   fillTable    table, templateRow, columns: { column: cell }                             kind table
//   insertImage  paragraph  (a paragraph with red placeholder text) or image (a small picture)   kind image

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';
const MAPPER_URL = process.env.N8N_PROPOSAL_MAPPER_WEBHOOK_URL || `${N8N_BASE}/proposal-template-mapper`;

const ACTION_OF_KIND = { span: 'replaceSpan', block: 'replaceBlock', table: 'fillTable', image: 'insertImage' };
const { mapping: limits } = require('../proposal/renderSettings');
const MAX_BLOCK_PARAGRAPHS = limits.maxBlockParagraphs;
const MAX_LOCATIONS = limits.maxLocations;
const A4_AREA_EMU = limits.a4AreaEmu; // a picture bigger than this share of a page is a layout graphic, not a placeholder
const MAX_PLACEHOLDER_PICTURE = limits.maxPlaceholderPictureShare;

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const int = v => (Number.isInteger(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN));
const visible = r => !r.hidden && r.text.trim();
const redVisible = p => p.runs.some(r => r.red && visible(r));
const hasBlack = p => p.runs.some(r => visible(r) && !r.red && !r.inFieldCode);

// A place that already holds a docxtemplater tag ({name}, {#loop}, {@raw} ...) belongs to the author: never map over it
const TAG_TEXT = /\{[#/@^!]?[A-Za-z_][\w.]*\}/;
const hasTagText = p => TAG_TEXT.test(p.text);
// run indexes of a paragraph that carry part of a tag (a tag can be split over several runs)
function tagRuns(p) {
  const runs = p.runs.filter(r => !r.hidden);
  const full = runs.map(r => r.text).join('');
  const starts = [];
  let o = 0;
  runs.forEach(r => { starts.push(o); o += r.text.length; });
  const hit = new Set();
  const re = new RegExp(TAG_TEXT.source, 'g');
  let m;
  while ((m = re.exec(full)) !== null) {
    runs.forEach((r, i) => { if (starts[i] < m.index + m[0].length && starts[i] + r.text.length > m.index) hit.add(r.index); });
  }
  return hit;
}

// Which slots do the template's own tags already cover?
function taggedSlots(tags) {
  const bound = autoBind(tags);
  const byKey = {};
  Object.entries(bound).forEach(([tagName, b]) => {
    let key = null;
    if (b.kind === 'loop') key = b.field === ITEM_LOOP.loop ? ITEM_LOOP.blockSlot : b.field; // the item loop replaces the block
    else if (b.kind === 'field') key = b.field;
    else if (b.kind === 'compose') key = tagName;
    else if (b.kind === 'diagrams') key = (BLOCK_SLOTS.find(s => s.binding === b.kind) || {}).key;
    if (key) byKey[key] = tagName;
  });
  return byKey;
}

function context(para, runs) {
  const part = i => para.runs.slice(...i).filter(r => !r.hidden).map(r => r.text).join('');
  return `${part([0, runs[0]]).slice(-80)}«${part([runs[0], runs[1] + 1])}»${part([runs[1] + 1]).slice(0, 80)}`.replace(/\s+/g, ' ').trim();
}

// ---- Rule checks: each returns { ok: true, ... } or { ok: false, reason } ------------------------------------------------
function checkSpan(l, idx, admin) {
  const para = l && idx.paragraph[l.paragraph];
  const runs = l && Array.isArray(l.runs) ? l.runs.map(int) : [];
  if (!para) return { ok: false, reason: 'The paragraph the AI named does not exist in the document' };
  if (runs.length !== 2 || runs.some(Number.isNaN) || runs[0] < 0 || runs[0] > runs[1] || runs[1] >= para.runs.length) {
    return { ok: false, reason: `No run range was given for ${para.ref}, or it does not exist` };
  }
  const taken = tagRuns(para);
  for (let i = runs[0]; i <= runs[1]; i += 1) {
    if (taken.has(i)) return { ok: false, reason: `${para.ref} runs ${runs[0]}-${runs[1]} already contain a tag; the author's tags are never replaced` };
  }
  const evidence = admin ? '' : String(l.evidence || '').trim();
  const field = idx.fields.find(f => f.kind === 'REF' && f.paragraph === para.ref && f.runs && f.runs[0] === runs[0] && f.runs[1] === runs[1]);
  if (field) {
    // A whole Word REF field: its displayed value is the sample (it may be empty)
    if (!admin && evidence && field.result && !(norm(field.result).includes(norm(evidence)) || norm(evidence).includes(norm(field.result)))) {
      return { ok: false, reason: `The text the AI quoted is not the value of the field at ${para.ref}` };
    }
    return { ok: true, loc: { paragraph: para.ref, runs, evidence: evidence || field.result, field: field.name, context: context(para, runs) } };
  }
  const covered = para.runs.slice(runs[0], runs[1] + 1);
  if (covered.some(r => r.inFieldCode || r.fldChar)) return { ok: false, reason: `The range in ${para.ref} cuts through a Word field; a field must be mapped as a whole` };
  const text = norm(covered.filter(r => !r.hidden).map(r => r.text).join(''));
  if (!text) return { ok: false, reason: `The range in ${para.ref} holds no visible text` };
  if (covered.some(r => visible(r) && !r.red)) return { ok: false, reason: `${para.ref} runs ${runs[0]}-${runs[1]} are black template wording; only red text is variable` };
  if (!admin && (!evidence || !(text.includes(norm(evidence)) || norm(evidence).includes(text)))) return { ok: false, reason: `The text the AI quoted is not at ${para.ref} runs ${runs[0]}-${runs[1]}` };
  return { ok: true, loc: { paragraph: para.ref, runs, evidence: admin ? covered.map(r => r.text).join('').trim() : evidence, context: context(para, runs) } };
}

// The longest run of paragraphs inside `list` that holds no black wording, trimmed of empty paragraphs at both ends.
// Offered to the admin as a one-click fix when a proposed block reaches into black text.
function redOnlyRange(list, isBlack) {
  let best = null;
  let cur = [];
  const close = () => {
    const trimmed = cur.slice();
    while (trimmed.length && !trimmed[0].text.trim()) trimmed.shift();
    while (trimmed.length && !trimmed[trimmed.length - 1].text.trim()) trimmed.pop();
    const count = trimmed.filter(p => p.text.trim()).length;
    if (count && (!best || count > best.count)) best = { count, first: trimmed[0], last: trimmed[trimmed.length - 1] };
    cur = [];
  };
  list.forEach(p => { if (isBlack(p)) close(); else cur.push(p); });
  close();
  return best ? { paragraphs: [best.first.ref, best.last.ref], context: list.filter(p => p.index >= best.first.index && p.index <= best.last.index && p.text.trim()).map(p => p.text.trim()).join(' | ').slice(0, 240) } : null;
}

function checkBlock(raw, idx, admin) {
  const refs = Array.isArray(raw.paragraphs) ? raw.paragraphs : [];
  const paras = refs.map(r => idx.paragraph[r]);
  if (refs.length !== 2 || paras.some(p => !p)) return { ok: false, reason: refs.length > 2 ? `A list of ${refs.length} paragraphs was given instead of a first and a last` : 'The paragraphs the AI named do not exist' };
  const [from, to] = paras;
  const part = from.ref.split('.')[0];
  if (part !== to.ref.split('.')[0] || from.index > to.index || to.index - from.index + 1 > MAX_BLOCK_PARAGRAPHS) return { ok: false, reason: 'The paragraph range is not valid' };
  const inRange = idx.list.filter(p => p.ref.split('.')[0] === part && p.index >= from.index && p.index <= to.index);
  const filled = inRange.filter(p => p.text.trim());
  const tagged = filled.find(hasTagText);
  if (tagged) return { ok: false, reason: `${tagged.ref} already contains a tag; the author's tags are never replaced` };
  const isBlack = p => p.text.trim() && (hasBlack(p) || !redVisible(p));
  const black = filled.find(isBlack);
  if (black) return { ok: false, reason: `${black.ref} is black template wording; a block may only hold red sample paragraphs`, suggestion: redOnlyRange(inRange, isBlack) };
  const evidence = String(raw.evidence || '').trim();
  if (!admin && (!evidence || !norm(filled.map(p => p.text).join(' ')).includes(norm(evidence).slice(0, 60)))) return { ok: false, reason: 'The text the AI quoted is not in that range' };
  const cells = new Set(inRange.map(p => (p.cell ? `${p.cell.table}.${p.cell.r}.${p.cell.c}` : '-')));
  if (cells.size > 1) return { ok: false, reason: 'The paragraphs are in different table cells; a block must be inside one place' };
  return { ok: true, loc: { paragraphs: [from.ref, to.ref] }, context: filled.map(p => p.text.trim()).join(' | ').slice(0, 240), paraRefs: inRange.map(p => p.ref) };
}

function checkTable(slot, raw, idx) {
  const table = idx.table[raw.table];
  const row = int(raw.templateRow);
  if (!table) return { ok: false, reason: 'The table the AI named does not exist' };
  if (Number.isNaN(row) || row < 0 || row >= table.rows.length) return { ok: false, reason: 'The template row does not exist' };
  if (table.rows[row].cells.some(c => TAG_TEXT.test(c.text || ''))) return { ok: false, reason: `Row ${row} of ${table.ref} already contains tags (a loop of the template); the author's tags are never replaced` };
  if (!table.rows[row].cells.some(c => c.red)) return { ok: false, reason: `Row ${row} of ${table.ref} has no red sample text, so it is not a template row` };
  const cols = raw.columns && typeof raw.columns === 'object' ? raw.columns : {};
  const wanted = new Set(slot.columns.map(c => c.key));
  const columns = {};
  for (const [k, v] of Object.entries(cols)) {
    const ci = int(v);
    if (!wanted.has(k)) continue;
    if (Number.isNaN(ci) || ci < 0 || ci >= table.rows[row].cells.length) return { ok: false, reason: `Column "${k}" points at a cell that does not exist` };
    columns[k] = ci;
  }
  if (!Object.keys(columns).length) return { ok: false, reason: 'No column of the table was matched' };
  const header = table.rows[table.headerRow] ? table.rows[table.headerRow].cells.map(c => c.text).join(' | ') : '';
  return {
    ok: true,
    loc: { table: table.ref, templateRow: row, columns },
    context: `${header} → row ${row}: ${table.rows[row].cells.map(c => c.text).join(' | ')}`.slice(0, 240),
    paraRefs: table.rows[row].cells.flatMap(c => c.paragraphs || []),
  };
}

function checkImage(raw, idx) {
  if (raw.image) {
    const img = idx.image[raw.image];
    if (!img) return { ok: false, reason: 'The picture the AI named does not exist' };
    if (img.widthEmu * img.heightEmu > MAX_PLACEHOLDER_PICTURE * A4_AREA_EMU) return { ok: false, reason: `${img.ref} ("${img.name}") is a large layout picture, not a placeholder` };
    return { ok: true, loc: { image: img.ref }, context: img.name };
  }
  const para = idx.paragraph[raw.paragraph];
  if (!para) return { ok: false, reason: 'The location the AI named does not exist' };
  if (hasTagText(para)) return { ok: false, reason: `${para.ref} already contains a tag; the author's tags are never replaced` };
  if (!redVisible(para)) return { ok: false, reason: `${para.ref} has no red placeholder text` };
  return { ok: true, loc: { paragraph: para.ref }, context: para.text.trim().slice(0, 200) };
}

// What the AI proposed, as stored under `review`
const proposedOf = raw => Object.fromEntries(['locations', 'paragraph', 'runs', 'paragraphs', 'table', 'templateRow', 'columns', 'image', 'evidence']
  .filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));

// ---- One slot: the AI's answer -> an entry with accepted locations and a review list -------------------------------------
function buildEntry(slot, raw, idx, admin = false) {
  const base = { key: slot.key, label: slot.label, kind: slot.kind, section: slot.section, source: admin ? 'admin' : 'ai' };
  if (admin && raw && raw.clear) return { ...base, status: 'not_found', note: 'Cleared by the admin' };
  if (admin && raw && !raw.status) raw = { ...raw, status: 'found' };
  if (!raw || raw.status !== 'found') return { ...base, status: 'not_found', ...(raw && raw.note ? { note: String(raw.note).slice(0, 300) } : {}) };
  const action = ACTION_OF_KIND[slot.kind];
  if (raw.action && raw.action !== action) return { ...base, status: 'needs_review', review: [{ proposed: proposedOf(raw), reason: `Unexpected action "${raw.action}" for a ${slot.kind} slot` }] };
  const confidence = admin ? 1 : (Math.max(0, Math.min(1, Number(raw.confidence))) || 0);
  const common = { ...base, action, confidence, ...(raw.note ? { note: String(raw.note).slice(0, 300) } : {}) };

  if (slot.kind === 'span') {
    const asked = Array.isArray(raw.locations) ? raw.locations : (raw.paragraph ? [{ paragraph: raw.paragraph, runs: raw.runs, evidence: raw.evidence }] : []);
    if (admin && !asked.length) return { ...base, status: 'not_found', note: 'Cleared by the admin' };
    const locations = [];
    const review = [];
    asked.slice(0, MAX_LOCATIONS).forEach(l => {
      const r = checkSpan(l, idx, admin);
      if (!r.ok) review.push({ proposed: proposedOf(l), reason: r.reason });
      else if (!locations.some(x => x.paragraph === r.loc.paragraph && x.runs[0] === r.loc.runs[0] && x.runs[1] === r.loc.runs[1])) locations.push(r.loc);
    });
    if (!asked.length) review.push({ proposed: {}, reason: 'The AI said "found" but gave no location' });
    return { ...common, status: locations.length ? 'found' : 'needs_review', ...(locations.length ? { locations, evidence: locations[0].evidence } : {}), ...(review.length ? { review } : {}) };
  }
  const r = slot.kind === 'block' ? checkBlock(raw, idx, admin) : (slot.kind === 'table' ? checkTable(slot, raw, idx) : checkImage(raw, idx));
  if (!r.ok) return { ...common, status: 'needs_review', review: [{ proposed: proposedOf(raw), reason: r.reason, ...(r.suggestion ? { suggestion: r.suggestion } : {}) }] };
  return { ...common, status: 'found', ...r.loc, evidence: admin ? '' : String(raw.evidence || '').trim(), ...(r.context ? { context: r.context } : {}), ...(r.paraRefs ? { _paraRefs: r.paraRefs } : {}) };
}

// ---- Two slots must not claim the same place ----------------------------------------------------------------------------
// Blocks, tables and images claim first (they are the most specific), then the acknowledgement page's fields, then the rest.
// A clashing location is not dropped: it moves to `review` with the reason.
const CLAIM_ORDER = { table: 0, block: 1, image: 2, span: 3 };

function resolveClashes(entries) {
  const claims = new Map(); // key -> slot key
  const claim = (keys, slotKey) => keys.forEach(k => claims.set(k, slotKey));
  const clash = keys => keys.map(k => claims.get(k)).find(Boolean);
  const order = entries.filter(e => (e.source === 'ai' || e.source === 'admin') && e.status === 'found').sort((a, b) =>
    ((a.source === 'admin' ? 0 : 1) - (b.source === 'admin' ? 0 : 1)) || (CLAIM_ORDER[a.kind] - CLAIM_ORDER[b.kind]) || ((CLAIM_FIRST_SECTIONS.includes(a.section) ? 0 : 1) - (CLAIM_FIRST_SECTIONS.includes(b.section) ? 0 : 1)));
  order.forEach(e => {
    if (e.kind === 'span') {
      const keep = [];
      (e.locations || []).forEach(l => {
        const runKeys = Array.from({ length: l.runs[1] - l.runs[0] + 1 }, (_, i) => `${l.paragraph}.r${l.runs[0] + i}`);
        const other = clash([`p:${l.paragraph}`, ...runKeys]);
        if (other) (e.review = e.review || []).push({ proposed: { locations: [{ paragraph: l.paragraph, runs: l.runs, evidence: l.evidence }] }, reason: `Same place as "${other}", which has priority` });
        else { keep.push(l); claim(runKeys, e.key); }
      });
      e.locations = keep;
      if (!keep.length) { e.status = 'needs_review'; delete e.evidence; delete e.locations; }
    } else {
      const keys = (e._paraRefs || []).map(r => `p:${r}`).concat(e.image ? [e.image] : [], e.paragraph ? [`p:${e.paragraph}`] : []);
      const other = clash(keys);
      if (other) {
        e.review = [{ proposed: { ...(e.paragraphs ? { paragraphs: e.paragraphs } : {}), ...(e.table ? { table: e.table, templateRow: e.templateRow, columns: e.columns } : {}), ...(e.image ? { image: e.image } : {}), ...(e.paragraph ? { paragraph: e.paragraph } : {}) }, reason: `Same place as "${other}", which has priority` }];
        e.status = 'needs_review';
        ['paragraphs', 'table', 'templateRow', 'columns', 'image', 'paragraph', 'evidence', 'context'].forEach(k => delete e[k]);
      } else claim(keys, e.key);
    }
  });
  entries.forEach(e => { delete e._paraRefs; });
}

async function askMapper(payload) {
  try {
    const { data } = await axios.post(MAPPER_URL, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 180000 });
    const body = Array.isArray(data) ? data[0] : data;
    if (!body || typeof body !== 'object') return { error: 'The mapping workflow returned an empty response.' };
    if (body.error) return { error: `Mapping workflow error: ${body.error}` };
    if (!Array.isArray(body.mappings)) return { error: 'The mapping workflow did not return a "mappings" list.' };
    return { mappings: body.mappings };
  } catch (err) {
    return { error: `Mapping workflow call failed: ${err.response ? `HTTP ${err.response.status}` : err.message}` };
  }
}

// The same checks, from stored answers: answers = the mapper's mappings, overrides = { slotKey: raw location | { clear: true } }
// made by the admin in the review screen. Returns the entries (see the top of this file).
function mapFromAnswers(outline, tags, answers, overrides = {}) {
  const allSlots = slots();
  const tagged = taggedSlots(tags);
  const idx = { list: outline.paragraphs, fields: outline.fields, paragraph: {}, table: {}, image: {} };
  outline.paragraphs.forEach(p => { idx.paragraph[p.ref] = p; });
  outline.tables.forEach(t => { idx.table[t.ref] = t; });
  outline.images.forEach(i => { idx.image[i.ref] = i; });
  const byKey = Object.fromEntries((answers || []).filter(a => a && typeof a.key === 'string').map(a => [a.key, a]));

  const all = allSlots.map(slot => {
    if (tagged[slot.key]) return { key: slot.key, label: slot.label, kind: slot.kind, section: slot.section, status: 'tagged', source: 'tag', tag: tagged[slot.key] };
    if (overrides && overrides[slot.key]) {
      const entry = buildEntry(slot, overrides[slot.key], idx, true);
      const asked = byKey[slot.key] ? buildEntry(slot, byKey[slot.key], idx) : null;
      // what the AI had proposed stays visible next to the admin's choice
      return asked && asked.review ? { ...entry, aiReview: asked.review } : entry;
    }
    return buildEntry(slot, byKey[slot.key], idx);
  });
  resolveClashes(all.filter(e => e.source !== 'tag'));
  return all;
}

// outline: from buildOutline; tags: from extractTags. Returns { entries, answers, requested, aiError? }.
async function mapTemplate(outline, tags) {
  const tagged = taggedSlots(tags);
  const toAsk = slots().filter(s => !tagged[s.key]);
  let aiError = '';
  let answers = [];
  if (toAsk.length) {
    const res = await askMapper({
      slots: toAsk.map(s => ({ key: s.key, label: s.label, kind: s.kind, section: s.section, hint: s.hint || '', ...(s.columns ? { columns: s.columns } : {}), action: ACTION_OF_KIND[s.kind] })),
      outline: compactOutline(outline),
    });
    if (res.error) aiError = res.error; else answers = res.mappings;
  }
  return { entries: mapFromAnswers(outline, tags, answers), answers, requested: toAsk.length, ...(aiError ? { aiError } : {}) };
}

module.exports = { mapTemplate, mapFromAnswers, taggedSlots, buildEntry, resolveClashes };
