import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, Layers, ArrowLeft, Upload, FileSpreadsheet, RefreshCw, AlertCircle, AlertTriangle,
  CheckCircle2, Download, Save, Plus, Trash2, RotateCcw, Info
} from 'lucide-react';
import {
  getSolutionTemplate, uploadSolutionExcel, extractSolutionSheet, getSolutionProposal,
  saveSolutionFields, exportSolutionProposal, downloadSolutionSource, regenerateSolutionProposal, downloadProposalStepFile
} from '../api';
import ProposalMaintenance from '../components/ProposalMaintenance';
import ProposalHubHeader from '../components/ProposalHubHeader';
import ConfirmModal from '../components/ConfirmModal';
import SolutionPdfPreview from '../components/SolutionPdfPreview';
import StructuredTextEditor from '../components/StructuredTextEditor';
import CustomerLogoField from '../components/CustomerLogoField';
import { fieldLabel, userFieldPhrase } from '../utils/fieldLabels';
import { formatMoney } from '../utils/formatMoney';
import { fileRef, proposalFileName } from '../utils/fileNames';
import { isFinalStatus } from '../utils/proposalSteps';
import ViewOnlyBanner from '../components/ViewOnlyBanner';

// What differs between the Solution page and the Product + Solution page: the API it talks to, a few words, and who may use it.
const DEFAULT_FLOW = {
  api: {
    getTemplate: getSolutionTemplate, upload: uploadSolutionExcel, extract: (uploadId, sheet, user, email) => extractSolutionSheet(uploadId, sheet, user, email),
    get: getSolutionProposal, save: saveSolutionFields, exportFile: exportSolutionProposal, source: downloadSolutionSource, regenerate: regenerateSolutionProposal,
  },
  adminOnly: true, // TODO (existing): keep in step with ProposalHub
  templateType: 'solution', generatePath: '/proposals/solution', // the shared header's tabs
  subtitle: 'Solution Proposal',
  templateWords: 'solution template', // "fill the active ..."
  noTemplate: { title: 'No solution template yet', text: 'solution', type: 'Solution', href: '/proposals/product?tab=template' },
  fileSuffix: 'Solution',
  fileRef,
  startAnother: 'Start another solution proposal',
};

// Solution proposal: upload a quotation Excel -> pick a sheet -> the AI agent fills the active solution template's tags ->
// edit screen built from the template's own tag schema -> Word / PDF. No tag or column name is written in this file.

const ADMIN_EMAILS = ['dineshpi@slt.com.lk', '020601@intranet.slt.com.lk', 'lahirus@slt.com.lk']; // same list as ProposalHub

const BORDER = '1px solid #e2e8f0';
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.88rem', fontFamily: 'inherit', background: '#fff' };
const flagged = { border: '1.5px solid #f59e0b', background: '#fffbeb' };
const card = { background: '#fff', border: BORDER, borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' };
const primaryBtn = (disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.9rem', color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#cbd5e1' : 'linear-gradient(135deg, #0284c7 0%, #0B2A6F 100%)' });
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontWeight: 600, fontSize: '0.84rem', cursor: 'pointer' };

const label = fieldLabel; // friendly label from the tag name (utils/fieldLabels.js)

// The customer logo and the other picture settings ride along in the fields under __meta (they are not template tags): the logo is shown /
// changed through fields.__meta.leadLogo and sent to the server as its own `logo` value; __meta itself is never sent back as part of the fields.
const plainFields = (f) => { const { __meta, ...rest } = f || {}; return rest; };
const logoOf = (f) => (f && f.__meta && f.__meta.leadLogo) || '';
// undefined = the logo is as stored, otherwise '' (removed) or the new data URL
const logoChange = (f, p) => (logoOf(f) !== logoOf(p && p.fields) ? logoOf(f) : undefined);
// a text tag that holds a sentence or more gets a text box, not a one-line input
const LONG_TEXT_NAME = /scope|summary|description|remarks?|notes?/i;
const emptyRow = (children) => Object.fromEntries((children || []).map(c => [c.name, c.type === 'loop' ? [] : '']));

// immutable update of obj at path (array of keys / indexes)
function setIn(obj, path, value) {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  copy[head] = setIn(obj ? obj[head] : undefined, rest, value);
  return copy;
}

