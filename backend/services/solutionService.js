const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const store = require('./templateStoreService');
const grids = require('./xlsxGridService');
const schemaSvc = require('./solutionSchemaService');
const voteSvc = require('./solutionVoteService');
const refService = require('./refService');
const logoSvc = require('./proposalLogoService');
const proposalStorage = require('./proposalStorageService');
const docs = require('./proposalDocsService');
const { resolveRep, colomboDate } = require('./draftService');

// Solution proposal from an uploaded quotation workbook:
//   upload  -> the workbook is kept in a pending folder, the sheet names are returned
//   extract -> the chosen sheet becomes a generic grid, the n8n agent fills the solution template's tags, the answer is
//              checked against the tag schema and the grid, and the proposal is saved (source.xlsx kept with it)
// If the agent fails nothing is lost: the pending upload (and the reference number already issued for it) stays for a retry.
// There is no fallback parsing: only the agent decides what goes where.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PENDING_DIR = path.join(DATA_DIR, 'solution_pending'); // not under /uploads, so it is never served
fs.mkdirSync(PENDING_DIR, { recursive: true });

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';
const AGENT_URL = process.env.N8N_SOLUTION_WEBHOOK_URL || `${N8N_BASE}/proposal-solution`;
// The agent is run this many times in parallel on the same payload and the answers are voted on (solutionVoteService.js)
const AGENT_RUNS = Math.max(1, Math.min(5, Number(process.env.SOLUTION_AGENT_RUNS) || 3));
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const clean = v => String(v == null ? '' : v).trim();
const safeId = id => (/^[0-9a-f-]{36}$/i.test(String(id || '')) ? String(id) : null);
const xlsxOf = id => path.join(PENDING_DIR, `${id}.xlsx`);
const metaOf = id => path.join(PENDING_DIR, `${id}.json`);

function purgeOld() {
  try {
    fs.readdirSync(PENDING_DIR).forEach(f => {
      const p = path.join(PENDING_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > PENDING_MAX_AGE_MS) fs.unlinkSync(p);
    });
  } catch { /* best effort */ }
}

function loadPending(uploadId) {
  const id = safeId(uploadId);
  if (!id || !fs.existsSync(xlsxOf(id)) || !fs.existsSync(metaOf(id))) throw fail(404, 'This upload is no longer available (uploads are kept for 24 hours). Please upload the Excel file again.');
  return { id, meta: JSON.parse(fs.readFileSync(metaOf(id), 'utf8')), buffer: fs.readFileSync(xlsxOf(id)) };
}

function removePending(id) {
  [xlsxOf(id), metaOf(id)].forEach(f => { try { fs.unlinkSync(f); } catch { /* already gone */ } });
}

function createUpload({ buffer, filename, email }) {
  purgeOld();
  const sheets = grids.listSheets(buffer); // also checks the file
  const id = uuidv4();
  fs.writeFileSync(xlsxOf(id), buffer);
  fs.writeFileSync(metaOf(id), JSON.stringify({ filename: path.basename(filename || 'quotation.xlsx'), uploadedBy: email, createdAt: new Date().toISOString(), sheets }), 'utf8');
  return { uploadId: id, filename: path.basename(filename || 'quotation.xlsx'), sheets };
}

function activeTemplate() {
  const entry = store.getActive('solution');
  if (!entry) throw fail(409, 'There is no solution template yet. An admin needs to upload one on the Proposal Hub "Upload Latest Template" tab (type: Solution).');
  return entry;
}

