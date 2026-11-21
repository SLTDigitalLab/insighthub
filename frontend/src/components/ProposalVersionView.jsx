import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Download, X, AlertCircle, FileText, Eye } from 'lucide-react';
import { getProposalVersion, downloadProposalStepFile } from '../api';
import { isFinalStatus, stepName } from '../utils/proposalSteps';

// Read-only view of one step of the version history timeline (Original, V1, V2...): the step's note and documents, and the
// proposal content as it was at that step (the content snapshot of the step's version), with Word / PDF downloads of that content.

const SLOT_LABELS = { customerConfirmation: 'Customer Confirmation', creditApproval: 'Credit Approval', singleSourceApproval: 'Single Source Approval', uat: 'UAT' };
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '—' : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
const label2 = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const MAX_TEXT = 1200;

// One field value as readable content; empty values, images (data: URLs) and unknown shapes are skipped / summarised
function renderValue(v) {
  if (v == null || v === '' || v === false) return null;
  if (typeof v === 'string') {
    if (/^data:/i.test(v)) return <em style={{ color: '#64748b' }}>(image)</em>;
    return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  }
  if (typeof v === 'number' || v === true) return String(v);
  if (Array.isArray(v)) {
    const rows = v.filter(x => x != null && x !== '');
    if (!rows.length) return null;
    if (rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(c => rows.some(r => typeof r[c] !== 'object' && r[c] !== '' && r[c] != null && !/^data:/i.test(String(r[c]))));
      if (!cols.length) return `${rows.length} item${rows.length > 1 ? 's' : ''}`;
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '100%' }}>
            <thead><tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '3px 8px', borderBottom: '1px solid #e2e8f0', color: '#64748b', whiteSpace: 'nowrap' }}>{label2(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c} style={{ padding: '3px 8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>{r[c] != null && typeof r[c] !== 'object' && !/^data:/i.test(String(r[c])) ? String(r[c]) : ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return rows.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x != null && x !== '' && typeof x !== 'object' && !/^data:/i.test(String(x)));
    return entries.length ? entries.map(([k, x]) => `${label2(k)}: ${x}`).join(' · ') : null;
  }
  return null;
}

const btn = { padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#334155' };

export default function ProposalVersionView({ refNo, proposal, item, docRef, isCurrent, userEmail, onClose, onEdit, openDoc, showToast }) {
  const step = item.event;
  const label = stepName(item); // "Original", "V3"... or just the status for Confirmed / Completed
  const contentLabel = item.contentLabel;
  const versionNumber = item.contentVersion; // the content version this step shows (Confirmed / Completed: the last numbered step's)
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // the parent passes a new function on every render: keep the effect below from re-running (and re-focusing)

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    getProposalVersion(refNo, versionNumber, userEmail)
      .then(d => { if (alive) setData(d); })
      .catch(err => { if (alive) setError((err.response && err.response.data && err.response.data.error) || 'Could not load this step.'); });
    return () => { alive = false; };
  }, [refNo, versionNumber, userEmail]);

  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
    const onKey = e => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);

  const docs = Object.values(step.documents || {});
  const fields = data && data.snapshot ? data.snapshot.fields || {} : null;
  const shown = fields ? Object.entries(fields).map(([k, v]) => [k, renderValue(v)]).filter(([, v]) => v != null) : [];
  const canDownload = !!data && data.snapshotAvailable;
  const heading = { fontSize: '0.78rem', fontWeight: 800, color: '#0B2A6F', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 };

  const download = async format => {
    setBusy(format);
    try {
      const { blob, fileName } = await downloadProposalStepFile(refNo, format, step.id, userEmail);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.setAttribute('download', fileName); // named after the step's document reference, e.g. SLTM-REBM-WPE-48213-V3.docx
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      let msg = `Failed to download the ${format.toUpperCase()} of ${label}.`;
      try { const body = err.response && err.response.data; msg = (body instanceof Blob ? JSON.parse(await body.text()) : body || {}).error || msg; } catch { /* keep the default */ }
      if (showToast) showToast(msg, 'error');
    } finally { setBusy(''); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'default' }}>
      <div role="dialog" aria-modal="true" aria-label={item.label ? `${label} · ${step.status}` : step.status} onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: 'min(860px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(15,23,42,0.35)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0B2A6F' }}>{item.label ? `${label} · ${step.status}` : step.status}{isCurrent ? ' (current)' : ''}</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', wordBreak: 'break-word' }}>{[docRef, proposal.companyName, fmtDate(step.createdAt), step.userEmail].filter(Boolean).join(' · ')}</div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" style={{ ...btn, padding: '6px 8px' }}><X size={16} /></button>
        </div>

        {!isCurrent && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', color: '#b45309', borderBottom: '1px solid #fde68a', padding: '9px 18px', fontSize: '0.84rem', fontWeight: 700 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            Viewing {label} — not the current version. This view is read-only.
          </div>
        )}

        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
          {step.note && <div style={{ marginBottom: 14, color: '#334155', fontStyle: 'italic', wordBreak: 'break-word' }}>“{step.note}”</div>}

          {docs.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={heading}>Documents</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {docs.map(d => (
                  <button key={d.id} type="button" onClick={() => openDoc && openDoc(d)} title={`${d.originalName} — click to view / download`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                    <FileText size={12} /> {SLOT_LABELS[d.docType] || d.docType}{d.originalName ? ` — ${d.originalName}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {contentLabel && <div style={{ marginBottom: 12, color: '#64748b', fontSize: '0.82rem', fontWeight: 600 }}>Content unchanged since {contentLabel}</div>}

          {!data && !error && <div style={{ color: '#64748b', fontSize: '0.85rem' }}><RefreshCw size={14} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} />Loading content...</div>}
          {error && <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '9px 12px', fontSize: '0.84rem' }}>{error}</div>}

          {data && !data.snapshotAvailable && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '12px 14px', color: '#475569', fontSize: '0.84rem' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              The content of this step wasn’t stored. It was created before versions were kept, so there is no preview or download for it.
            </div>
          )}

          {data && data.snapshotAvailable && (
            <>
              <div style={heading}>Proposal content</div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(130px, 220px) 1fr', gap: '6px 14px', fontSize: '0.8rem', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', background: '#fcfdff' }}>
                {shown.length === 0 && <div style={{ gridColumn: '1 / -1', color: '#64748b' }}>No filled-in fields.</div>}
                {shown.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt style={{ color: '#64748b', fontWeight: 700 }}>{label2(k)}</dt>
                    <dd style={{ margin: 0, color: '#1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
          {isCurrent && onEdit && !isFinalStatus(step.status) && (
            <button type="button" onClick={() => { onClose(); onEdit(); }} style={{ ...btn, background: '#eff6ff', color: '#0284c7', borderColor: '#bfdbfe', marginRight: 'auto' }}><Eye size={14} /> Edit</button>
          )}
          {canDownload && (
            <>
              <button type="button" disabled={!!busy} onClick={() => download('docx')} title={`Download Word (.docx) of ${label}`}
                style={{ ...btn, background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}>
                {busy === 'docx' ? <RefreshCw size={13} className="spin" /> : <Download size={13} />} Word
              </button>
              <button type="button" disabled={!!busy} onClick={() => download('pdf')} title={`Download PDF of ${label}`}
                style={{ ...btn, background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>
                {busy === 'pdf' ? <RefreshCw size={13} className="spin" /> : <Download size={13} />} PDF
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
