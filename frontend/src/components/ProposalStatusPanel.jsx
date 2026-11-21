import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Upload, Download, X, AlertCircle, FileText } from 'lucide-react';
import { getProposalHistory, updateProposalStatus, uploadHistoryDocument, downloadProposalDocument } from '../api';
import ProposalVersionView from './ProposalVersionView';
import { STATUS_ORDER, buildSteps, baseRefOf, stepRef, stepName, nextStatuses } from '../utils/proposalSteps';

// Expanded row of the Generated Proposals Archive: version/status graph + status update with document uploads.

export const STATUS_OPTIONS = STATUS_ORDER; // Draft → Sent → Revised → Revised & Sent → Confirmed → Completed

const NODE_COLORS = {
  'Draft': { dot: '#94a3b8', bg: '#f1f5f9', fg: '#475569' },
  'Sent': { dot: '#2563eb', bg: '#dbeafe', fg: '#1d4ed8' },
  'Revised': { dot: '#f59e0b', bg: '#fef3c7', fg: '#b45309' },
  'Revised & Sent': { dot: '#ea580c', bg: '#ffedd5', fg: '#c2410c' },
  'Confirmed': { dot: '#22c55e', bg: '#dcfce7', fg: '#15803d' },
  'Completed': { dot: '#166534', bg: '#166534', fg: '#ffffff' },
};

const DOC_SLOTS = {
  'Confirmed': [
    { type: 'customerConfirmation', label: 'Customer Confirmation' },
    { type: 'creditApproval', label: 'Credit Approval' },
    { type: 'singleSourceApproval', label: 'Single Source Approval' },
  ],
  'Completed': [{ type: 'uat', label: 'UAT' }],
};
const SLOT_LABELS = Object.fromEntries([...DOC_SLOTS.Confirmed, ...DOC_SLOTS.Completed].map(s => [s.type, s.label]));
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const DOC_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
const ACCEPT = DOC_EXTS.map(e => `.${e}`).join(',');
const NOTE_MAX = 500;
const NODE_WIDTH = 176;

// Steps (utils/proposalSteps.js): sorted by createdAt then sequence; the first is "Original", then V1, V2, V3... Confirmed and Completed
// steps have no label (the node shows only the status).

const errMsg = (err, fallback) => (err && err.response && err.response.data && err.response.data.error) || fallback;
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '—' : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };

function checkFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!DOC_EXTS.includes(ext)) return 'Only PDF, DOC, DOCX, JPG and PNG files are allowed.';
  if (file.size > DOC_MAX_BYTES) return 'File is larger than 10 MB.';
  return null;
}

const smallBtn = { padding: '4px 9px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#334155' };
const blueBtn = { ...smallBtn, background: '#eff6ff', color: '#0284c7', borderColor: '#bfdbfe' };
const redBtn = { ...smallBtn, background: '#fef2f2', color: '#ef4444', borderColor: '#fecaca', padding: '4px 6px' };