// What the agent returns, or a clear error. n8n answers { values, missing, meta } or { error }.
// url / opts.refIsFatal: used by the Product + Solution flow (its own workflow; a reference problem there never stops the proposal). The defaults are the solution flow's.
async function askAgent(payload, url = AGENT_URL, { refIsFatal = true } = {}) {
  let data;
  try {
    ({ data } = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 170000, maxBodyLength: Infinity }));
  } catch (err) {
    const why = err.response ? `HTTP ${err.response.status}` : err.message;
    throw fail(502, `The AI agent could not be reached (${why}). Your Excel file is kept, so you can try again.`, { retry: true });
  }
  const body = Array.isArray(data) ? data[0] : data;
  if (!body || typeof body !== 'object') throw fail(502, 'The AI agent returned an empty response. Your Excel file is kept, so you can try again.', { retry: true, badOutput: true });
  if (body.error && /ref/i.test(String(body.error)) && refIsFatal) throw fail(422, 'No reference number was found in the quotation Excel. Please check that the quotation sheet contains its reference number and try again.', { code: 'excel_ref_not_found' });
  if (body.error && !(!refIsFatal && /ref/i.test(String(body.error)) && body.values && typeof body.values === 'object')) throw fail(502, `The AI agent could not read this sheet (${body.error}). Your Excel file is kept, so you can try again.`, { retry: true, invalidOutput: body.error === 'invalid_ai_output', raw: body.raw });
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw fail(502, 'The AI agent returned an answer in the wrong format. Your Excel file is kept, so you can try again.', { retry: true, badOutput: true });
  return { ...body, refNo: clean(body.refNo) };
}

// The cleaned quotation reference of one run: its `quotationRef` (the value found in the sheet) or, for a workflow that only returns a
// finished `refNo`, the part of it after "SLTM-<section>-<sub-section>-". "" when there is none.
function quotationPart(raw, refRequest) {
  const q = refService.cleanQuotationRef(raw && raw.quotationRef);
  if (q) return q;
  const full = clean(raw && raw.refNo);
  if (!full || !refRequest) return '';
  const prefix = `SLTM-${String(refRequest.section).toUpperCase()}-${String(refRequest.subSection).toUpperCase()}-`;
  return full.toUpperCase().startsWith(prefix) ? refService.cleanQuotationRef(full.slice(prefix.length)) : '';
}

// The model sometimes answers with text that is not valid JSON; one more try usually fixes it. Other errors are not retried.
async function askAgentWithRetry(payload, url = AGENT_URL, opts) {
  try {
    return await askAgent(payload, url, opts);
  } catch (err) {
    if (!err.invalidOutput) throw err;
    return askAgent(payload, url, opts);
  }
}

// Runs the agent for a grid (several times in parallel, then voted) and checks the combined answer. Used by the routes and by the
// test script. `template` (a stored version) lets the run use, and add to, the account-manager tags remembered for that version.
// A run that fails is left out of the vote; only if every run fails is the error raised.
// `refNo` is given only when the reference number is already fixed (Regenerate). Otherwise `refRequest` (type, section, sub-section) asks the
// workflow to find the quotation's own reference number in the sheet and build the full reference number from it.
async function runAgent({ grid, schema, rep, refNo, refRequest, today, template = null, runs = AGENT_RUNS }) {
  const payload = { mode: 'solution', grid, schema: schemaSvc.agentSchema(schema), user: { name: rep.name, phone: rep.phone, email: rep.email, designation: rep.designation, division: rep.division }, ...(refNo ? { refNo } : { refRequest }), today, groupFlag: schemaSvc.GROUP_FLAG };
  const started = Date.now();
  const settled = await Promise.all(Array.from({ length: runs }, async () => {
    const t = Date.now();
    try { return { ok: true, raw: await askAgentWithRetry(payload), ms: Date.now() - t }; } catch (err) { return { ok: false, err, ms: Date.now() - t }; }
  }));
  const good = settled.filter(r => r.ok);
  if (!good.length) throw settled[0].err;

  const voted = voteSvc.vote(good.map(r => r.raw), schema, grid);
  // The reference number is SLTM-<section>-<sub-section>-<quotation ref>, built HERE from the cleaned quotation reference VALUE the runs
  // found (the one most runs agree on; a run that found none does not vote). The reference the workflow itself returns is only used
  // for its quotation part, and anything the agent wrote into the template's reference placeholder is overwritten. The result is a
  // complete reference or "", never a partial one.
  const refVotes = new Map();
  good.forEach(r => { const q = quotationPart(r.raw, refRequest); if (q) refVotes.set(q, (refVotes.get(q) || 0) + 1); });
  const quotation = ([...refVotes.entries()].sort((a, b) => b[1] - a[1])[0] || [''])[0];
  const finalRef = refNo ? refService.sanitizeSolutionRef(refNo) || refNo : refService.safeSolutionRef(rep.account, quotation); // never throws, never ""
  const result = schemaSvc.validate(schema, voted.raw, grid, [rep.phone, rep.email, finalRef, today], rep, template && template.userSource);
  result.values = schemaSvc.applyReference(schema, result.values, finalRef, true, true);
  voted.disagreements.forEach(tag => result.warnings.push({ kind: 'row', path: tag, tag, row: null, column: null, value: '', reason: 'The runs of the AI agent disagreed on this table; please check its rows.' }));
  if (template && template.id) store.mergeUserSource(template.id, result.userSource);

  const timing = { runsMs: settled.map(r => r.ms), totalMs: Date.now() - started };
  const split = voted.log.filter(v => !v.unanimous);
  console.log(`[solution] ${good.length}/${runs} runs ok (${timing.runsMs.map(ms => `${(ms / 1000).toFixed(1)}s`).join(', ')}; ${(timing.totalMs / 1000).toFixed(1)}s total)`
    + (split.length ? `; not unanimous: ${split.map(v => `${v.tag}=run${v.winner} (${v.how})`).join(', ')}` : '; all runs agreed'));
  return { ...result, refNo: finalRef, timing, runs: { requested: runs, succeeded: good.length, failed: settled.filter(r => !r.ok).map(r => r.err.message) }, votes: voted.log };
}

