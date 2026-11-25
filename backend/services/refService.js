const proposalStorage = require('./proposalStorageService');

// Proposal reference numbers are BUILT by the n8n proposal workflows (prefix, section, sub-section and suffix: random 8 digits for a
// product proposal, the quotation Excel's own reference for a solution proposal). This file only
//   - tells the workflow which section / sub-section the logged-in user belongs to,
//   - checks the reference the workflow returned (general shape, not a fixed prefix or section list),
//   - checks it is not already used by a saved proposal.
// Older references (SLT-12345678) are never rewritten; they are only compared when checking for duplicates.

// <prefix>-<section>-<sub-section>-<suffix>; the suffix may hold letters, digits, dots, dashes and underscores (same set the
// documents routes accept in a reference number: proposalDocsService.safeRefNo)
const REF_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });

// The section / sub-section of the logged-in user are read with solutionSectionOf (below); there is no fallback and no error when
// they are missing: the proposal just has no reference number.

const isValid = ref => typeof ref === 'string' && REF_PATTERN.test(ref);

function find(ref) {
  const wanted = String(ref || '').trim().toLowerCase();
  return proposalStorage.getAllProposals().find(p => String(p.refNo || '').toLowerCase() === wanted) || null;
}

// ---- Solution proposals -------------------------------------------------------------------------------------------------
// A solution reference is SLTM-<section>-<sub-section>-<quotation ref from the Excel>, or "" - never anything else. The reference
// never blocks a proposal: when any part is missing the proposal simply has no reference.
// Three valid forms: SLTM-<SEC>-<SUB>-<quotation ref> (full), SLTM-<SEC>-<SUB>- (no usable Excel ref) and exactly SLTM- (no section / sub-section)
const SOLUTION_REF_PATTERN = /^SLTM-(?:[A-Z0-9]+-[A-Z0-9]+-[A-Za-z0-9._-]*)?$/;

// "" unless `ref` has one of the three solution forms (the last safety net before a reference is stored or printed)
const sanitizeSolutionRef = ref => { const r = String(ref == null ? '' : ref).trim(); return SOLUTION_REF_PATTERN.test(r) ? r : ''; };