export default function ProposalStatusPanel({ proposal, userEmail, onChanged, onEdit, showToast }) {
  const refNo = proposal.id; // proposals are always addressed by their id; the reference number is optional
  const [viewId, setViewId] = useState(null); // id of the step open in the read-only view
  const [hoverId, setHoverId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [rawHistory, setHistory] = useState(Array.isArray(proposal.statusHistory) ? proposal.statusHistory : []);
  const steps = useMemo(() => buildSteps(rawHistory), [rawHistory]);
  const history = useMemo(() => steps.map(s => s.event), [steps]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(''); // the status picked in the form ('' = none picked yet)
  const [note, setNote] = useState('');
  const [files, setFiles] = useState({}); // docType -> File picked for the status being saved
  const [saving, setSaving] = useState(false);
  const [busyDoc, setBusyDoc] = useState(null);
  const scroller = useRef(null);

  const apply = (nextHistory, nextStatus) => {
    setHistory(nextHistory);
    if (onChanged) onChanged(refNo, nextStatus, nextHistory);
  };

  useEffect(() => {
    let alive = true;
    getProposalHistory(refNo, userEmail)
      .then(d => { if (alive) setHistory(d.history || []); })
      .catch(err => showToast && showToast(errMsg(err, 'Could not load status history.'), 'error'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refNo]);

  // When the history is wider than the panel, scroll so the CURRENT (last) step is visible; never past the start, so the first step is not cut off
  useEffect(() => {
    const el = scroller.current;
    const node = el && el.querySelector('li[data-current="true"]');
    if (!el || !node) return;
    el.scrollLeft = Math.max(0, Math.min(node.offsetLeft - (el.clientWidth - node.offsetWidth) / 2, el.scrollWidth - el.clientWidth));
  }, [history.length, loading]);

  const latest = history[history.length - 1];
  const viewIdx = viewId == null ? -1 : history.findIndex(e => e.id === viewId);
  const currentStatus = latest ? latest.status : proposal.status || 'Draft';
  const allowedNext = nextStatuses(currentStatus); // only the statuses after the current one
  const baseRef = baseRefOf(proposal);
  // No status picked: manage the current entry's documents (Confirmed: the three approvals, Completed: UAT) instead of queueing new ones
  const editingCurrent = !!latest && !status;
  const slots = DOC_SLOTS[editingCurrent ? currentStatus : status] || [];
  const missing = slots.filter(s => (editingCurrent ? !(latest.documents || {})[s.type] : !files[s.type])).length;

  const pick = (docType, file) => {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) return showToast && showToast(problem, 'error');
    setFiles(prev => ({ ...prev, [docType]: file }));
  };

  const onStatusSelect = value => { setStatus(value); setFiles({}); };

  const openDoc = async doc => {
    try {
      const blob = await downloadProposalDocument(refNo, doc.id, userEmail);
      const url = window.URL.createObjectURL(new Blob([blob], { type: doc.mimeType }));
      const viewable = /^(application\/pdf|image\/)/.test(doc.mimeType || '');
      const win = viewable ? window.open(url, '_blank') : null;
      if (!win) {
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', doc.originalName || doc.docType);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      showToast && showToast('Failed to open document.', 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await updateProposalStatus(refNo, { status, note: note.trim(), files }, userEmail);
      apply(data.history, data.status);
      setNote('');
      setFiles({});
      setStatus('');
      showToast && showToast(`Status set to ${data.status}.`);
    } catch (err) {
      showToast && showToast(errMsg(err, 'Failed to update status.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const replaceCurrentDoc = async (docType, file) => {
    if (!file || !latest) return;
    const problem = checkFile(file);
    if (problem) return showToast && showToast(problem, 'error');
    setBusyDoc(docType);
    try {
      const data = await uploadHistoryDocument(refNo, latest.id, docType, file, userEmail);
      apply(data.history, data.status);
      showToast && showToast('Document uploaded.');
    } catch (err) {
      showToast && showToast(errMsg(err, 'Upload failed.'), 'error');
    } finally {
      setBusyDoc(null);
    }
  };

  const filePicker = (docType, label) => (
    <label style={{ ...blueBtn, opacity: saving || busyDoc === docType ? 0.6 : 1 }}>
      {busyDoc === docType ? <RefreshCw size={12} className="spin" /> : <Upload size={12} />} {label}
      <input type="file" hidden disabled={saving || busyDoc === docType} accept={ACCEPT}
        onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (editingCurrent) replaceCurrentDoc(docType, f); else pick(docType, f); }} />
    </label>
  );

  return (
    <div style={{ padding: '16px 20px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', cursor: 'default' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0B2A6F', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
        Version history
      </div>

      {/* Graph: nodes on a line, oldest -> newest; scrolls horizontally inside the panel */}
      <div ref={scroller} style={{ overflowX: 'auto', padding: '4px 8px 8px', maxWidth: '100%' }}>
        {loading && history.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '0.85rem', padding: '12px 0' }}><RefreshCw size={14} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} />Loading history...</div>
        ) : (
          <ol style={{ display: 'flex', listStyle: 'none', margin: 0, padding: 0, width: 'max-content' }}>
            {steps.map((st, i) => {
              const h = st.event;
              const c = NODE_COLORS[h.status] || NODE_COLORS.Draft;
              const isCurrent = i === history.length - 1;
              const docs = Object.values(h.documents || {});
              const line = { position: 'absolute', top: 13, height: 3, background: '#cbd5e1' };
              const hot = hoverId === h.id || focusId === h.id;
              const label = stepName(st);
              const open = () => setViewId(h.id);
              return (
                <li key={h.id} data-current={isCurrent ? 'true' : 'false'} style={{ position: 'relative', flex: `0 0 ${NODE_WIDTH}px`, width: NODE_WIDTH, padding: '0 6px', boxSizing: 'border-box' }}>
                  {i > 0 && <span style={{ ...line, left: 0, width: '50%' }} />}
                  {i < history.length - 1 && <span style={{ ...line, left: '50%', width: '50%' }} />}
                  {/* The node and its card open that version (read-only view); clickable and keyboard accessible */}
                  <div role="button" tabIndex={0} aria-label={`Open ${label}, ${h.status}, ${fmtDate(h.createdAt)}`}
                    onClick={open}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
                    onMouseEnter={() => setHoverId(h.id)} onMouseLeave={() => setHoverId(null)}
                    onFocus={() => setFocusId(h.id)} onBlur={() => setFocusId(null)}
                    style={{ position: 'relative', cursor: 'pointer', outline: 'none', borderRadius: 10 }}>
                  <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                    <span style={{ minWidth: 30, height: 30, padding: '0 8px', boxSizing: 'border-box', borderRadius: 15, background: c.dot, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, boxShadow: isCurrent ? `0 0 0 4px ${c.dot}33` : hot ? `0 0 0 3px ${c.dot}33` : 'none', border: isCurrent ? '2px solid #fff' : '2px solid #f8fafc', transform: hot ? 'scale(1.08)' : 'none', transition: 'transform 0.12s ease' }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ background: hot ? '#f8fbff' : '#fff', border: `1px solid ${isCurrent || hot ? c.dot : '#e2e8f0'}`, borderRadius: 8, padding: '8px 10px', fontSize: '0.74rem', color: '#475569', boxShadow: isCurrent || hot ? '0 2px 8px rgba(15,23,42,0.08)' : 'none', minHeight: 84, outline: focusId === h.id ? `2px solid ${c.dot}` : 'none', outlineOffset: 2, transition: 'background 0.12s ease' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 4 }}>
                      <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 999, fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{h.status}</span>
                      {isCurrent && <span style={{ fontSize: '0.64rem', fontWeight: 800, color: c.dot === '#94a3b8' ? '#475569' : c.dot, textTransform: 'uppercase' }}>Current</span>}
                    </div>
                    <div style={{ color: '#64748b' }}>{fmtDate(h.createdAt)}</div>
                    <div style={{ color: '#64748b', wordBreak: 'break-all' }} title={h.userEmail}>{h.userEmail || '—'}</div>
                    {h.note && <div style={{ marginTop: 4, color: '#334155', fontStyle: 'italic', wordBreak: 'break-word' }}>“{h.note}”</div>}
                    {docs.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {docs.map(d => (
                          <button key={d.id} type="button" onClick={e => { e.stopPropagation(); openDoc(d); }} title={`${d.originalName} — click to view / download`}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left', maxWidth: '100%' }}>
                            <FileText size={11} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SLOT_LABELS[d.docType] || d.docType}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Update status */}
      <div style={{ marginTop: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0B2A6F', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Update status</div>
        {currentStatus === 'Completed' ? (
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#166534' }}>Completed — final</div>
        ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
            Status
            <select value={status} disabled={saving} onChange={e => onStatusSelect(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff', minWidth: 160 }}>
              <option value="">Select next status…</option>
              {allowedNext.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', fontWeight: 700, color: '#475569', flex: '1 1 220px' }}>
            Note (optional)
            <input type="text" value={note} maxLength={NOTE_MAX} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="e.g. Sent to customer by email"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
          </label>
          <button type="button" onClick={save} disabled={saving || loading || !status}
            style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#0284c7', color: '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: saving ? 'default' : 'pointer', opacity: saving || !status ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {saving && <RefreshCw size={13} className="spin" />} Save
          </button>
        </div>
        )}

        {slots.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              {editingCurrent ? `Documents for the current status (${[stepName(steps[steps.length - 1]), currentStatus].filter((v, k, a) => a.indexOf(v) === k).join(' ')}) — changes upload immediately` : `Documents for ${status} (PDF, DOC, DOCX, PNG or JPG, up to 10 MB)`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
              {slots.map(s => {
                const saved = editingCurrent ? (latest.documents || {})[s.type] : null;
                const picked = editingCurrent ? null : files[s.type];
                return (
                  <div key={s.type} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px' }}>
                    <div style={{ fontWeight: 700, color: '#0B2A6F', fontSize: '0.84rem', marginBottom: 6 }}>{s.label}</div>
                    {(saved || picked) && (
                      <div style={{ fontSize: '0.76rem', color: '#475569', marginBottom: 7, wordBreak: 'break-all' }}>
                        {saved ? `${saved.originalName} · ${fmtDate(saved.uploadedAt)}` : picked.name}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {filePicker(s.type, saved || picked ? 'Replace' : 'Upload')}
                      {saved && <button type="button" onClick={() => openDoc(saved)} style={smallBtn}><Download size={12} /> View / Download</button>}
                      {picked && <button type="button" onClick={() => setFiles(prev => { const n = { ...prev }; delete n[s.type]; return n; })} title="Remove file" aria-label={`Remove ${s.label} file`} style={redBtn}><X size={12} /></button>}
                      {!saved && !picked && <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Not attached</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {missing > 0 && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '7px 10px', fontSize: '0.78rem', fontWeight: 600 }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                {missing} of {slots.length} document{slots.length > 1 ? 's' : ''} not attached. You can still save and add {missing > 1 ? 'them' : 'it'} later.
              </div>
            )}
          </div>
        )}
      </div>

      {viewIdx >= 0 && (
        <ProposalVersionView refNo={refNo} proposal={proposal} item={steps[viewIdx]} docRef={stepRef(baseRef, steps[viewIdx])}
          isCurrent={viewIdx === history.length - 1} userEmail={userEmail}
          onClose={() => setViewId(null)} onEdit={onEdit} openDoc={openDoc} showToast={showToast} />
      )}
    </div>
  );
}
