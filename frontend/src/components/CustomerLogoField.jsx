import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, Upload, Info } from 'lucide-react';

// The customer logo of a Solution / Product + Solution proposal: a PNG or JPG that fills the template's {%client_logo} place. The
// template decides the size and position (the server fits the picture into that space and keeps its shape); this only picks the file,
// checks it and shows it. The logo is kept with the proposal when it is saved.
//
// logo: the data URL now shown ('' = none)    onChange(dataUrl | '')    place: the template has a logo place (false = it would not print)
const MAX_BYTES = 2 * 1024 * 1024;
const BORDER = '1px solid #e2e8f0';
const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' };

// inSection: it is shown inside a section of the form (under that section's heading), so it has no heading line of its own bigger than a label
const wrapText = (color, size, top) => ({ fontSize: size, color, marginTop: top, lineHeight: 1.4, whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', overflowWrap: 'anywhere' });

export default function CustomerLogoField({ logo, onChange, place = true, inSection = false }) {
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const pick = (file) => {
    setError('');
    if (!file) return;
    if (!/^image\/(png|jpeg)$/i.test(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) { setError('The customer logo must be a PNG or JPG image.'); return; }
    if (file.size > MAX_BYTES) { setError('The customer logo is larger than 2 MB. Please use a smaller image.'); return; }
    const reader = new FileReader();
    reader.onload = ev => onChange(String(ev.target.result || ''));
    reader.onerror = () => setError('The image could not be read. Please try another file.');
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ marginBottom: inSection ? 14 : 18, paddingBottom: inSection ? 12 : 0, borderBottom: inSection ? BORDER : 'none' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>Customer logo</div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" style={{ display: 'none' }}
        onChange={e => { pick(e.target.files[0]); e.target.value = ''; }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 96, height: 56, border: BORDER, borderRadius: 8, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {logo ? <img src={logo} alt="Customer logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ImageIcon size={22} color="#94a3b8" />}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()} style={btn}><Upload size={14} /> {logo ? 'Replace' : 'Upload logo'}</button>
          {logo && <button type="button" onClick={() => { setError(''); onChange(''); }} style={{ ...btn, color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2' }}><Trash2 size={14} /> Remove</button>}
        </div>
      </div>
      {/* the helper lines wrap over as many lines as they need (never cut off) */}
      <div style={wrapText('#64748b', '0.74rem', 5)}>PNG or JPG, up to 2 MB. It is fitted into the place the template gives it.</div>
      {!place && <div style={{ ...wrapText('#92400e', '0.76rem', 4), display: 'flex', gap: 5, alignItems: 'flex-start' }}><Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>The active template has no logo place, so the logo is saved but not printed.</span></div>}
      {error && <div style={wrapText('#991b1b', '0.78rem', 4)}>{error}</div>}
    </div>
  );
}