// The VALUE of a quotation reference as read from the Excel, made safe for use as the end of the reference: label prefixes
// ("PR:", "PR -", "Ref:", "Ref No:", "Quotation No:", "Quote #") are removed, slashes and spaces become "-", every other character
// except letters, digits, "." "_" "-" is dropped. "" when nothing usable is left (e.g. it was only "PR:").
const LABEL_PREFIX = /^\s*(?:(?:quotation|quote|proposal|reference|ref|pr)\b\s*(?:no\.?|number|num\.?|#)?\s*[:#\-.]*\s*)+/i;
function cleanQuotationRef(raw) {
  let v = String(raw == null ? '' : raw).trim();
  for (let i = 0; i < 4; i++) { const next = v.replace(LABEL_PREFIX, ''); if (next === v) break; v = next; }
  v = v.replace(/^[\s:#.\-]+/, '');
  v = v.replace(/[\s/\\]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '');
  return v;
}

// Safety net for when the AI agent returned no quotation reference: the VALUE next to a label cell that is only "Reference", "Ref No",
// "Quotation No" ... (cell to the right, else the cell below). A bare "PR:" label is not looked at: the agent already handles it, and an
// empty "PR:" cell must not hide a filled "Reference :" row. "" when nothing usable is found.
const REF_LABEL_CELL = /^\s*(?:quotation|quote|proposal)?\s*ref(?:erence)?\.?\s*(?:no\.?|number|num\.?|#)?\s*[:#.\-]*\s*$/i;
function findQuotationRefInGrid(grid) {
  const cells = (grid && grid.cells) || [];
  const at = (row, col) => cells.find(c => c.row === row && c.col === col);
  for (const c of cells) {
    if (typeof c.value !== 'string' || !REF_LABEL_CELL.test(c.value)) continue;
    for (const n of [at(c.row, c.col + 1), at(c.row + 1, c.col)]) {
      if (!n || n.value === '' || n.value == null) continue;
      const q = cleanQuotationRef(n.value);
      if (q) return q;
    }
  }
  return '';
}

// { section, subSection } of the account exactly as stored (upper case, letters and digits only); null when either is missing.
// No testing fallback here: a user without them gets a proposal with no reference.
function solutionSectionOf(account) {
  const acc = account || {};
  const norm = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const section = norm(acc.section);
  const subSection = norm(acc.subSection || acc.rebmArea);
  return section && subSection ? { section, subSection } : null;
}

// SLTM-<SEC>-<SUB>-<cleaned quotation ref>; SLTM-<SEC>-<SUB>- when nothing usable is left of the Excel ref; exactly "SLTM-" when the
// section or sub-section is missing. Never "".
function buildSolutionRef(section, subSection, quotationRef) {
  const s = String(section || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sub = String(subSection || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s || !sub) return 'SLTM-';
  return sanitizeSolutionRef(`SLTM-${s}-${sub}-${cleanQuotationRef(quotationRef)}`) || `SLTM-${s}-${sub}-`;
}

// Never throws and never returns anything but a valid solution reference. Any problem is logged and gives SLTM-<SEC>-<SUB>- when the
// account's section / sub-section are known, else "SLTM-".
function safeSolutionRef(account, quotationRef) {
  let fallback = 'SLTM-';
  try {
    const sec = solutionSectionOf(account);
    if (sec) fallback = `SLTM-${sec.section}-${sec.subSection}-`;
    const ref = module.exports.buildSolutionRef(sec && sec.section, sec && sec.subSection, quotationRef);
    if (SOLUTION_REF_PATTERN.test(ref)) return ref;
    console.warn(`[refService] generated solution reference "${ref}" is malformed; using "${fallback}"`);
  } catch (e) {
    console.warn(`[refService] solution reference generation failed (${e && e.message}); using "${fallback}"`);
  }
  return fallback;
}

// ---- Product proposals ----------------------------------------------------------------------------------------------------
// SLTM-<section>-<sub-section>-<8 random digits>, built here (never by the AI / workflow) once, when the proposal is created. A user with
// no section or sub-section gets exactly "SLTM-". Both forms are valid references; neither is ever blanked or rejected.
const PRODUCT_REF_PATTERN = /^SLTM-(?:[A-Z0-9]+-[A-Z0-9]+-[0-9]{8})?$/;
const PRODUCT_REF_RETRIES = 10;
const BARE_PRODUCT_REF = 'SLTM-';

// 10000000-99999999, from the OS random source
const randomEightDigits = () => require('crypto').randomInt(10000000, 100000000);

// The reference for a new product proposal of this account. A full reference is checked against the stored proposals and drawn again
// (up to 10 times) on a collision; "SLTM-" is never checked. Returns "SLTM-" when the account has no section / sub-section or when every
// retry collided. May throw: callers use safeProductRef.
function buildProductRef(account) {
  const sec = solutionSectionOf(account);
  if (!sec) return BARE_PRODUCT_REF;
  for (let i = 0; i < PRODUCT_REF_RETRIES; i++) {
    const ref = `SLTM-${sec.section}-${sec.subSection}-${module.exports.randomEightDigits()}`;
    if (!PRODUCT_REF_PATTERN.test(ref)) continue;
    if (!module.exports.find(ref)) return ref;
  }
  console.warn(`[refService] no free reference number after ${PRODUCT_REF_RETRIES} tries for ${sec.section}-${sec.subSection}; using "SLTM-"`);
  return BARE_PRODUCT_REF;
}

// Never throws and never returns anything but a valid product reference: any problem is logged and gives "SLTM-"
function safeProductRef(account) {
  try {
    const ref = module.exports.buildProductRef(account);
    if (PRODUCT_REF_PATTERN.test(ref)) return ref;
    console.warn(`[refService] generated reference "${ref}" is malformed; using "SLTM-"`);
  } catch (e) {
    console.warn(`[refService] reference generation failed (${e && e.message}); using "SLTM-"`);
  }
  return BARE_PRODUCT_REF;
}

// ---- Product + Solution proposals -----------------------------------------------------------------------------------------------
// The reference is BUILT by the new n8n workflow (a Code node): SLTM-<SEC>-<SUB>-SP<cleaned Excel ref> (no dash between SP and the ref),
// SLTM-<SEC>-<SUB>-SP when the Excel has no usable ref, exactly "SLTM-" for a user without section / sub-section. This file only checks
// what the workflow returned and, when that is missing / invalid / unusable, builds the SAME fallback (never the Excel part). It never throws.
const PS_REF_PATTERN = /^SLTM-(?:[A-Z0-9]+-[A-Z0-9]+-SP[A-Za-z0-9._-]*)?$/;
const sanitizeProductSolutionRef = ref => { const r = String(ref == null ? '' : ref).trim(); return PS_REF_PATTERN.test(r) ? r : ''; };

// "SLTM-" or SLTM-<SEC>-<SUB>-SP, from the account's section / sub-section
function productSolutionFallbackRef(account) {
  const sec = solutionSectionOf(account);
  return sec ? `SLTM-${sec.section}-${sec.subSection}-SP` : 'SLTM-';
}

// A full reference carries the Excel part after "SP"; "SLTM-" and SLTM-<SEC>-<SUB>-SP are the short forms
const isFullProductSolutionRef = ref => /^SLTM-[A-Z0-9]+-[A-Z0-9]+-SP[A-Za-z0-9._-]+$/.test(String(ref || ''));

// The reference to keep for a new proposal: what the workflow returned when it is valid, fits this account's section / sub-section and is
// not already used by another proposal; otherwise the fallback (a warning says why). Never throws, never returns anything but a valid form.
function resolveProductSolutionRef(account, workflowRef) {
  const fallback = productSolutionFallbackRef(account);
  try {
    const ref = sanitizeProductSolutionRef(workflowRef);
    const why = (() => {
      if (!String(workflowRef == null ? '' : workflowRef).trim()) return 'the workflow returned no reference number';
      if (!ref) return `the workflow's reference number "${workflowRef}" is not valid`;
      if (ref !== fallback && !(fallback !== 'SLTM-' && ref.startsWith(fallback))) return `the workflow's reference number "${ref}" does not match this user's section / sub-section`;
      if (isFullProductSolutionRef(ref) && module.exports.find(ref)) return `reference number ${ref} is already used`;
      return '';
    })();
    if (!why) return ref;
    console.warn(`[refService] Product + Solution reference: ${why}; using "${fallback}"`);
  } catch (e) {
    console.warn(`[refService] Product + Solution reference check failed (${e && e.message}); using "${fallback}"`);
  }
  return fallback;
}

module.exports = { PS_REF_PATTERN, sanitizeProductSolutionRef, productSolutionFallbackRef, isFullProductSolutionRef, resolveProductSolutionRef, PRODUCT_REF_PATTERN, BARE_PRODUCT_REF, randomEightDigits, buildProductRef, safeProductRef, isValid, find, fail, REF_PATTERN, SOLUTION_REF_PATTERN, sanitizeSolutionRef, cleanQuotationRef, findQuotationRefInGrid, solutionSectionOf, buildSolutionRef, safeSolutionRef };
