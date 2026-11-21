// The version history timeline of a proposal. Same rules as the backend (services/proposalDocsService.js buildSteps / stepRef):
//  - steps are the history events sorted by createdAt, then sequence
//  - the first is "Original"; every later step whose status is not Confirmed / Completed is V1, V2, V3...; Confirmed and Completed have no label
//  - the document reference of a step: Original and Confirmed / Completed = the base reference, Vn = <base>-Vn ("SLTM-V2" when the base ends with "-")

export const STATUS_ORDER = ['Draft', 'Sent', 'Revised', 'Revised & Sent', 'Confirmed', 'Completed'];
export const isFinalStatus = status => status === 'Confirmed' || status === 'Completed';

// The statuses a proposal can still be moved to: only those after the current one
export const nextStatuses = current => {
  const i = STATUS_ORDER.indexOf(current);
  return i < 0 ? [...STATUS_ORDER] : STATUS_ORDER.slice(i + 1);
};

const time = iso => Date.parse(iso) || 0;
export const sortHistory = list => [...(list || [])].sort((a, b) => time(a.createdAt) - time(b.createdAt) || (a.sequence || 0) - (b.sequence || 0));

// [{ event, label, number, finalStep, contentVersion, contentLabel }]
//   contentVersion: the content version the step shows (Confirmed / Completed: the last numbered step's)
//   contentLabel:   the earlier step the content is unchanged since (null when this step changed / created the content)
export function buildSteps(history) {
  const sorted = sortHistory(history);
  let n = 0;
  const steps = sorted.map((event, i) => {
    const finalStep = isFinalStatus(event.status);
    if (i > 0 && !finalStep) n += 1;
    return { event, label: i === 0 ? 'Original' : (finalStep ? '' : `V${n}`), number: i === 0 || finalStep ? 0 : n, finalStep, contentVersion: event.versionNumber, contentLabel: null };
  });
  steps.forEach((s, i) => {
    if (!s.finalStep) return;
    for (let k = i - 1; k >= 0; k--) if (!steps[k].finalStep) { s.contentVersion = steps[k].contentVersion; break; }
  });
  steps.forEach((s, i) => {
    const first = steps.findIndex(x => x.contentVersion === s.contentVersion);
    if (first >= 0 && first < i) s.contentLabel = steps[first].label || steps[first].event.status;
  });
  return steps;
}

export const baseRefOf = proposal => String((proposal && (proposal.refNo || (proposal.fields && proposal.fields.refNo))) || '').trim();

export function stepRef(base, step) {
  const b = String(base || '').trim();
  if (!b || !step || !step.number) return b;
  return b.endsWith('-') ? `${b}V${step.number}` : `${b}-V${step.number}`;
}

// What the step is called on screen: its label, or just the status for Confirmed / Completed
export const stepName = step => step.label || step.event.status;

// The current (latest) step of a proposal, from the history it carries
export const currentStepOf = proposal => { const s = buildSteps(proposal && proposal.statusHistory); return s[s.length - 1] || null; };

// Every document reference of a proposal (base, <base>-V1, ...): what the archive search matches
export const allRefsOf = proposal => {
  const base = baseRefOf(proposal);
  return [...new Set([base, ...buildSteps(proposal && proposal.statusHistory).map(s => stepRef(base, s))].filter(Boolean))];
};

// The ONE place that decides a proposal's current status: the latest history event (what the timeline shows), else its `status`, else Draft
export const currentStatusOf = proposal => {
  const step = currentStepOf(proposal);
  const status = step ? step.event.status : proposal && proposal.status;
  return STATUS_ORDER.includes(status) ? status : 'Draft';
};

// Which button an archive row shows in the Edit position: View (read-only) for Confirmed / Completed, Edit for every other status
export const rowActionOf = proposal => (isFinalStatus(currentStatusOf(proposal)) ? 'View' : 'Edit');
