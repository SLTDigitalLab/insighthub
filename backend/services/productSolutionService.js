const fs = require('fs');
const store = require('./templateStoreService');
const grids = require('./xlsxGridService');
const schemaSvc = require('./solutionSchemaService');
const voteSvc = require('./solutionVoteService');
const refService = require('./refService');
const proposalStorage = require('./proposalStorageService');
const docs = require('./proposalDocsService');
const solution = require('./solutionService');
const { PRODUCT_BY_ID } = require('./productCatalog');
const draftSvc = require('./draftService');
const { resolveRep, colomboDate } = draftSvc;
const structured = require('./structuredTextService');
const logoSvc = require('./proposalLogoService');
const { wording } = require('../proposal/renderSettings');
const { META_KEY } = require('./productSolutionRenderService');

// Product + Solution proposal: ONE proposal from the active combined template, the products the rep ticked and a quotation Excel.
//   upload  -> same pending-upload step as the solution proposal (solutionService.createUpload)
//   extract -> the active Product + Solution template's tags (read from the template at this moment, with the text around each tag), the
//              selected products and the sheet's cells go to the NEW n8n workflow (Product_Solution_Proposal_Agent.json);
//              it answers values keyed by the tags it was given, the customer name read from the Excel, the quotation reference and the
//              reference number built by its Code node. The backend only checks the answer against the tag schema, applies the
//              reference fallback, saves the proposal and renders it.
// Nothing here names a tag, a heading, a table column or a cell of the sheet. A tag added to / removed from a new template needs no change.

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';
const AGENT_URL = process.env.N8N_PRODUCT_SOLUTION_WEBHOOK_URL || `${N8N_BASE}/proposal-product-solution`;
// Parallel runs of the workflow that are voted on (solutionVoteService). One by default: the answer also holds written product text.
const AGENT_RUNS = Math.max(1, Math.min(5, Number(process.env.PRODUCT_SOLUTION_AGENT_RUNS) || 1));

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const clean = v => String(v == null ? '' : v).trim();
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function activeTemplate() {
  const entry = store.getActive(store.PS_TYPE);
  if (!entry) throw fail(409, 'There is no Product + Solution template yet. An admin needs to upload one on the Proposal Hub "Upload Latest Template" tab (Product + Solution template).');
  return entry;
}

// The selected products as the workflow gets them: what describes them, and their terms text to be copied (never invented)
function productsFor(productIds) {
  const seen = new Set();
  return (Array.isArray(productIds) ? productIds : []).filter(id => PRODUCT_BY_ID[id] && !seen.has(id) && seen.add(id)).map(id => {
    const p = PRODUCT_BY_ID[id];
    return { id: p.id, name: p.name, pillar: p.pillar, description: clean(p.proposalDescription || p.description), features: p.features, customerBenefits: p.customerBenefits, termsAndConditions: p.termsAndConditions };
  });
}


// The raw-XML tags the workflow named for the products' diagrams: only real top-level raw-XML tags of this template are kept
const diagramTagsOf = (schema, raw) => {
  const named = (Array.isArray(raw && raw.diagramTags) ? raw.diagramTags : []).map(String).filter((n, i, all) => all.indexOf(n) === i && schema.some(t => t.name === n && t.type === 'rawXml'));
  // the workflow did not name the diagram place: it is the template's raw-XML tag named for diagrams (the Product flow's diagrams block)
  return named.length ? named : schema.filter(t => t.type === 'rawXml' && /diagram/i.test(t.name)).map(t => t.name);
};

// The workflow's answer is sometimes not usable (truncated / malformed JSON, no values at all). It is asked again, up to AGENT_RETRIES more
// times; the raw text of every bad answer is logged. A partly filled answer is accepted as it is (a tag with no valid value stays empty);
// only an answer with no usable content at all counts as bad. Other errors (workflow unreachable) are not retried.
const AGENT_RETRIES = 2;
const hasContent = v => (Array.isArray(v) ? v.some(hasContent) : (isObj(v) ? Object.values(v).some(hasContent) : clean(v) !== ''));
async function askWithRetries(payload) {
  let lastErr;
  for (let attempt = 1; attempt <= 1 + AGENT_RETRIES; attempt++) {
    try {
      const raw = await solution.askAgent(payload, AGENT_URL, { refIsFatal: false });
      if (!hasContent(raw.values)) throw fail(502, 'The AI agent could not read this sheet (invalid_ai_output). Your Excel file is kept, so you can try again.', { retry: true, badOutput: true, invalidOutput: true, raw: 'no usable values in the answer' });
      return raw;
    } catch (err) {
      lastErr = err;
      if (!(err.invalidOutput || err.badOutput)) throw err;
      console.warn(`[productSolution] attempt ${attempt}/${1 + AGENT_RETRIES}: unusable workflow output (${err.message}); raw: ${String(err.raw == null ? '' : err.raw).slice(0, 2000)}`);
    }
  }
  throw lastErr;
}


