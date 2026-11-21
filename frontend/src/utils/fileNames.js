// File names for downloaded proposals. The reference number is optional: it is used only when it is a clean one, and a missing,
// empty or junk reference ("PR:", "undefined", "null") never ends up in a name. Characters that are invalid in file names
// (: / \ * ? " < > |) are removed.

const clean = v => {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
  return /^(undefined|null)$/i.test(s) ? '' : s;
};

// The reference as a name part, '' unless it is a clean reference
export const fileRef = (refNo) => {
  const r = String(refNo || '').trim();
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(r) && !/^(pr|ref|no|null|undefined)$/i.test(r) ? r : '';
};

// Product + Solution proposals: a reference that stops at "SP" (the Excel had no usable reference) is a short form, like "SLTM-", and is not
// used in a file name; only a full reference is
export const productSolutionFileRef = (refNo) => { const r = fileRef(refNo); return r && !/-SP$/.test(r) ? r : ''; };

// proposalFileName([ref, customer, 'Solution'], 'docx') -> "SLTM-REBM-WPE-2026-0451_ACME_Ltd_Solution.docx"; empty parts are left out
export const proposalFileName = (parts, ext) => `${parts.map(clean).filter(Boolean).join('_') || 'Proposal'}.${ext}`;
