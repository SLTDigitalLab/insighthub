import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Upload, Download, FileUp, RefreshCw, RotateCcw, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';

// "Upload Latest Template" tab, type = Solution: the solution template has its own single active version. The .docx must already
// contain its {tags} (text tags, {#rows}...{/rows} loops, {@raw} tags); they are detected on upload, there is no field mapping.
export default function SolutionTemplatePanel({ userEmail, showToast }) {
  const [meta, setMeta] = useState(null);
  const [versions, setVersions] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [problems, setProblems] = useState([]);

  const load = async () => {
    try {
      const { data } = await axios.get('/api/proposals/template/info', { params: { type: 'solution' } });
      setMeta(data.template && data.template.filename ? data.template : null);
      const { data: all } = await axios.get('/api/proposals/templates', { params: { type: 'solution' } });
      setVersions(Array.isArray(all.templates) ? all.templates : []);
    } catch (err) {
      console.warn('[SolutionTemplatePanel] load failed:', err.message);
    }
  };
  useEffect(() => { load(); }, []);

  const isDocx = file && /\.docx$/i.test(file.name);

  const upload = async (e) => {
    e.preventDefault();
    if (!isDocx || busy) return;
    setBusy(true); setResult(null); setProblems([]);
    const fd = new FormData();
    fd.append('template', file);
    fd.append('type', 'solution');
    fd.append('adminEmail', userEmail || 'admin');
    try {
      const { data } = await axios.post('/api/proposals/templates/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      setResult(data); setFile(null);
      showToast(`Solution template version ${data.version} is now the active solution template.`);
      load();
    } catch (err) {
      setProblems(err.response?.data?.problems || []);
      showToast(err.response?.data?.error || 'Failed to upload the solution template.', 'error');
    } finally { setBusy(false); }
  };

  const restore = async (v) => {
    setBusy(true);
    try {
      await axios.post(`/api/proposals/templates/${v.id}/activate`);
      showToast(`Solution template version ${v.version} is now active.`);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to restore this version.', 'error');
    } finally { setBusy(false); }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete version ${v.version} (${v.filename}) permanently? This cannot be undone. Proposals already made with it keep working and print with the active template.`)) return;
    setBusy(true);
    try {
      await axios.delete(`/api/proposals/templates/${v.id}`, { headers: { 'x-user-email': (localStorage.getItem('userEmail') || '').toLowerCase().trim() } });
      showToast(`Solution template version ${v.version} was deleted.`);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete this version.', 'error');
    } finally { setBusy(false); }
  };

  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' };
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px' }}>Upload Latest Solution Template</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
          Solution proposals are filled from a quotation Excel using the template you upload here. This is separate from the Product template, which stays active. The .docx must already contain its fill-in tags; they are detected automatically and the file is stored exactly as uploaded.
        </p>
      </div>
      <div style={{ ...card, maxWidth: 760 }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#0B2A6F' }}>
          <FileUp size={19} color="#0284c7" /> Replace Solution Template (.docx only)
        </h3>
        <form onSubmit={upload}>
          <label htmlFor="solution-template-input" style={{ display: 'block', border: '2px dashed #93c5fd', borderRadius: 10, padding: '28px 20px', textAlign: 'center', background: '#f0f9ff', cursor: 'pointer', marginBottom: 14 }}>
            <input id="solution-template-input" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0] || null)} />
            <Upload size={34} color="#0284c7" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 700, color: '#0369a1' }}>{file ? file.name : 'Click to choose a Microsoft Word (.docx) template'}</div>
          </label>
          {file && !isDocx && <div style={{ marginBottom: 12, color: '#991b1b', fontSize: '0.84rem' }}>Only .docx files are supported.</div>}
          <button type="submit" disabled={!isDocx || busy} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.92rem', cursor: isDocx && !busy ? 'pointer' : 'not-allowed', background: isDocx ? 'linear-gradient(135deg, #0284c7 0%, #0B2A6F 100%)' : '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {busy ? <><RefreshCw size={18} className="spin" /> Checking template...</> : <><Upload size={18} /> Analyse and activate</>}
          </button>
        </form>

        {problems.length > 0 && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: '0.84rem' }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={15} /> The template was not used:</div>
            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#166534', fontSize: '0.84rem' }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={16} /> Version {result.version} is now the active solution template</div>
            <div style={{ marginTop: 6 }}><strong>Tags found:</strong> {result.tags.map(t => (t.type === 'loop' ? `${t.name} (table: ${t.fields.join(', ')})` : t.name)).join(' · ')}</div>
          </div>
        )}

        <div style={{ marginTop: 22, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Active Solution Template</div>
          {meta ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#0B2A6F' }}>{meta.filename} <span style={{ color: '#64748b', fontWeight: 600 }}>(version {meta.version})</span></div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>Updated: {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '—'} • By: {meta.uploadedBy || '—'}</div>
              </div>
              <a href="/api/proposals/template/download?type=solution" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#eff6ff', color: '#0284c7', borderRadius: 6, border: '1px solid #bfdbfe', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700 }}>
                <Download size={14} /> Download File
              </a>
            </div>
          ) : (
            <div style={{ marginTop: 8, color: '#64748b', fontSize: '0.88rem' }}>No solution template has been uploaded yet. Solution proposals cannot be generated until one is.</div>
          )}
          {versions.some(v => !v.isActive) && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Previous versions</div>
              {versions.filter(v => !v.isActive).map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0B2A6F' }}>Version {v.version} • {v.filename}<div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 400 }}>{v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : ''}</div></div>
                  <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" disabled={busy} onClick={() => restore(v)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#f8fafc', color: '#475569', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}><RotateCcw size={13} /> Restore</button>
                  <button type="button" disabled={busy} onClick={() => remove(v)} title={`Delete version ${v.version} permanently`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, border: '1px solid #fecaca', fontSize: '0.8rem', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    <Trash2 size={13} /> Delete
                  </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
