import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Upload, Download, FileUp, RefreshCw, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { getProductSolutionTemplate } from '../api';

// "Upload Latest Template" tab, type = Product + Solution. Its own single active template (the Product and Solution templates are not touched),
// with version history and restore. The page has the same parts as the Product tab:
//   - Replace Template (.docx only) + "Analyse Template (.docx)": the file is kept unchanged, a tagged copy is made (tags already in the file are
//     kept as they are; a file without tags goes through the AI field matching), the result is reviewed and a single Confirm makes it active
//   - Active template on server (name, updated date, size), Download, previous versions with Restore
//   - the right-hand "Best Method to Mark Changing Points" panel and the "Key Placeholder Tags Reference", built from the ACTIVE template's own tags
// No tag name is written in this file.
const BASE = '/api/proposals';
const card = { background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' };
const mono = { fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' };

// How a tag is written in Word, and what the template says about it (taken from the template itself)
const syntax = tag => (tag.type === 'loop' ? `{#${tag.name}} ... {/${tag.name}}` : (tag.type === 'rawXml' ? `{@${tag.name}}` : `{${tag.name}}`));
const describe = tag => {
  const fields = (tag.children || []).map(c => (c.type === 'loop' ? `${c.name}[ ${(c.children || []).map(x => x.name).join(', ')} ]` : c.name));
  const kind = tag.type === 'loop' ? `Table / list. Fields: ${fields.join(', ')}.` : (tag.type === 'rawXml' ? 'Paragraphs written by the AI.' : 'Text.');
  const where = [tag.section && `Section: ${tag.section}`, tag.context && `Next to: "${tag.context}"`].filter(Boolean).join(' · ');
  return { kind, where };
};

export default function ProductSolutionTemplatePanel({ userEmail, showToast }) {
  const [meta, setMeta] = useState(null);
  const [versions, setVersions] = useState([]);
  const [schema, setSchema] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);       // the analysed upload waiting for its single Confirm
  const [result, setResult] = useState(null);     // the last confirmed upload
  const [problems, setProblems] = useState([]);
  const headers = { 'x-user-email': userEmail || '' };

  const load = async () => {
    try {
      const { data } = await axios.get(`${BASE}/template/info`, { params: { type: 'productSolution' } });
      setMeta(data.template && data.template.filename ? data.template : null);
      const { data: all } = await axios.get(`${BASE}/templates`, { params: { type: 'productSolution' } });
      setVersions(Array.isArray(all.templates) ? all.templates : []);
      if (userEmail) { const t = await getProductSolutionTemplate(userEmail); setSchema(Array.isArray(t.schema) ? t.schema : []); }
    } catch (err) {
      console.warn('[ProductSolutionTemplatePanel] load failed:', err.message);
    }
  };
  useEffect(() => { load(); }, [userEmail]);

  const isDocx = file && /\.docx$/i.test(file.name);
  const errorOf = err => err.response?.data?.error || err.message || 'Something went wrong.';

  const analyse = async (e) => {
    e.preventDefault();
    if (!isDocx || busy) return;
    setBusy(true); setResult(null); setProblems([]); setDraft(null);
    showToast('Analysing the template...', 'info');
    const fd = new FormData();
    fd.append('template', file);
    try {
      const { data } = await axios.post(`${BASE}/templates/product-solution/analyse`, fd, { headers: { ...headers, 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
      setDraft(data.draft);
    } catch (err) {
      setProblems([errorOf(err)]);
      showToast(errorOf(err), 'error');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!draft || busy) return;
    setBusy(true); setProblems([]);
    try {
      const { data } = await axios.post(`${BASE}/templates/product-solution/drafts/${draft.id}/confirm`, {}, { headers, timeout: 120000 });
      setResult(data); setDraft(null); setFile(null);
      showToast(`Product + Solution template version ${data.version} is now the active template.`);
      load();
    } catch (err) {
      setProblems([errorOf(err), ...(err.response?.data?.problems || [])]);
      showToast(errorOf(err), 'error');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    const id = draft && draft.id;
    setDraft(null); setFile(null);
    if (id) { try { await axios.delete(`${BASE}/templates/product-solution/drafts/${id}`, { headers }); } catch { /* it is purged later anyway */ } }
  };

  const restore = async (v) => {
    setBusy(true);
    try {
      await axios.post(`${BASE}/templates/${v.id}/activate`);
      showToast(`Product + Solution template version ${v.version} is now active.`);
      load();
    } catch (err) {
      showToast(errorOf(err), 'error');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px' }}>Upload Latest Product + Solution Template</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
          Product + Solution proposals are filled from the template you upload here; it is separate from the Product and Solution templates, which stay as they are. The fill-in tags are read from the file every time a proposal is generated, so a changed template needs no other change. Your uploaded file is kept unchanged, and older versions can be restored.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
        <div style={card}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#0B2A6F' }}>
            <FileUp size={19} color="#0284c7" /> Replace Template (.docx only)
          </h3>
          <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: '0.83rem', color: '#166534', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><CheckCircle2 size={16} color="#16a34a" /> Your Upload Is Kept Exactly As It Is</div>
            The <strong>.docx</strong> you upload is stored <strong>exactly as uploaded</strong>; a separate tagged copy is made from it. Tags already written in the file are kept as they are. If the file has no tags, the AI tags the product and solution fields it can find. The template is accepted even if some tags are still missing.
          </div>

          <form onSubmit={analyse}>
            <div style={{ border: '2px dashed #93c5fd', borderRadius: 10, padding: '32px 20px', textAlign: 'center', background: '#f0f9ff', marginBottom: 14 }}>
              <input type="file" id="ps-template-file-input" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={e => { setFile(e.target.files[0] || null); setDraft(null); setResult(null); setProblems([]); }} />
              <label htmlFor="ps-template-file-input" style={{ cursor: 'pointer', display: 'block' }}>
                <Upload size={38} color="#0284c7" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0369a1' }}>{file ? file.name : 'Click or drag Microsoft Word (.docx) template here'}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 4 }}>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB ready to analyse` : 'Strictly .docx format'}</div>
              </label>
            </div>
            {file && !isDocx && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.8rem' }}>
                Only <strong>.docx</strong> files are supported. Open the file in Word and use <strong>File &rarr; Save As &rarr; Word Document (.docx)</strong> first.
              </div>
            )}
            <button type="submit" disabled={!isDocx || busy || !!draft}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: isDocx && !draft ? 'linear-gradient(135deg, #0284c7 0%, #0B2A6F 100%)' : '#cbd5e1', color: '#fff', fontWeight: 700, fontSize: '0.92rem', cursor: isDocx && !busy && !draft ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {busy && !draft ? <><RefreshCw size={18} className="spin" /> Analysing Template...</> : <><Upload size={18} /> Analyse Template (.docx)</>}
            </button>
          </form>

          {draft && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: '#f8fafc', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: '0.84rem', color: '#334155', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: '#0B2A6F' }}>Review: {draft.filename} ({(draft.sizeBytes / (1024 * 1024)).toFixed(2)} MB)</div>
              <div style={{ marginTop: 6 }}>
                <strong>{draft.tags.length} fill-in tag{draft.tags.length === 1 ? '' : 's'} found</strong>
                {draft.autoTagged ? ' (the AI tagged the file)' : ' (already in the file, kept as they are)'}:{' '}
                {draft.tags.map(t => (t.type === 'loop' ? `${t.name} (table: ${t.fields.join(', ')})` : t.name)).join(' · ')}
              </div>
              {draft.aiError && <div style={{ marginTop: 6, color: '#92400e' }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> The AI field matching could not tag everything ({draft.aiError}). The template can still be used; tags that are missing stay empty.</div>}
              {draft.comparedWith && (draft.comparedWith.added.length > 0 || draft.comparedWith.removed.length > 0) && (
                <div style={{ marginTop: 6 }}>
                  Compared with the active template (version {draft.comparedWith.version}):
                  {draft.comparedWith.added.length > 0 && <div><strong>New:</strong> {draft.comparedWith.added.join(', ')}</div>}
                  {draft.comparedWith.removed.length > 0 && <div><strong>No longer in the template:</strong> {draft.comparedWith.removed.join(', ')}</div>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={confirm} disabled={busy} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #16a34a 0%, #166534 100%)', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {busy ? <RefreshCw size={15} className="spin" /> : <CheckCircle2 size={15} />} Confirm and make active
                </button>
                <button type="button" onClick={cancel} disabled={busy} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {problems.length > 0 && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: '0.84rem' }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={15} /> The template was not used:</div>
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#166534', fontSize: '0.84rem' }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} /> Version {result.version} is now the active Product + Solution template</div>
            </div>
          )}

          <div style={{ marginTop: 24, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Active Template on Server</div>
            {meta ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0B2A6F' }}>{meta.filename} <span style={{ color: '#64748b', fontWeight: 600 }}>(version {meta.version})</span></div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                    Updated: {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '—'} &nbsp;•&nbsp; Size: {meta.sizeBytes ? (meta.sizeBytes / (1024 * 1024)).toFixed(2) + ' MB' : '—'}
                  </div>
                </div>
                <a href={`${BASE}/template/download?type=productSolution`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#eff6ff', color: '#0284c7', borderRadius: 6, border: '1px solid #bfdbfe', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700 }}>
                  <Download size={14} /> Download File
                </a>
              </div>
            ) : (
              <div style={{ marginTop: 8, color: '#64748b', fontSize: '0.88rem' }}>No Product + Solution template has been uploaded yet. Product + Solution proposals cannot be generated until one is.</div>
            )}
            {versions.some(v => !v.isActive) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Previous versions</div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {versions.filter(v => !v.isActive).map(v => (
                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0B2A6F' }}>Version {v.version} &nbsp;•&nbsp; {v.filename}</div>
                        <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : ''}</div>
                      </div>
                      <button type="button" disabled={busy} onClick={() => restore(v)} title={`Make version ${v.version} the active template again`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#f8fafc', color: '#475569', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                        <RotateCcw size={13} /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={card}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 10px', color: '#0B2A6F', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={20} color="#10b981" /> Best Method to Mark Changing Points in the Template
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
            The standard method for Word templates is <strong>docxtemplater mustache tags: <code>{'{tag}'}</code></strong>. A tag can be any name you choose; the AI reads the name and the text around it to decide what to put there.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 16 }}>
            {[
              ['Text', <>Write <code>{'{name}'}</code> where a value goes. Word keeps the font, size and colour of the tag.</>],
              ['Paragraphs', <>Write <code>{'{@name}'}</code> alone in its own paragraph for a block of paragraphs (a letter, a description).</>],
              ['Tables and lists', <>Write <code>{'{#rows}'}</code> in the first cell of the repeating row and <code>{'{/rows}'}</code> in its last cell, with a tag such as <code>{'{item}'}</code> in each cell. A table with no rows is removed with its heading.</>],
              ['Logo', <>Write <code>{'{%client_logo}'}</code> where the customer logo goes (centre the line to centre the logo).</>],
            ].map(([title, text]) => (
              <div key={title} style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                <strong style={{ color: '#0B2A6F' }}>• {title}:</strong> {text}
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe', color: '#1e40af', fontSize: '0.8rem', marginBottom: 14 }}>
            <strong>Strict Non-Destructive Guarantee:</strong> InsightHub only substitutes the marked placeholders. It does not alter widths, row heights, margins, formats or images of your template, and it writes no headings or tables of its own.
          </div>

          <h4 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 8px', color: '#0B2A6F' }}>Key Placeholder Tags Reference</h4>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 8 }}>
            {meta ? <>Built from the tags of the active template (version {meta.version}); it changes when the template does.</> : 'Built from the tags of the active template.'}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', color: '#475569', width: '42%' }}>Placeholder in Word</th>
                  <th style={{ padding: '8px 12px', color: '#475569' }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {schema.length === 0 && <tr><td colSpan={2} style={{ padding: 14, color: '#94a3b8', textAlign: 'center' }}>No active template, so there are no tags to list.</td></tr>}
                {schema.map(tag => {
                  const d = describe(tag);
                  return (
                    <tr key={tag.name} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                      <td style={{ padding: '8px 12px', wordBreak: 'break-word', ...mono }}>{syntax(tag)}</td>
                      <td style={{ padding: '8px 12px' }}>{d.kind}{d.where && <div style={{ color: '#64748b', fontSize: '0.76rem', marginTop: 2 }}>{d.where}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
