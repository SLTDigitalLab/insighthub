import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Loader2, FileText } from 'lucide-react';

// Live PDF preview of a solution proposal. Same approach as the product edit screen (ProposalAgent): the server renders the
// real PDF (the same one Export PDF gives) from the CURRENT form values, it is shown in an iframe, and it is refreshed
//   - after generate / load (`trigger` changes),
//   - when the user clicks "Refresh preview" (no refresh while typing),
// with "Edits not in preview yet" shown when the form has changed since. Out-of-date answers are ignored and old blob URLs freed.
//
// fetchPdf(): () => Promise<Blob>   renders the current form values        fields: the current form values (to detect edits)
// actions: buttons shown at the right of the preview bar (Save / Word / PDF ...)
export default function SolutionPdfPreview({ fields, fetchPdf, trigger = 0, accent = '#0284c7', actions = null }) {
  const [preview, setPreview] = useState({ url: '', fields: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urlRef = useRef('');
  const seq = useRef(0);
  const latest = useRef({ fields, fetchPdf });
  latest.current = { fields, fetchPdf };

  async function refresh() {
    const mine = ++seq.current;
    const snapshot = latest.current.fields;
    setBusy(true); setError('');
    try {
      const blob = await latest.current.fetchPdf();
      if (mine !== seq.current) return; // a newer refresh already started
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreview({ url, fields: snapshot });
    } catch (err) {
      if (mine !== seq.current) return;
      let message = err && err.message ? err.message : 'The PDF preview could not be made.';
      const data = err && err.response && err.response.data;
      if (data instanceof Blob) { try { message = JSON.parse(await data.text()).error || message; } catch { /* keep message */ } } else if (data && data.error) message = data.error;
      setError(message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  useEffect(() => { if (trigger > 0) refresh(); }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const stale = !!preview.url && preview.fields !== fields;
  const BORDER = '1px solid #e2e8f0';
  const chip = { border: BORDER, borderRadius: 999, padding: '5px 12px', fontSize: '0.8rem', background: '#fff', cursor: 'pointer', color: '#0f172a' };
  const meta = { fontSize: '0.8rem', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 6 };

  return (
    <div className="proposal-split-right" style={{ border: BORDER, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderBottom: BORDER }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={chip} disabled={busy} onClick={refresh}>
            <RefreshCw size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Refresh preview
          </button>
          {busy && <span style={meta}><Loader2 size={14} className="spin" /> Updating preview...</span>}
          {!busy && stale && <span style={meta}>Edits not in preview yet</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
      </div>
      {error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', margin: '8px 12px', fontSize: '0.82rem' }}>
          Preview failed: {error}
        </div>
      )}
      <div style={{ height: 'calc(100vh - 310px)', minHeight: 420, overflow: 'hidden', background: '#e5e7eb' }}>
        {preview.url ? (
          <iframe key={preview.url} src={`${preview.url}#page=1&view=FitH`} title="Proposal preview" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', padding: 20, textAlign: 'center' }}>
            {busy ? <Loader2 size={36} className="spin" color={accent} /> : <FileText size={48} color="#94a3b8" />}
            <p style={{ marginTop: 12, fontWeight: 700, fontSize: '0.95rem', color: '#0B2A6F' }}>{busy ? 'Generating the PDF...' : 'The PDF preview is not generated yet'}</p>
            {!busy && <button type="button" onClick={refresh} style={{ marginTop: 6, padding: '8px 18px', background: accent, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={14} /> Generate preview</button>}
          </div>
        )}
      </div>
    </div>
  );
}