// ---- The product parts: the same sections and content as the Product proposal ---------------------------------------------------
// "About You & How We Can Help You" = the introduction about the customer + the recommended products with their reasons, and "Proposed
// Solution" = the selected products (numbered title + description, diagrams) are produced by the Product flow (draftService.generate:
// the Product workflow for the AI text, the catalogue for the descriptions). They are reused here, not rewritten. The solution content
// the quotation Excel gave the workflow (its summary of the solution) goes in front of the product items of "Proposed Solution".
// The Product workflow failing never stops the proposal: the product items then come from the catalogue alone.
const PRIORITY_SUFFIX = wording.prioritySuffix;
const nameBits = p => [p.name, String(p.name || '').split(/\s*\(/)[0]].map(n => clean(n).toLowerCase()).filter(n => n.length >= 3);
// the paragraphs of the workflow's own text that do not talk about a selected product (those come from the Product flow now)
function withoutProductText(text, products) {
  const names = products.flatMap(nameBits);
  return clean(text).split(/\n+/).map(s => s.trim()).filter(Boolean).filter(par => !names.some(n => par.toLowerCase().includes(n))).join('\n\n');
}

async function productSections({ schema, products, productIds, customer, rep, values }) {
  const tags = schema.filter(structured.isStructuredTag);
  if (!tags.length) return {};
  let draft = null;
  if (clean(customer)) {
    try {
      draft = await draftSvc.generate({ business: { name: clean(customer) }, productIds, user: { name: rep.name, designation: rep.designation, phone: rep.phone, email: rep.email, division: rep.division } });
    } catch (err) { console.warn(`[productSolution] the Product flow could not write the product parts (${err && err.message}); using the catalogue only`); }
  }
  const f = (draft && draft.fields) || {};
  const recommended = (Array.isArray(f.recommendations) ? f.recommendations : []).filter(r => r && PRODUCT_BY_ID[r.id])
    .map(r => ({ title: `${PRODUCT_BY_ID[r.id].name}${r.highPriority ? PRIORITY_SUFFIX : ''}`, text: clean(r.reason) }));
  const selected = Array.isArray(f.requirements) && f.requirements.length
    ? f.requirements.map(r => ({ title: clean(r.title), text: clean(r.text) }))
    : products.map(p => ({ title: p.name, text: draftSvc.productText(PRODUCT_BY_ID[p.id] || p) }));
  const out = {};
  tags.forEach(tag => {
    const role = structured.roleOf(tag.name);
    const own = values && values[tag.name];
    const ownText = structured.isStructured(own) ? structured.toPlainText(own) : clean(own);
    if (role === 'about') out[tag.name] = { intro: clean(f.aboutDescription) || withoutProductText(ownText, products), items: recommended };
    else if (role === 'requirements') out[tag.name] = { intro: withoutProductText(ownText, products), items: selected };
  });
  return out;
}

// Asks the workflow (one or more parallel runs, voted) and checks the combined answer against the template's schema.
// A run that fails is left out of the vote; only if every run fails is the error raised. Never raises because of the reference.
async function runAgent({ grid, schema, rep, products, refNo, refRequest, today, template, runs = AGENT_RUNS }) {
  const payload = {
    mode: 'productSolution',
    grid,
    schema: schemaSvc.agentSchema(schema),
    products,
    user: { name: rep.name, phone: rep.phone, email: rep.email, designation: rep.designation, division: rep.division },
    ...(refNo ? { refNo } : (refRequest ? { refRequest } : {})),
    today,
    groupFlag: schemaSvc.GROUP_FLAG,
  };
  const settled = await Promise.all(Array.from({ length: runs }, async () => {
    try { return { ok: true, raw: await askWithRetries(payload) }; } catch (err) { return { ok: false, err }; }
  }));
  const good = settled.filter(r => r.ok);
  if (!good.length) throw settled[0].err;

  const voted = voteSvc.vote(good.map(r => r.raw), schema, grid);
  const refCandidates = good.map(r => clean(r.raw.refNo)).filter(Boolean);
  const workflowRef = ([...new Set(refCandidates)].sort((a, b) => refCandidates.filter(x => x === b).length - refCandidates.filter(x => x === a).length)[0]) || '';
  const result = schemaSvc.validate(schema, voted.raw, grid, [rep.phone, rep.email, workflowRef, today], rep, template && template.userSource);
  voted.disagreements.forEach(tag => result.warnings.push({ kind: 'row', path: tag, tag, row: null, column: null, value: '', reason: 'The runs of the AI agent disagreed on this table; please check its rows.' }));
  if (template && template.id) store.mergeUserSource(template.id, result.userSource);
  const meta = { diagramTags: diagramTagsOf(schema, { diagramTags: good.flatMap(r => (Array.isArray(r.raw.diagramTags) ? r.raw.diagramTags : [])) }) };
  return { ...result, refNo: workflowRef, workflowMeta: meta, quotationRef: clean(good[0].raw.quotationRef) };
}

// Sheet -> grid -> workflow -> checked values. Shared by the first generation and by Regenerate.
async function generate({ buffer, sheetName, user, productIds, refNo, template, customer }) {
  const schema = schemaSvc.buildSchema(template.tags);
  const grid = grids.buildGrid(buffer, sheetName);
  if (!grid.cells.length) throw fail(422, `The sheet "${sheetName}" has no filled cells.`);
  const products = productsFor(productIds);
  if (!products.length) throw fail(400, 'Select at least one product.');
  const rep = resolveRep(user);
  const section = refService.solutionSectionOf(rep.account);
  const result = await runAgent({
    grid, schema, rep, products, template, today: colomboDate(),
    ...(refNo ? { refNo } : (section ? { refRequest: { type: 'productSolution', ...section } } : {})),
  });
  // the product parts of the proposal, as the Product flow writes them; the customer is the one the workflow read from the Excel
  const sections = await productSections({ schema, products, productIds, customer: clean(result.meta && result.meta.customerName) || customer, rep, values: result.values });
  result.values = { ...result.values, ...sections };
  return { schema, grid, rep, products, result };
}

// The customer name of the proposal: only what the agent read from the Excel (there is no business step in this flow)
const customerOf = result => clean(result.meta && result.meta.customerName);

// The reference placeholder tag(s) print the saved reference; the picture meta (diagram tags, logo) rides along under __meta
function finish(schema, result, ref, previousMeta = {}) {
  const values = schemaSvc.applyReference(schema, result.values, ref, true, true); // strict: only the label right before a tag counts
  const meta = { ...result.workflowMeta };
  // No logo is looked up for the Excel customer: the logo tag stays empty (a proposal saved earlier keeps the logo it already had)
  if (previousMeta.leadLogo) meta.leadLogo = previousMeta.leadLogo;
  if (previousMeta.leadLogoSize) meta.leadLogoSize = previousMeta.leadLogoSize;
  return { ...values, [META_KEY]: meta };
}

async function extract({ uploadId, sheetName, user, productIds }) {
  const { id, meta, buffer } = solution.loadPending(uploadId);
  if (!meta.sheets.some(s => s.name === sheetName)) throw fail(400, 'Please choose one of the sheets of the uploaded workbook.');
  const template = activeTemplate();

  const { schema, grid, rep, products, result } = await generate({ buffer, sheetName, user, productIds, template });
  // The reference never stops a proposal: what the workflow built is used when it is valid; otherwise "SLTM-" / SLTM-<SEC>-<SUB>-SP (a warning is logged)
  let refNo = refService.resolveProductSolutionRef(rep.account, result.refNo);
  // The workflow found no Excel reference (short form SLTM-<SEC>-<SUB>-SP): look for a plain "Reference" / "Ref No" label with a value in the sheet
  const shortForm = refService.productSolutionFallbackRef(rep.account);
  if (shortForm !== 'SLTM-' && refNo === shortForm) {
    const found = refService.findQuotationRefInGrid(grid);
    const built = found ? refService.sanitizeProductSolutionRef(`${shortForm}${found}`) : '';
    if (built && refService.isFullProductSolutionRef(built) && !refService.find(built)) refNo = built;
  }
  const fields = finish(schema, result, refNo, {});

  const saved = proposalStorage.saveProposal({
    refNo,
    companyName: customerOf(result),
    fields,
    templateId: template.id,
    templateVersion: template.version,
    user: { name: rep.name, email: rep.email },
    products: products.map(({ id: pid, name }) => ({ id: pid, name })),
    proposalType: 'productSolution',
    solution: { sheetName, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing, generatedFields: fields, sourceName: meta.filename, notes: grid.notes, quotationRef: result.quotationRef },
  });
  const stored = docs.saveSource(docs.keyOf(saved), buffer);
  const proposal = proposalStorage.updateProposal(saved.id, p => ({ ...p, solution: { ...p.solution, sourceFile: stored } }));
  solution.removePending(id);
  return { proposal: docs.normalize(proposal), schema, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing };
}

function getProposal(id) {
  const proposal = proposalStorage.getProposalById(id);
  if (!proposal || proposal.proposalType !== 'productSolution') throw fail(404, 'Product + Solution proposal not found');
  const entry = (proposal.templateId && store.get(proposal.templateId)) || store.getActive(store.PS_TYPE);
  const schema = entry ? schemaSvc.buildSchema(entry.tags) : [];
  return { proposal, schema, logoPlace: !!(entry && Array.isArray(entry.logoPlaceholders) && entry.logoPlaceholders.length), logoField: logoSvc.logoFieldOf(entry, schema) };
}

const ownRefOf = proposal => refService.sanitizeProductSolutionRef(proposal.refNo);

// Runs the workflow again on the stored Excel, sheet and products of an existing proposal. The reference number, the status and
// the customer name the user may have typed are kept; the result is a new version.
async function regenerate(id, user) {
  const { proposal } = getProposal(id);
  docs.assertEditable(proposal); // Confirmed / Completed: view-only, checked before the workflow runs
  const abs = docs.sourcePath(docs.keyOf(proposal));
  if (!abs) throw fail(404, 'The original Excel file of this proposal was not found, so it cannot be regenerated.');
  const sheetName = proposal.solution && proposal.solution.sheetName;
  if (!sheetName) throw fail(409, 'This proposal does not remember which sheet it was made from.');
  const template = (proposal.templateId && store.get(proposal.templateId)) || activeTemplate();
  const productIds = (proposal.products || []).map(p => (typeof p === 'object' ? p.id : p)).filter(Boolean);
  const ownRef = ownRefOf(proposal);

  // the workflow is told the saved reference, so it only echoes it (an empty / short one stays as it is)
  const { schema, grid, result } = await generate({ buffer: fs.readFileSync(abs), sheetName, user, productIds, refNo: ownRef || 'SLTM-', template, customer: proposal.companyName });
  const previousMeta = isObj(proposal.fields && proposal.fields[META_KEY]) ? proposal.fields[META_KEY] : {};
  const fields = finish(schema, result, ownRef, previousMeta);
  const revised = proposalStorage.reviseProposal(docs.keyOf(proposal), p => ({
    ...p,
    fields,
    companyName: clean(p.companyName) || customerOf(result),
    templateId: template.id,
    templateVersion: template.version,
    solution: { ...p.solution, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing, generatedFields: fields, notes: grid.notes, regeneratedAt: new Date().toISOString() },
  }), { reason: 'revision', userEmail: (user && user.email) || '', force: true });
  return { proposal: revised && revised.proposal, schema, warnings: result.warnings, missing: result.missing, userMissing: result.userMissing };
}

// An edit from the editor. Only the template's tags are taken from the form; the picture meta stays as stored; the reference placeholder
// keeps the proposal's own reference. A new version is created only when the content really changed (proposalStorage.reviseProposal).
// logo: undefined = unchanged, '' = removed, a PNG / JPG data URL = the new customer logo (proposalLogoService.js)
function saveFields(id, { fields, companyName, logo }, userEmail = '') {
  const { proposal, schema } = getProposal(id);
  const stored = isObj(proposal.fields && proposal.fields[META_KEY]) ? proposal.fields[META_KEY] : null;
  const values = schemaSvc.applyReference(schema, schemaSvc.sanitize(schema, fields), ownRefOf(proposal), false, true);
  const meta = logoSvc.withLogo(stored, logo);
  if (logoSvc.hasKeys(meta)) values[META_KEY] = meta;
  const revised = proposalStorage.reviseProposal(docs.keyOf(proposal), p => ({
    ...p,
    fields: values,
    companyName: companyName != null ? clean(companyName) : p.companyName,
  }), { reason: 'edit', userEmail });
  return revised && revised.proposal;
}

module.exports = { extract, regenerate, getProposal, saveFields, runAgent, productSections, activeTemplate, productsFor, AGENT_URL, AGENT_RUNS };
