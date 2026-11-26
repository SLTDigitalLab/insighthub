import React from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

// Editor for a block of the proposal that is an introduction followed by numbered items (the "About you & how we can help you" and
// "Proposed solution" parts of a Solution / Product + Solution proposal): one text box for the introduction, and one item per product
// (title + text) that can be added, removed and moved up or down. The user only ever sees and edits plain text; the numbering
// ("1.", "2." ...) and the Word formatting are added when the document is made, from the template's layout.
//
// value: { intro, items: [{ title, text }] } or a plain string (an older proposal / the AI's text: shown as the introduction)
// onChange(next): next is always { intro, items } (+ removed: true while the section is removed)
// removable: shows a "Remove section" button next to the title; a removed section stays in the proposal data as { removed: true } so the
// server leaves its heading and page out of the document, and the editor shows a one-line "Restore" row instead of the fields
const BORDER = '1px solid #e2e8f0';
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.88rem', fontFamily: 'inherit', background: '#fff' };
const smallBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer' };

export function toStructured(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      intro: value.intro == null ? '' : String(value.intro),
      items: (Array.isArray(value.items) ? value.items : []).filter(it => it && typeof it === 'object').map(it => ({ title: it.title == null ? '' : String(it.title), text: it.text == null ? '' : String(it.text) })),
      ...(value.removed === true ? { removed: true } : {}),
    };
  }
  return { intro: value == null ? '' : String(value), items: [] };
}

// extra: something that belongs to this section and is shown right under its heading, above the introduction (the customer logo)
export default function StructuredTextEditor({ label, value, onChange, introLabel = 'Introduction', itemName = 'item', warn = null, extra = null, removable = false }) {
  const v = toStructured(value);
  const set = (next) => onChange({ intro: next.intro, items: next.items, ...(next.removed ? { removed: true } : {}) });
  if (v.removed) {
    return (
      <div style={{ marginBottom: 18, border: '1px dashed #cbd5e1', borderRadius: 10, padding: '10px 12px', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: '0.86rem', color: '#64748b' }}><strong style={{ color: '#475569' }}>{label}</strong> was removed from this proposal.</span>
        <button type="button" onClick={() => set({ ...v, removed: false })} style={{ ...smallBtn, padding: '5px 12px', color: '#0369a1', fontWeight: 700, fontSize: '0.8rem' }}>Restore</button>
      </div>
    );
  }
  const setItem = (i, patch) => set({ ...v, items: v.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const move = (i, to) => {
    if (to < 0 || to >= v.items.length) return;
    const items = v.items.slice();
    const [it] = items.splice(i, 1);
    items.splice(to, 0, it);
    set({ ...v, items });
  };
  return (
    // one framed section: heading, then what belongs to it (logo), the introduction and the items
    <div style={{ marginBottom: 18, border: BORDER, borderRadius: 10, padding: 12, background: '#fcfdff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, marginBottom: 10, borderBottom: BORDER }}>
        <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 800, color: '#0B2A6F' }}>{label}</span>
        {removable && (
          <button type="button" title="Remove this whole section from the proposal" onClick={() => set({ ...v, removed: true })}
            style={{ ...smallBtn, gap: 4, padding: '4px 9px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2', fontSize: '0.76rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
            <Trash2 size={13} /> Remove section
          </button>
        )}
      </div>
      {extra}
      <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: 3 }}>{introLabel}</label>
      <textarea rows={4} value={v.intro} style={input} onChange={e => set({ ...v, intro: e.target.value })} />
      {warn && <div style={{ fontSize: '0.74rem', color: '#b45309', marginTop: 2 }}>{warn}</div>}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {v.items.length === 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No {itemName}s yet.</div>}
        {v.items.map((it, i) => (
          <div key={i} style={{ border: BORDER, borderRadius: 8, padding: 10, background: '#f8fafc' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontWeight: 800, color: '#0369a1', minWidth: 22 }}>{i + 1}.</span>
              <input type="text" value={it.title} placeholder={`Title of the ${itemName}`} style={{ ...input, fontWeight: 600 }} onChange={e => setItem(i, { title: e.target.value })} />
              <button type="button" title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} style={{ ...smallBtn, opacity: i === 0 ? 0.4 : 1 }}><ArrowUp size={14} /></button>
              <button type="button" title="Move down" disabled={i === v.items.length - 1} onClick={() => move(i, i + 1)} style={{ ...smallBtn, opacity: i === v.items.length - 1 ? 0.4 : 1 }}><ArrowDown size={14} /></button>
              <button type="button" title={`Remove this ${itemName}`} onClick={() => set({ ...v, items: v.items.filter((_, j) => j !== i) })} style={{ ...smallBtn, color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2' }}><Trash2 size={14} /></button>
            </div>
            <textarea rows={3} value={it.text} placeholder="Text" style={input} onChange={e => setItem(i, { text: e.target.value })} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => set({ ...v, items: [...v.items, { title: '', text: '' }] })} style={{ ...smallBtn, marginTop: 8, padding: '6px 12px', gap: 6, fontWeight: 600, fontSize: '0.84rem' }}>
        <Plus size={14} /> Add {itemName}
      </button>
    </div>
  );
}