async function errorText(err) {
  const data = err && err.response && err.response.data;
  if (data instanceof Blob) { try { return JSON.parse(await data.text()).error || err.message; } catch { return err.message; } }
  return (data && data.error) || err.message || 'Something went wrong.';
}

function saveBlob(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}

// ---- Dynamic form -----------------------------------------------------------------------------------------------------------
// prefix + tag name = the path string the server uses for price warnings, e.g. rows[2].price
// above: something that belongs to this tag's section (the customer logo), drawn at the top of it
function TagField({ tag, value, path, prefix, onChange, warn, placeholder, above = null }) {
  const key = `${prefix}${tag.name}`;
  if (tag.type === 'loop') {
    return <LoopTable tag={tag} rows={Array.isArray(value) ? value : []} path={path} prefix={prefix} onChange={onChange} warn={warn} />;
  }
  if (tag.editor === 'structured') {
    // the "about" / "requirements" blocks: an introduction + items the user can add, remove and move; plain text, never XML
    return <StructuredTextEditor label={label(tag.name)} value={value} warn={warn[key]} onChange={next => onChange(path, next, key)} itemName="product" extra={above} />;
  }
  const w = warn[key];
  if (above) return <div>{above}<TagField tag={tag} value={value} path={path} prefix={prefix} onChange={onChange} warn={warn} placeholder={placeholder} /></div>;
  const common = { value: value || '', placeholder: placeholder || undefined, title: w || undefined, style: { ...input, ...(w ? flagged : {}) }, onChange: e => onChange(path, e.target.value, key) };
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>{label(tag.name)}</label>
      {tag.type === 'rawXml' ? <textarea rows={6} {...common} />
        : ((value || '').length > 80 || String(value || '').includes('\n') || LONG_TEXT_NAME.test(tag.name) ? <textarea rows={3} {...common} /> : <input type="text" {...common} />)}
      {w && <div style={{ fontSize: '0.74rem', color: '#b45309', marginTop: 2 }}>{w}</div>}
    </div>
  );
}

// A table cell: shows money formatted (1,234.50) while it is not being edited; the stored value is the one that was typed / read
function CellInput({ value, onChange, ...rest }) {
  const [focus, setFocus] = useState(false);
  return <input type="text" {...rest} value={focus ? value : formatMoney(value)} onChange={onChange} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />;
}

