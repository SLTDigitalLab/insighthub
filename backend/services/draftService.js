const axios = require('axios');
const userService = require('./userService');
const refService = require('./refService');
const { PRODUCTS, PRODUCT_BY_ID } = require('./productCatalog');
const { FIELDS } = require('../proposal/fieldSchema');
const { termsOf } = require('./termsService');
const { locale } = require('../proposal/renderSettings');

// Step 1 of the generator: build the `fields` object the edit screen shows, from the field schema (proposal/fieldSchema.js).
//   ai fields     -> asked from the n8n "Proposal v2" workflow (values keyed by field key)
//   system fields -> filled here from their `source`
//   rep fields    -> left empty (prices etc.)
// No field name or proposal wording is written in this file; text comes from the product catalogue, the company, the rep and the AI.

const N8N_BASE = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';
// A separate webhook from the old flow's N8N_PROPOSAL_WEBHOOK_URL, so both workflows can be live at once
const N8N_DRAFT_URL = process.env.N8N_PROPOSAL_V2_WEBHOOK_URL || `${N8N_BASE}/proposal-v2`;
const MAX_RECOMMENDATIONS = 5;

const clean = v => String(v == null ? '' : v).trim();

// "23 OCT 2026" in Sri Lanka time
function colomboDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: locale.timeZone, day: '2-digit', month: 'short', year: 'numeric' })
    .formatToParts(d).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${parts.day} ${parts.month} ${parts.year}`.toUpperCase();
}

// Logged-in rep: what the browser sent wins, anything missing comes from the approved account, otherwise stays empty
function resolveRep(sent = {}) {
  const email = clean(sent.email);
  const found = email ? userService.getUserByEmail(email) : null;
  const account = found && found.status === 'approved' ? found : {};
  return {
    name: clean(sent.name) || clean(account.name),
    designation: clean(sent.designation) || clean(account.designation),
    phone: clean(sent.phone) || clean(account.mobileNumber),
    email,
    division: clean(sent.division) || clean(account.department) || clean(account.rebmArea),
    account,
  };
}

// "No 12, Galle Road, Colombo 03, Sri Lanka" -> street part(s) / town / last part, split only at commas
function splitAddress(address) {
  const parts = clean(address).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { addressLine1: '', addressLine2: '', city: '' };
  if (parts.length === 1) return { addressLine1: '', addressLine2: '', city: parts[0] };
  if (parts.length === 2) return { addressLine1: `${parts[0]},`, addressLine2: '', city: parts[1] };
  return { addressLine1: `${parts.slice(0, -2).join(', ')},`, addressLine2: `${parts[parts.length - 2]},`, city: parts[parts.length - 1] };
}

// Town of the address ("Kandy 20000, Sri Lanka" -> "Kandy") for the station column
function localityOf(address) {
  const parts = clean(address).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length && parts[parts.length - 1].toLowerCase().includes(locale.country.toLowerCase())) parts.pop();
  return parts.length ? parts[parts.length - 1].replace(/\s*\d{5}$/, '') : '';
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function logoOf(business) {
  const direct = clean(business.leadLogo || business.logo || business.logoUrl);
  if (direct) return direct;
  const domain = clean(business.website).replace(/https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
  return domain.includes('.') ? `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128` : '';
}

// products.json cuts some proposalDescription values at 180 characters and ends them with "..." - the catalogue's full
// `description` is used for those. If every text is cut, it is shortened to its last whole sentence (or word); never "..." or "…".
const CUT = /(\.\.\.|…)\s*$/;
function productText(p) {
  const short = clean(p.proposalDescription);
  const full = clean(p.description);
  if (short && !CUT.test(short)) return short;
  if (full && !CUT.test(full)) return full;
  const text = (full.length > short.length ? full : short).replace(CUT, '').trim();
  const sentence = text.match(/^[\s\S]*[.!?](?=\s|$)/);
  return sentence ? sentence[0] : text.replace(/\s+\S*$/, '');
}

// source name (stored in the field schema) -> value. `product` is set for per-row sources.
function resolveSource(source, ctx, product) {
  if (!source) return '';
  switch (source) {
    case 'true': return true;
    case 'refNo': return ctx.refNo;
    case 'today': return ctx.today;
    case 'rep.name': case 'rep.designation': case 'rep.phone': case 'rep.email': case 'rep.division': return ctx.rep[source.slice(4)];
    case 'company.name': return clean(ctx.business.name);
    case 'company.address': return clean(ctx.business.address);
    case 'company.logo': return logoOf(ctx.business);
    case 'company.addressLine1': return ctx.address.addressLine1;
    case 'company.addressLine2': return ctx.address.addressLine2;
    case 'company.city': return ctx.address.city;
    case 'company.locality': return clean(ctx.business.city) || localityOf(ctx.business.address);
    case 'products.names': return joinNames(ctx.products.map(p => clean(p.name)));
    case 'product.terms': return product ? termsOf(product) : '';
    case 'catalog.intro1': return ctx.products.length ? productText(ctx.products[0]) : '';
    case 'catalog.intro2': return ctx.products.slice(1).map(productText).filter(Boolean).join('\n\n');
    case 'product.id': return product ? product.id : '';
    case 'product.name': return product ? clean(product.name) : '';
    case 'product.service': return product ? clean(product.service) : '';
    case 'product.accessMedia': return product ? clean(product.accessMedia) : '';
    case 'product.ntu': return product ? clean(product.ntu) : '';
    case 'product.description': return product ? productText(product) : '';
    default: return '';
  }
}

const aiFields = () => FIELDS.filter(f => f.owner === 'ai');

async function askAi(payload) {
  try {
    const { data } = await axios.post(N8N_DRAFT_URL, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
    const body = Array.isArray(data) ? data[0] : data;
    if (!body || typeof body !== 'object') return { error: 'The AI workflow returned an empty response.' };
    if (body.error) return { error: `AI workflow error: ${body.error}` };
    return { values: body.values && typeof body.values === 'object' ? body.values : body, refNo: clean(body.refNo) };
  } catch (err) {
    return { error: `AI workflow call failed: ${err.response ? `HTTP ${err.response.status}` : err.message}` };
  }
}

const asText = v => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''));

function rowFor(field, ctx, product, aiRow = {}) {
  const row = {};
  field.columns.forEach(c => {
    if (c.computed) return;
    if (c.source) row[c.key] = resolveSource(c.source, ctx, product);
    else row[c.key] = c.key === 'showFeatures' || c.key === 'highPriority' ? false : '';
    if (field.owner === 'ai' && asText(aiRow[c.key])) row[c.key] = asText(aiRow[c.key]);
  });
  return row;
}

function tableValue(field, ctx, aiValue) {
  if (field.key === 'recommendations') {
    // AI picks catalogue products; ids that are not in the catalogue are dropped
    return (Array.isArray(aiValue) ? aiValue : [])
      .filter(r => r && PRODUCT_BY_ID[r.id])
      .slice(0, MAX_RECOMMENDATIONS)
      .map(r => ({ id: r.id, reason: asText(r.reason), highPriority: r.highPriority === true }));
  }
  const ai = Array.isArray(aiValue) ? aiValue : [];
  return ctx.products.map((p, i) => rowFor(field, ctx, p, ai[i] && typeof ai[i] === 'object' ? ai[i] : {}));
}

// Returns { fields, refFromSection, notes, aiError? }. Throws { status, message } for bad input.
async function generate({ business, productIds, user, agentContext }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!business || typeof business !== 'object' || !clean(business.name)) throw fail(400, 'business.name is required');
  const products = (Array.isArray(productIds) ? productIds : []).map(id => PRODUCT_BY_ID[id]).filter(Boolean);
  if (!products.length) throw fail(400, 'Select at least one product');

  const rep = resolveRep(user);
  // The reference number is built HERE, once, for this new proposal: SLTM-<section>-<sub-section>-<8 digits>, or exactly "SLTM-" for a user
  // without a section / sub-section. Nothing the workflow or the AI returns is used, and nothing here can raise an error.
  const refNo = refService.safeProductRef(rep.account);
  const section = refService.solutionSectionOf(rep.account);

  const wanted = aiFields();
  const payload = {
    aiFields: wanted.map(({ key, label, type, columns, hint }) => ({ key, label, type, hint: hint || '', ...(columns ? { columns: columns.map(c => ({ key: c.key, label: c.label })) } : {}) })),
    company: { name: clean(business.name), address: clean(business.address), city: clean(business.city), category: clean(business.category), website: clean(business.website), overview: clean(business.overview) },
    products: products.map(({ id, name, description, proposalDescription, features }) => ({ id, name, description: clean(proposalDescription || description), features })),
    catalogue: PRODUCTS.map(({ id, name, pillar }) => ({ id, name, pillar })),
    rep: { name: rep.name, designation: rep.designation },
    // Sent for the workflow's information only: the reference it may return is ignored
    ...(section ? { refRequest: { type: 'product', section: section.section, subSection: section.subSection } } : {}),
    ...(agentContext ? { agentContext } : {}),
  };

  // The workflow gives the AI-written values only; any reference number it returns is ignored.
  const ai = await askAi(payload);
  if (ai.error) throw fail(502, ai.error); // the AI workflow itself failed (not the reference)
  const ctx = { business, products, rep, refNo, today: colomboDate(), address: splitAddress(business.address) };
  const aiValues = ai.values;
  const aiError = '';

  const fields = {};
  FIELDS.forEach(f => {
    if (f.key === 'diagrams') return; // derived from the selected products when the document is rendered
    if (f.type === 'table') fields[f.key] = tableValue(f, ctx, aiValues[f.key]);
    else if (f.owner === 'ai') fields[f.key] = asText(aiValues[f.key]);
    else fields[f.key] = f.source ? resolveSource(f.source, ctx) : '';
  });

  const notes = aiError ? [`${aiError} The AI-written fields were left empty.`] : [];
  return { fields, refFromSection: !!refNo, notes, ...(aiError ? { aiError } : {}) };
}

module.exports = { generate, colomboDate, resolveRep, productText };
