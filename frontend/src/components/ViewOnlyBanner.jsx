import { ArrowLeft, Eye } from 'lucide-react';

// Top of a Confirmed / Completed proposal opened from the archive: "<status> — view only" and a Back button (to the archive, row still expanded)
export default function ViewOnlyBanner({ status, onBack }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#b45309', fontWeight: 700, fontSize: '0.9rem' }}>
      {onBack && (
        <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.82rem', fontWeight: 700, color: '#0B2A6F', cursor: 'pointer' }}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      <Eye size={16} /> {status} — view only
    </div>
  );
}