function LoopTable({ tag, rows, path, prefix, onChange, warn }) {
  const cols = (tag.children || []).filter(c => c.type !== 'loop');
  const nested = (tag.children || []).filter(c => c.type === 'loop');
  const setRows = (next) => onChange(path, next, null);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>{label(tag.name)}</div>
      {warn[`${prefix}${tag.name}`] && <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 9px', marginBottom: 6 }}>{warn[`${prefix}${tag.name}`]}</div>}
      <div style={{ overflowX: 'auto', border: BORDER, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '8px 6px', textAlign: 'left', fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>Group row</th>
              {cols.map(c => <th key={c.name} style={{ padding: '8px 6px', textAlign: 'left', fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>{label(c.name)}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length + 2} style={{ padding: 12, color: '#94a3b8', textAlign: 'center' }}>No rows</td></tr>}
            {rows.map((row, i) => {
              const rowPrefix = `${prefix}${tag.name}[${i}].`;
              return (
                <React.Fragment key={i}>
                  <tr title={warn[`${prefix}${tag.name}[${i}]`] || undefined} style={{ borderTop: BORDER, background: warn[`${prefix}${tag.name}[${i}]`] ? '#fffbeb' : (row._group ? '#f1f5f9' : '#fff') }}>
                    <td style={{ padding: 6, textAlign: 'center' }}>
                      <input type="checkbox" checked={row._group === true} title="Heading / group row"
                        onChange={e => setRows(setIn(rows, [i, '_group'], e.target.checked))} />
                    </td>
                    {cols.map(c => {
                      const k = `${rowPrefix}${c.name}`;
                      const w = warn[k];
                      const props = { value: row[c.name] || '', title: w || undefined, style: { ...input, ...(w ? flagged : {}), fontWeight: row._group ? 700 : 400 }, onChange: e => onChange([...path, i, c.name], e.target.value, k) };
                      return <td key={c.name} style={{ padding: 4, minWidth: 110 }}>{c.type === 'rawXml' ? <textarea rows={3} {...props} /> : <CellInput {...props} />}</td>;
                    })}
                    <td style={{ padding: 4 }}>
                      <button type="button" title="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))} style={{ ...ghostBtn, padding: '5px 8px', color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2' }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                  {nested.map(n => (
                    <tr key={`${i}-${n.name}`}><td /><td colSpan={cols.length + 1} style={{ padding: '4px 4px 10px' }}>
                      <TagField tag={n} value={row[n.name]} path={[...path, i, n.name]} prefix={rowPrefix} onChange={onChange} warn={warn} />
                    </td></tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setRows([...rows, emptyRow(tag.children)])} style={{ ...ghostBtn, marginTop: 8 }}><Plus size={14} /> Add row</button>
    </div>
  );
}

// ---- Page ----------------------------------------------------------------------------------------------------------------------
// TODO: when this page is built out further, keep the admin / maintenance gate below in step with ProposalHub.
// flow: DEFAULT_FLOW (Solution page) or the Product + Solution flow. selection: what the product step chose ({ business, productIds }), passed to
// the extract call. onStartOver: replaces "back to the upload step" (the Product + Solution page goes back to its product step).
// embedded: the caller (the Product + Solution page) draws the header and the page frame.
export default function SolutionProposal({ flow = DEFAULT_FLOW, selection = null, onStartOver = null, embedded = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?ref= is optional: anything that is not a plain reference / id (e.g. "PR:") is ignored, never an error
  const rawRef = (searchParams.get('ref') || '').trim();
  const refParam = /^[A-Za-z0-9._-]{1,100}$/.test(rawRef) && !rawRef.includes('..') ? rawRef : '';

  const [userEmail, setUserEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [userName, setUserName] = useState('');
  const [tpl, setTpl] = useState(null);           // { template, schema } once loaded
  const [step, setStep] = useState('loading');   // loading | upload | sheets | working | edit
  const [upload, setUpload] = useState(null);     // { uploadId, filename, sheets }
  const [sheet, setSheet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);       // { message, retry }
  const [proposal, setProposal] = useState(null);
  const [schema, setSchema] = useState([]);
  const [fields, setFields] = useState({});
  const [companyName, setCompanyName] = useState('');
  const [missing, setMissing] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [userMissing, setUserMissing] = useState([]);   // [{ tag, field }] account-manager details missing from the user's profile
  const [previewTrigger, setPreviewTrigger] = useState(0);
  const [mobileTab, setMobileTab] = useState('editor');   // 'editor' | 'preview' on narrow screens
  const [warn, setWarn] = useState({});           // path -> reason, cleared when the cell is edited
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [logoPlace, setLogoPlace] = useState(true);  // the template has a {%client_logo} place
  const [logoField, setLogoField] = useState('');    // the tag whose section the logo place is in (the upload is shown in that section); '' = stands alone

  useEffect(() => {
    const email = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
    setUserEmail(email);
    setUserName(localStorage.getItem('userName') || '');
    setIsAdmin(localStorage.getItem('userRole') === 'admin' || ADMIN_EMAILS.includes(email));
  }, []);

  const showEdit = (p, s, m, w, um) => {
    setProposal(p); setSchema(s); setFields(p.fields || {}); setCompanyName(p.companyName || '');
    setMissing(m || []); setWarnings(w || []); setUserMissing(um || []);
    setWarn(Object.fromEntries((w || []).filter(x => x.kind !== 'drift').map(x => [x.path, x.reason])));
    setDirty(false); setMobileTab('editor'); setStep('edit');
    setPreviewTrigger(t => t + 1); // the preview is made right after generate / load
  };

  useEffect(() => {
    if (!userEmail || (flow.adminOnly && !isAdmin)) return;
    let cancelled = false;
    (async () => {
      try {
        if (refParam) {
          const d = await flow.api.get(refParam, userEmail);
          if (cancelled) return;
          const sol = d.proposal.solution || {};
          setLogoPlace(d.logoPlace !== false); setLogoField(d.logoField || '');
          showEdit(d.proposal, d.schema, sol.missing, sol.warnings, sol.userMissing);
        } else {
          const t = await flow.api.getTemplate(userEmail);
          if (cancelled) return;
          setTpl(t); setLogoPlace(t.logoPlace !== false); setLogoField(t.logoField || ''); setStep('upload');
        }
      } catch (err) {
        if (cancelled) return;
        if (refParam) { setSearchParams({}, { replace: true }); return; } // the ref in the URL could not be opened: ignore it, show the upload page
        setError({ message: await errorText(err) }); setStep('upload');
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail, isAdmin, refParam]);

  // a junk ?ref= in the address bar is removed silently
  useEffect(() => { if (rawRef && !refParam) setSearchParams({}, { replace: true }); }, [rawRef, refParam]);

  if (flow.adminOnly && !isAdmin && userEmail !== '' ) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <ProposalMaintenance onBack={() => navigate('/dashboard')} />
      </div>
    );
  }

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) return setError({ message: 'Only Excel (.xlsx) files are supported.' });
    if (file.size > 10 * 1024 * 1024) return setError({ message: 'The Excel file is larger than 10 MB.' });
    setBusy(true);
    try {
      const d = await flow.api.upload(file, userEmail);
      setUpload(d); setSheet(d.sheets.length === 1 ? d.sheets[0].name : ''); setStep('sheets');
    } catch (err) {
      setError({ message: await errorText(err) });
    } finally { setBusy(false); }
  };

  const generate = async () => {
    setError(null); setStep('working');
    try {
      const d = await flow.api.extract(upload.uploadId, sheet, { name: userName, email: userEmail }, userEmail, selection || {});
      showEdit(d.proposal, d.schema, d.missing, d.warnings, d.userMissing);
      setSearchParams({ ref: d.proposal.id }, { replace: true });
    } catch (err) {
      setError({ message: await errorText(err), retry: !!(err.response && err.response.data && err.response.data.retry) });
      setStep('sheets');
    }
  };

  const onChange = (path, value, warnKey) => {
    setFields(prev => setIn(prev, path, value));
    if (warnKey) {
      const rowKey = warnKey.includes('].') ? warnKey.slice(0, warnKey.lastIndexOf('].') + 1) : null; // rows[2].price -> rows[2]
      const loopKey = warnKey.includes('[') ? warnKey.slice(0, warnKey.indexOf('[')) : null; // rows[2].price -> rows
      setWarn(prev => { if (!prev[warnKey] && !(rowKey && prev[rowKey]) && !(loopKey && prev[loopKey])) return prev; const n = { ...prev }; delete n[warnKey]; if (rowKey) delete n[rowKey]; if (loopKey) delete n[loopKey]; return n; });
    }
    setDirty(true);
  };

  const save = async () => {
    const d = await flow.api.save(proposal.id, plainFields(fields), companyName, userEmail, logoChange(fields, proposal));
    setProposal(d.proposal); setDirty(false);
    return d.proposal;
  };

  const doSave = async () => {
    setBusy(true); setNotice(null);
    try { await save(); setNotice({ ok: true, text: 'Changes saved.' }); } catch (err) { setNotice({ ok: false, text: await errorText(err) }); } finally { setBusy(false); }
  };

  const doExport = async (format) => {
    setBusy(true); setNotice({ ok: true, text: `Preparing ${format.toUpperCase()}...` });
    try {
      if (isFinalStatus(proposal.status)) { // view-only: nothing is saved; the file is the current step's document
        const { blob, fileName } = await downloadProposalStepFile(proposal.id, format, undefined, userEmail);
        saveBlob(blob, fileName);
        setNotice({ ok: true, text: `${format.toUpperCase()} downloaded.` });
        return;
      }
      const saved = await save();
      const blob = await flow.api.exportFile({ fields: plainFields(saved.fields), templateId: saved.templateId, companyName: saved.companyName, format, id: saved.id }, userEmail);
      saveBlob(blob, proposalFileName([flow.fileRef(saved.refNo), saved.companyName, flow.fileSuffix], format)); // the reference is optional in the name
      setNotice({ ok: true, text: `${format.toUpperCase()} downloaded.` });
    } catch (err) { setNotice({ ok: false, text: await errorText(err) }); } finally { setBusy(false); }
  };

  // Regenerate: the AI agent runs again (with voting) on the stored Excel and sheet; the server replaces the values. The user is
  // asked first when there is anything of theirs to lose: unsaved changes, or saved values that differ from what was generated.
  const hasEdits = () => dirty || !(proposal.solution && proposal.solution.generatedFields) || JSON.stringify(plainFields(fields)) !== JSON.stringify(plainFields(proposal.solution.generatedFields));
  const doRegenerate = async () => {
    setConfirmRegen(false); setBusy(true); setNotice({ ok: true, text: 'Running the AI agent again...' });
    try {
      const d = await flow.api.regenerate(proposal.id, { name: userName, email: userEmail }, userEmail);
      showEdit(d.proposal, d.schema, d.missing, d.warnings, d.userMissing);
      setNotice({ ok: true, text: 'Regenerated from the original Excel.' });
    } catch (err) { setNotice({ ok: false, text: await errorText(err) }); } finally { setBusy(false); }
  };

  const doSource = async () => {
    try { saveBlob(await flow.api.source(proposal.id, userEmail), [flow.fileRef(proposal.refNo), ((proposal.solution && proposal.solution.sourceName) || 'source.xlsx').replace(/[\\/:*?"<>|]+/g, '_')].filter(Boolean).join('_')); }
    catch (err) { setNotice({ ok: false, text: await errorText(err) }); }
  };

  const backToUpload = () => { setUpload(null); setSheet(''); setError(null); setProposal(null); setSearchParams({}, { replace: true }); setStep('upload'); };
  const startOver = () => (onStartOver ? onStartOver() : backToUpload()); // the Product + Solution page starts again at its product step

  // ---- views ----
  const header = <ProposalHubHeader activeTab="generator" type={flow.templateType} typeLabel={flow.subtitle} generatePath={flow.generatePath} showGenerate showTemplate={isAdmin} />;

  const errorBox = error && (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: '0.87rem', display: 'flex', gap: 8 }}>
      <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} /> <div>{error.message}</div>
    </div>
  );

  let body;
  if (step === 'loading') {
    body = <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}><RefreshCw size={22} className="spin" /></div>;
  } else if (step === 'upload' && tpl && !tpl.template && !refParam) {
    body = (
      <div style={{ ...card, textAlign: 'center', maxWidth: 620, margin: '0 auto' }}>
        <Layers size={36} color="#0284c7" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#0B2A6F' }}>{flow.noTemplate.title}</h2>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '0.9rem' }}>An admin needs to upload a {flow.noTemplate.text} proposal template first. Open <strong>Upload Latest Template</strong>, choose type <strong>{flow.noTemplate.type}</strong> and upload the .docx.</p>
        <button onClick={() => navigate(flow.noTemplate.href)} style={primaryBtn(false)}><Upload size={16} /> Go to Upload Latest Template</button>
      </div>
    );
  } else if (step === 'upload') {
    body = (
      <div style={{ ...card, maxWidth: 680, margin: '0 auto' }}>
        {errorBox}
        <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', color: '#0B2A6F' }}>Upload the quotation Excel</h2>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '0.88rem' }}>
          Upload an .xlsx quotation (max 10 MB){tpl && tpl.template ? <> to fill the active {flow.templateWords} <strong>{tpl.template.filename}</strong> (version {tpl.template.version})</> : null}. If the workbook has several sheets you will choose one next.
        </p>
        <label htmlFor="solution-xlsx" style={{ display: 'block', border: '2px dashed #93c5fd', borderRadius: 10, padding: '34px 20px', textAlign: 'center', background: '#f0f9ff', cursor: busy ? 'wait' : 'pointer' }}>
          <input id="solution-xlsx" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} disabled={busy}
            onChange={e => { onFile(e.target.files[0]); e.target.value = ''; }} />
          {busy ? <RefreshCw size={36} color="#0284c7" className="spin" style={{ margin: '0 auto 10px' }} /> : <FileSpreadsheet size={38} color="#0284c7" style={{ margin: '0 auto 10px' }} />}
          <div style={{ fontWeight: 700, color: '#0369a1' }}>{busy ? 'Uploading...' : 'Click to choose an Excel (.xlsx) file'}</div>
        </label>
      </div>
    );
  } else if (step === 'sheets') {
    body = (
      <div style={{ ...card, maxWidth: 680, margin: '0 auto' }}>
        {errorBox}
        <h2 style={{ margin: '0 0 4px', fontSize: '1.2rem', color: '#0B2A6F' }}>Choose the quotation sheet</h2>
        <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: '0.86rem' }}>{upload.filename} has {upload.sheets.length} sheet{upload.sheets.length === 1 ? '' : 's'}. Each sheet is one quotation.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {upload.sheets.map(s => (
            <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: sheet === s.name ? '1.5px solid #0284c7' : BORDER, borderRadius: 8, background: sheet === s.name ? '#f0f9ff' : '#fff', cursor: 'pointer' }}>
              <input type="radio" name="sheet" checked={sheet === s.name} onChange={() => setSheet(s.name)} />
              <FileSpreadsheet size={16} color="#16a34a" />
              <span style={{ fontWeight: 600, color: '#0f172a' }}>{s.name.trim() || '(unnamed)'}</span>
              {s.hidden && <span style={{ fontSize: '0.72rem', color: '#92400e', background: '#fef3c7', padding: '1px 8px', borderRadius: 10 }}>hidden</span>}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={generate} disabled={!sheet} style={primaryBtn(!sheet)}>
            {error && error.retry ? <><RefreshCw size={16} /> Try again</> : <>Generate proposal</>}
          </button>
          <button onClick={backToUpload} style={ghostBtn}>Upload a different file</button>
        </div>
      </div>
    );
  } else if (step === 'working') {
    body = (
      <div style={{ ...card, maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <RefreshCw size={34} color="#0284c7" className="spin" style={{ margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 700, color: '#0B2A6F' }}>Reading the sheet and filling the template...</div>
        <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: 6 }}>This can take up to a minute or two.</div>
      </div>
    );
  } else {
    const numberWarnings = warnings.filter(w => !w.kind || w.kind === 'number');
    const rowWarnings = warnings.filter(w => w.kind === 'row');
    // top-level tables / lists with no rows: their section is removed from the document (worked out live from the form)
    const hasRows = v => Array.isArray(v) && v.some(r => r && typeof r === 'object');
    const emptyLoops = schema.filter(t => t.type === 'loop' && !hasRows(fields[t.name]));
    const driftWarnings = warnings.filter(w => w.kind === 'drift');
    // An empty account-manager phone is not a warning (it stays blank in the document); the other missing profile details still are
    const checkUserMissing = userMissing.filter(u => u.field !== 'phone');
    const placeholders = Object.fromEntries(checkUserMissing.map(u => [u.tag, userFieldPhrase(u.field)]));
    const actionBtn = { ...ghostBtn, padding: '7px 12px' };
    // The customer logo upload sits in the section of the form that holds the template's logo place (the About block of the templates we have);
    // a template without such a section, or without a logo place at all, gets it on its own at the top of the fields
    const logoInSection = schema.some(t => t.name === logoField && t.type !== 'loop');
    const hideLogo = flow.templateType === 'solution'; // the Solution proposal has no customer logo box (Product + Solution keeps it)
    const logoNode = (inSection) => hideLogo ? null : (
      <CustomerLogoField logo={logoOf(fields)} place={logoPlace} inSection={inSection}
        onChange={url => { setFields(prev => ({ ...prev, __meta: { ...(prev.__meta || {}), leadLogo: url } })); setDirty(true); }} />
    );
    const viewOnly = isFinalStatus(proposal.status); // Confirmed / Completed: opened from the archive with View
    body = (
      <div>
        {viewOnly && <ViewOnlyBanner status={proposal.status} onBack={() => navigate(`/proposals/product?tab=archive&expand=${encodeURIComponent(proposal.refNo || proposal.id)}`)} />}
        {/* Narrow screens: switch between the form and the preview, as on the product screen */}
        <div className="proposal-mobile-tab-toggle">
          {[['editor', 'Edit Form'], ['preview', 'Live Preview']].map(([k, text]) => (
            <button key={k} type="button" className="proposal-mobile-tab-btn" onClick={() => setMobileTab(k)}
              style={{ background: mobileTab === k ? '#ffffff' : 'transparent', color: mobileTab === k ? '#0284c7' : '#64748b', boxShadow: mobileTab === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {text}
            </button>
          ))}
        </div>
        <div className="proposal-split-container" style={{ gridTemplateColumns: 'minmax(360px, 560px) minmax(0, 1fr)' }}>
          <div className={`proposal-split-left ${mobileTab === 'preview' ? 'mobile-hidden-pane' : ''}`}>
            <fieldset disabled={viewOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div style={{ ...card, padding: 16, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0369a1' }}>{proposal.refNo || 'Reference number not set'}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Sheet: {(proposal.solution && proposal.solution.sheetName || '').trim()}</div>
              </div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Customer name (used in the archive and file name)</label>
              <input type="text" value={companyName} style={input} onChange={e => { setCompanyName(e.target.value); setDirty(true); }} />
            </div>
            {!proposal.refNo && (
              <div style={{ marginBottom: 12, fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={15} /> No reference number found — the proposal is generated without one.
              </div>
            )}
            {notice && (
              <div style={{ marginBottom: 12, fontSize: '0.84rem', fontWeight: 600, color: notice.ok ? '#166534' : '#991b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
                {notice.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {notice.text}
              </div>
            )}
            <div style={{ ...card, padding: 16 }}>
              {!hideLogo && !logoInSection && logoNode(false)}
              {schema.map(tag => (
                <TagField key={tag.name} tag={tag} value={fields[tag.name]} path={[tag.name]} prefix="" onChange={onChange} warn={warn} placeholder={placeholders[tag.name]}
                  above={logoInSection && tag.name === logoField ? logoNode(true) : null} />
              ))}
              <div style={{ marginTop: 8, paddingTop: 14, borderTop: BORDER }}>
                <button onClick={startOver} style={ghostBtn}>{flow.startAnother}</button>
              </div>
            </div>
            </fieldset>
          </div>
          <ConfirmModal
            isOpen={confirmRegen}
            title="Regenerate from the Excel?"
            message="You have changed this proposal by hand. Regenerating runs the AI agent again and replaces the text of every section, including your edits to About you, Proposed solution and Project scope, with a fresh result. The reference number, the status, the uploaded documents and the customer logo stay, and your current version stays in the history. Continue?"
            confirmText="Yes, regenerate"
            cancelText="Keep my version"
            variant="warning"
            icon={<RotateCcw size={24} color="#d97706" />}
            onConfirm={doRegenerate}
            onCancel={() => setConfirmRegen(false)}
          />
          <div className={mobileTab === 'editor' ? 'mobile-hidden-pane' : ''}>
            <SolutionPdfPreview
              fields={fields}
              trigger={previewTrigger}
              fetchPdf={() => flow.api.exportFile({ fields: plainFields(fields), templateId: proposal.templateId, companyName, format: 'pdf', id: proposal.id, logo: logoChange(fields, proposal) }, userEmail)}
              actions={(
                <>
                  {!isFinalStatus(proposal.status) && <button onClick={doSave} disabled={busy || !dirty} style={{ ...actionBtn, opacity: busy || !dirty ? 0.6 : 1 }}><Save size={14} /> Save</button>}
                  <button onClick={() => doExport('docx')} disabled={busy} style={{ ...actionBtn, background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}><Download size={14} /> Word</button>
                  <button onClick={() => doExport('pdf')} disabled={busy} style={{ ...actionBtn, background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}><Download size={14} /> PDF</button>
                  <button onClick={doSource} style={actionBtn}><FileSpreadsheet size={14} /> Original Excel</button>
                  {!isFinalStatus(proposal.status) && <button onClick={() => (hasEdits() ? setConfirmRegen(true) : doRegenerate())} disabled={busy} title="Run the AI agent again on the original Excel" style={{ ...actionBtn, opacity: busy ? 0.6 : 1 }}><RotateCcw size={14} /> Regenerate</button>}
                </>
              )}
            />
          </div>
        </div>
      </div>
    );
  }

  if (embedded) return <div>{body}</div>; // the Product + Solution page draws its own header and frame

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {header}
      <main style={{ flex: 1, padding: '28px 24px', width: '100%', boxSizing: 'border-box' }}>{body}</main>
    </div>
  );
}