// Sheet -> grid -> agent -> checked values. Shared by the first generation and by Regenerate.
async function generate({ buffer, sheetName, user, refNo, refRequest, template }) {
  const schema = schemaSvc.buildSchema(template.tags);
  const grid = grids.buildGrid(buffer, sheetName);
  if (!grid.cells.length) throw fail(422, `The sheet "${sheetName}" has no filled cells.`);
  const rep = resolveRep(user);
  const result = await runAgent({ grid, schema, rep, refNo, refRequest, today: colomboDate(), template });
  return { schema, grid, rep, result };
}

// Same as generate(), but the reference number can never stop a proposal. The workflow is first asked to build the reference
// (SLTM-<section>-<sub-section>-<quotation ref>) from `refRequest`. When that cannot be done (no refRequest because the user has no
// section / sub-section, the Excel has no quotation ref, the workflow answers a reference error) it is asked again with a throw-away
// token in place of the reference (only so it skips its reference lookup) and every trace of the token is removed from the answer.
// The proposal then has an empty reference number.
async function generateAllowingNoRef({ buffer, sheetName, user, refRequest, template }) {
  const withoutRef = async () => {
    const token = `NOREF${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    const out = await generate({ buffer, sheetName, user, refNo: token, template });
    const scrub = v => JSON.parse(JSON.stringify(v).split(token).join(''));
    return { ...out, result: { ...scrub(out.result), refNo: '' } };
  };
  if (!refRequest) { console.warn('[solution] no section / sub-section for this user; generating without a reference number'); return withoutRef(); }
  try {
    return await generate({ buffer, sheetName, user, refRequest, template });
  } catch (err) {
    if (err.code !== 'excel_ref_not_found') throw err;
    console.warn('[solution] no usable reference number in the quotation Excel; generating without a reference number');
    return withoutRef();
  }
}

// The section / sub-section the workflow needs to build the reference; null (never an error) when the user has none
function refRequestFor(account) {
  const sec = refService.solutionSectionOf(account);
  return sec ? { type: 'solution', ...sec } : null;
}

// Values that still hold a rejected reference number (invalid or duplicate) are blanked, so it never prints in the document
function clearRef(values, ref) {
  const r = String(ref || '').trim();
  if (!r) return values;
  try { return JSON.parse(JSON.stringify(values).split(r).join('')); } catch { return values; }
}

// Company name fields: the extracted company name, else the customer name; never a reference number. The acknowledgement company name
// is the same value. Reference placeholders are not touched.
const COMPANY_TAG = /^company_?name$/i;
const ACK_COMPANY_TAG = /^ack_?company_?name$/i;
function fillCompanyNames(schema, values, customer, refNo) {
  const isRef = v => { const t = clean(v); return !!t && (/^SLTM-/i.test(t) || (!!refNo && t === refNo)); };
  const out = { ...values };
  const tags = (schema || []).filter(t => t.type === 'text');
  const main = tags.find(t => COMPANY_TAG.test(t.name));
  const ack = tags.filter(t => ACK_COMPANY_TAG.test(t.name));
  const current = main ? clean(out[main.name]) : '';
  const name = (current && !isRef(current)) ? current : clean(customer);
  if (main) out[main.name] = name;
  ack.forEach(t => { out[t.name] = name; });
  return out;
}

async function extract({ uploadId, sheetName, user }) {
  const { id, meta, buffer } = loadPending(uploadId);
  if (!meta.sheets.some(s => s.name === sheetName)) throw fail(400, 'Please choose one of the sheets of the uploaded workbook.');
  const template = activeTemplate();

  const refRequest = refRequestFor(resolveRep(user).account);

  // The workflow finds the quotation's reference number in the sheet and returns the full reference number (empty when there is none)
  const { schema, grid, rep, result } = await generateAllowingNoRef({ buffer, sheetName, user, refRequest, template });
  // The reference is built by the backend (SLTM-<SEC>-<SUB>-<Excel ref>, SLTM-<SEC>-<SUB>- or SLTM-). A malformed one, or a full one already
  // used by another proposal, is replaced by the short form: the reference never stops a proposal.
  let refNo = refService.sanitizeSolutionRef(result.refNo);
  let rejected = result.refNo && !refNo ? result.refNo : '';
  if (rejected) console.warn(`[solution] ignoring an invalid reference number ("${rejected}")`);
  if (refNo && !refNo.endsWith('-') && refService.find(refNo)) { console.warn(`[solution] reference number ${refNo} is already used; using the short form`); rejected = refNo; refNo = ''; }
  if (!refNo) refNo = refService.safeSolutionRef(rep.account, '');
  // The agent found no quotation reference (short form): look for a plain "Reference" / "Ref No" label with a value in the sheet itself
  if (refNo.endsWith('-')) {
    const found = refService.findQuotationRefInGrid(grid);
    const built = found ? refService.safeSolutionRef(rep.account, found) : '';
    if (built && !built.endsWith('-') && !refService.find(built)) refNo = built;
  }
  if (rejected) result.values = clearRef(result.values, rejected);
  result.values = schemaSvc.applyReference(schema, result.values, refNo, true, true); // the reference placeholder holds the saved reference
  result.values = fillCompanyNames(schema, result.values, result.meta.customerName, refNo);

  const saved = proposalStorage.saveProposal({
    refNo,
    companyName: result.meta.customerName,
    fields: result.values,
    templateId: template.id,
    templateVersion: template.version,
    user: { name: rep.name, email: rep.email },
    proposalType: 'solution',
    solution: { sheetName, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing, generatedFields: result.values, sourceName: meta.filename, notes: grid.notes },
  });
  // The source Excel is kept in a folder named after the reference number, or after the proposal id when there is no reference yet
  const stored = docs.saveSource(docs.keyOf(saved), buffer);
  const proposal = proposalStorage.updateProposal(saved.id, p => ({ ...p, solution: { ...p.solution, sourceFile: stored } }));
  removePending(id);
  return { proposal: docs.normalize(proposal), schema, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing };
}

// Runs the agent again on the stored Excel and sheet of an existing solution proposal (same reference number) and replaces its
// values. The customer name the user may have typed is kept. The caller has already asked the user to confirm.
async function regenerate(id, user) {
  const { proposal } = getSolution(id);
  docs.assertEditable(proposal); // Confirmed / Completed: view-only, checked before the agent runs
  // the proposal's own reference when it is a real one; a junk value saved earlier ("PR:") counts as none
  const ownRef = refService.sanitizeSolutionRef(proposal.refNo) || (refService.isValid(proposal.refNo) ? proposal.refNo : '');
  const abs = docs.sourcePath(docs.keyOf(proposal));
  if (!abs) throw fail(404, 'The original Excel file of this proposal was not found, so it cannot be regenerated.');
  const sheetName = proposal.solution && proposal.solution.sheetName;
  if (!sheetName) throw fail(409, 'This proposal does not remember which sheet it was made from.');
  const template = (proposal.templateId && store.get(proposal.templateId)) || activeTemplate();

  const buffer = fs.readFileSync(abs);
  const refRequest = ownRef ? null : refRequestFor(resolveRep(user).account);
  const { schema, grid, result } = ownRef
    ? await generate({ buffer, sheetName, user, refNo: ownRef, template })
    : await generateAllowingNoRef({ buffer, sheetName, user, refRequest, template });
  // the saved reference does not change on a regeneration, so the placeholder shows exactly that (or nothing)
  result.values = schemaSvc.applyReference(schema, result.values, ownRef, true, true);
  result.values = fillCompanyNames(schema, result.values, clean(proposal.companyName) || result.meta.customerName, ownRef);
  const revised = proposalStorage.reviseProposal(docs.keyOf(proposal), p => ({
    ...p,
    // a regeneration keeps the customer logo the user uploaded
    fields: p.fields && p.fields[logoSvc.META_KEY] ? { ...result.values, [logoSvc.META_KEY]: p.fields[logoSvc.META_KEY] } : result.values,
    companyName: clean(p.companyName) || result.meta.customerName,
    templateId: template.id,
    templateVersion: template.version,
    solution: { ...p.solution, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing, generatedFields: result.values, notes: grid.notes, regeneratedAt: new Date().toISOString() },
  }), { reason: 'revision', userEmail: (user && user.email) || '', force: true }); // a regeneration is always a new version
  const updated = revised && revised.proposal;
  return { proposal: updated, schema, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing };
}

function getSolution(id) {
  const proposal = proposalStorage.getProposalById(id);
  if (!proposal || proposal.proposalType !== 'solution') throw fail(404, 'Solution proposal not found');
  const entry = (proposal.templateId && store.get(proposal.templateId)) || store.getActive('solution');
  const schema = entry ? schemaSvc.buildSchema(entry.tags) : [];
  return { proposal, schema, logoPlace: !!(entry && Array.isArray(entry.logoPlaceholders) && entry.logoPlaceholders.length), logoField: logoSvc.logoFieldOf(entry, schema) };
}

// logo: undefined = unchanged, '' = removed, a PNG / JPG data URL = the new customer logo (proposalLogoService.js)
function saveFields(id, { fields, companyName, logo }, userEmail = '') {
  const { proposal, schema } = getSolution(id);
  const ownRef = refService.sanitizeSolutionRef(proposal.refNo) || (refService.isValid(proposal.refNo) ? proposal.refNo : '');
  // a reference placeholder holds a full SLTM reference or nothing: junk such as "PR:" is replaced by the proposal's own reference
  const values = schemaSvc.applyReference(schema, schemaSvc.sanitize(schema, fields), ownRef, false, true);
  // the picture settings (customer logo) are not template tags: they are kept from the stored proposal and changed only by `logo`
  const meta = logoSvc.withLogo(proposal.fields && proposal.fields[logoSvc.META_KEY], logo);
  if (logoSvc.hasKeys(meta)) values[logoSvc.META_KEY] = meta;
  // A new version only when the content really changed (see proposalStorage.reviseProposal)
  const revised = proposalStorage.reviseProposal(docs.keyOf(proposal), p => ({
    ...p,
    fields: values,
    companyName: companyName != null ? clean(companyName) : p.companyName,
  }), { reason: 'edit', userEmail });
  return revised && revised.proposal;
}

module.exports = { loadPending, removePending, askAgent, askAgentWithRetry, createUpload, extract, regenerate, getSolution, saveFields, runAgent, activeTemplate, AGENT_URL, AGENT_RUNS };
