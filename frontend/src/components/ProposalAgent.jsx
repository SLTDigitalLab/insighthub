import { useEffect, useMemo, useRef, useState } from 'react';
// React hooks for state, effects, memoised lists and DOM refs
import axios from 'axios';
// Same HTTP client as the rest of InsightHub
import { Search, Building2, MapPin, Star, Download, ChevronDown, ChevronRight, ArrowLeft, Loader2, FileText, Plus, Trash2, Sparkles, X, RefreshCw, Upload } from 'lucide-react';
// Same icon library the Dashboard already uses
import ConfirmModal from './ConfirmModal';

const API = '/api/proposals';
// Relative path like the other calls in api.js — Vite/nginx forwards it to the backend
const ACTIVE_SESSION_KEY = 'insightHub_activeProposalSession';
const CONTACT_KEYS = ['amName', 'amDesignation', 'amPhone', 'amEmail', 'amDivision', 'rebmName', 'rebmDesignation', 'rebmPhone', 'rebmEmail', 'rebmDivision'];
// Contact fields the rep can edit on the Contact page section
const ACK_KEYS = ['ackAddressee1', 'ackAddressee2', 'ackDate', 'ackPrefill', 'ackCompanyName', 'ackAddress', 'ackSolution', 'ackInitialCharge', 'ackMonthlyCharge', 'ackCommitment'];
// Customer Acknowledgements page fields; like the contacts, typed values survive a new Generate

async function apiError(err) {
  const body = err?.response?.data;
  if (body instanceof Blob) {
    try { return JSON.parse(await body.text()).error; } catch { return 'Request failed'; }
    // File requests return errors as a Blob — read the JSON back out
  }
  return [body?.error || err?.message || 'Request failed', body?.detail].filter(Boolean).join(' — ');
  // Shows the backend's reason too (e.g. the message Apify returned), so failures are easy to diagnose
}

async function exportFile(fields, format) {
  const res = await axios.post(`${API}/export`, { fields, format }, { responseType: 'blob', timeout: 150000 });
  // Backend fills the template with these fields and returns a .docx or .pdf
  const match = (res.headers['content-disposition'] || '').match(/filename="?([^"]+)"?/);
  return { blob: res.data, fileName: match ? match[1] : `SLT_Proposal.${format}` };
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  // Triggers the browser download
  a.remove();
  URL.revokeObjectURL(url);
}

async function previewPdf(fields) {
  const res = await axios.post(`${API}/export`, { fields, format: 'pdf' }, { responseType: 'blob', timeout: 150000 });
  // The same PDF the Export PDF button downloads
  let pages = {};
  try { pages = JSON.parse(res.headers['x-proposal-pages'] || '{}'); } catch { /* chips just stay disabled */ }
  return { blob: res.data, pages };
  // pages = { cover, letter, requirements, about, solution, investment } -> PDF page numbers, for the quick-jump chips
}

export default function ProposalAgent({ user = {}, accent = '#0284c7', initialProposal = null, onClearProposal = null }) {
  // Read any saved draft session so tab switching or browser sleep never loses in-progress proposal
  const savedSession = useMemo(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // user = logged-in rep's account details { name, email, designation, phone, division } (any missing one is ''); accent = this agent's sidebar colour
  const [step, setStep] = useState(() => {
    if (initialProposal?.fields) return 'edit';
    if (savedSession?.step === 'edit' && savedSession?.fields) return 'edit';
    if (savedSession?.step === 'products' && savedSession?.business) return 'products';
    return 'search';
  });
  // 'search' -> 'products' -> 'edit'

  const [business, setBusiness] = useState(() => {
    if (initialProposal) return initialProposal.business || { name: initialProposal.companyName, category: initialProposal.category, address: initialProposal.address };
    if (savedSession?.business) return savedSession.business;
    return null;
  });

  const [selected, setSelected] = useState(() => {
    if (initialProposal) return Array.isArray(initialProposal.products) ? initialProposal.products.map(p => typeof p === 'object' ? p.id : p).filter(Boolean) : [];
    if (Array.isArray(savedSession?.selected)) return savedSession.selected;
    return [];
  });

  const [fields, setFields] = useState(() => {
    if (initialProposal?.fields) return initialProposal.fields;
    if (savedSession?.fields) return savedSession.fields;
    return null;
  });

  const [refFromSection, setRefFromSection] = useState(() => {
    if (savedSession?.refFromSection !== undefined) return savedSession.refFromSection;
    return true;
  });

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  // '' or what is running: 'search' | 'generate' | 'docx' | 'pdf'
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [manual, setManual] = useState({ name: '', address: '', category: '' });
  // Business typed in by hand — used when the search isn't available or doesn't find the business
  const [catalogue, setCatalogue] = useState([]);
  const [suggested, setSuggested] = useState([]);
  // false when the server used the neutral SLT- prefix because the account has no Section
  // Ticked product ids, in the order ticked (= order in the proposal)
  const [filter, setFilter] = useState('');
  const [openPillars, setOpenPillars] = useState({});
  const [checks, setChecks] = useState({ notes: [], failed: [] });
  // Proposal Agent notes + sources it couldn't read (kept in state, not shown)
  // Every variable part of the template, generated then edited by the rep
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState({ url: '', pages: {}, fields: null });
  // Last good preview: blob URL of the PDF, section pages, and the fields it was made from
  const [previewError, setPreviewError] = useState('');
  const [viewMode, setViewMode] = useState(() => savedSession?.viewMode || 'doc');
  // 'doc' (interactive live document sheet) | 'pdf' (LibreOffice PDF iframe)
  const [jump, setJump] = useState({ page: 1, n: 0 });
  // Page the preview is showing; n changes on every chip click so the viewer reloads at that page
  const [mobileStep3Tab, setMobileStep3Tab] = useState('editor');
  // 'editor' | 'preview' on screens <= 960px
  const urlRef = useRef('');
  const seq = useRef(0);
  const contactEdits = useRef(savedSession?.contactEdits || {});
  // Contact Us values the rep has typed (key -> value), kept across Generate for this session
  // urlRef = current blob URL (freed when replaced / on leaving); seq drops out-of-date preview responses

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy('search'); setError(''); setResults([]);
    try {
      const { data } = await axios.get(`${API}/search`, { params: { q: query.trim() }, timeout: 180000 });
      // Google Maps search through the backend; can take 15–40 s
      setResults(data.results);
      if (data.results.length === 0) setError('No businesses found. Try a more specific name, or enter the business manually below.');
    } catch (err) {
      console.warn('[proposalAgent/search]', err);
      setError('Unable to fetch live directory results right now. You can enter the business manually below.');
    } finally { setBusy(''); }
  }

  async function chooseBusiness(b) {
    let leadLogo = b.logo || b.logoUrl || '';
    if (!leadLogo && b.website) {
      try {
        const domain = b.website.replace(/https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').trim();
        if (domain && domain.includes('.')) {
          leadLogo = `https://unavatar.io/${domain}`;
        }
      } catch (e) {}
    }
    const enriched = { ...b, leadLogo };
    setBusiness(enriched); setSelected([]); setFilter(''); setOpenPillars({}); setError(''); setFields(null);
    // Start a fresh proposal for this business
    try {
      const { data } = await axios.get(`${API}/products`, { params: { category: b.category } });
      // SLT product list + suggestions for this business type
      setCatalogue(data.products); setSuggested(data.suggested);
      // The reference number is issued by the server when the proposal is generated
      setStep('products');
    } catch (err) { setError(await apiError(err)); }
  }

  async function handleGenerate() {
    setBusy('generate'); setError('');
    try {
      const { data } = await axios.post(`${API}/generate`, {
        business, productIds: selected,
        // No reference number is sent: every Generate gets a new unique one from the server
        user: {
          name: user.name || '',
          designation: user.designation || '',
          phone: user.phone || '',
          email: user.email || '',
          division: user.division || '',
        },
        // Primary Contact = only the logged-in user's account details (Request Access form); a missing one stays ''
      });
      // Backend fills the proposal from the business, the ticked products and the logged-in user
      // (anything still missing is looked up in that same account by email, never from anywhere else)
      const next = { ...data.fields, ...contactEdits.current, leadLogo: business.leadLogo || data.fields?.leadLogo || '' };
      // Contact values the rep already typed this session win over the regenerated ones
      setFields(next);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
      setPreview({ url: '', pages: {}, fields: null }); setPreviewError(''); setJump({ page: 1, n: 0 });
      // A new proposal never shows the previous business's PDF
      refreshPreview(next);
      // First preview of the new proposal, from the cover
      setChecks({ notes: Array.isArray(data.notes) ? data.notes : [], failed: Array.isArray(data.sources?.failed) ? data.sources.failed : [] });
      setRefFromSection(data.refFromSection !== false);
      setStep('edit');
    } catch (err) { setError(await apiError(err)); } finally { setBusy(''); }
  }

  async function handleExport(format) {
    setBusy(format); setError('');
    try {
      const file = await exportFile(fields, format);
      saveBlob(file.blob, file.fileName);
      // Downloads the Word or PDF file
    } catch (err) {
      const msg = await apiError(err);
      if (format === 'pdf' && msg.includes('LibreOffice')) {
        setError("PDF export requires LibreOffice on the host. You can click 'Word' right now to download the complete .docx proposal, or deploy to the production server where LibreOffice converts automatically.");
      } else {
        setError(msg);
      }
    } finally { setBusy(''); }
  }

  const set = (key, value) => {
    setFields(f => ({ ...f, [key]: value }));
    // Changes only this one field; every other edit stays as it is
    if (CONTACT_KEYS.includes(key) || ACK_KEYS.includes(key)) contactEdits.current = { ...contactEdits.current, [key]: value };
    // Remembers typed contact / acknowledgement values so a later Generate (this session) doesn't overwrite them
  };
  const setAckPrefill = on => {
    setFields(f => ({
      ...f,
      ackPrefill: on,
      ackCompanyName: on ? f.companyName || '' : '',
      ackAddress: on ? [f.addressLine1, f.addressLine2, f.city].map(s => String(s || '').trim()).filter(Boolean).join(' ') : '',
      ackSolution: on ? f.solutionName || '' : '',
    }));
    // On: copy Company Name / Address / Solution from the proposal; off: empty (the dotted lines print)
    const rest = Object.fromEntries(Object.entries(contactEdits.current).filter(([k]) => !['ackCompanyName', 'ackAddress', 'ackSolution'].includes(k)));
    contactEdits.current = on ? { ...rest, ackPrefill: true } : { ...rest, ackPrefill: false, ackCompanyName: '', ackAddress: '', ackSolution: '' };
    // Kept for the next Generate: on = take the new proposal's values, off = stay empty
  };
  const setRow = (list, i, key, value) => setFields(f => ({ ...f, [list]: f[list].map((r, n) => (n === i ? { ...r, [key]: value } : r)) }));
  const addRow = (list, empty) => setFields(f => ({ ...f, [list]: [...(f[list] || []), empty] }));
  const delRow = (list, i) => setFields(f => ({ ...f, [list]: f[list].filter((_, n) => n !== i) }));
  // Helpers to edit one field, one table cell, or add/remove a row
  const setRecProduct = (i, id) => {
    const p = catalogue.find(x => x.id === id);
    setFields(f => ({ ...f, recommendations: f.recommendations.map((r, n) => (n === i ? { ...r, id, name: p ? p.name : '', reason: p ? (String(p.description).match(/^.*?[.!?](\s|$)/) || [p.description])[0].trim() : '' } : r)) }));
  };
  // Picking another product takes its exact catalogue name and a starting reason from its catalogue description

  async function refreshPreview(f = fields) {
    if (!f) return;
    const mine = ++seq.current;
    setPreviewing(true); setPreviewError('');
    try {
      const { blob, pages } = await previewPdf(f);
      if (mine !== seq.current) return;
      // A newer refresh already started — ignore this one
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      // Frees the old PDF's memory once the new one is ready
      setPreview({ url, pages, fields: f });
      setViewMode('pdf');
      setJump(j => ({ page: j.page, n: j.n + 1 }));
      // Shows the new PDF at the page the rep was on
    } catch (err) {
      if (mine === seq.current) {
        setPreviewError(`PDF engine notice: ${await apiError(err)}`);
        setViewMode('doc');
      }
      // Keeps the interactive document sheet visible
    } finally {
      if (mine === seq.current) setPreviewing(false);
    }
  }
  // Renders the real PDF (same as Export PDF). Runs after Generate and when the rep clicks "Refresh preview" — not on every keystroke

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  // Frees the PDF when leaving the page

  // Ensure product catalogue is always loaded so features and diagrams render properly
  useEffect(() => {
    if (catalogue.length === 0) {
      axios.get(`${API}/products`, { params: { category: business?.category || '' } })
        .then(({ data }) => {
          if (Array.isArray(data.products)) setCatalogue(data.products);
          if (Array.isArray(data.suggested)) setSuggested(data.suggested);
        })
        .catch(err => console.warn('[proposalAgent/products]', err.message));
    }
  }, [business?.category, catalogue.length]);

  // Auto-persist active proposal session to localStorage (prevents loss on tab switch, sleep, or reload)
  useEffect(() => {
    if (step === 'edit' && fields && business) {
      try {
        const payload = {
          step: 'edit',
          business,
          selected,
          fields,
          refFromSection,
          contactEdits: contactEdits.current,
          viewMode,
          updatedAt: Date.now()
        };
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn('[proposalAgent/saveSession]', err);
      }
    } else if (step === 'products' && business) {
      try {
        const payload = {
          step: 'products',
          business,
          selected,
          updatedAt: Date.now()
        };
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
      } catch {}
    }
  }, [step, fields, business, selected, refFromSection, viewMode]);

  useEffect(() => {
    if (initialProposal && initialProposal.fields) {
      setFields(initialProposal.fields);
      const b = initialProposal.business || { name: initialProposal.companyName, category: initialProposal.category, address: initialProposal.address };
      setBusiness(b);
      const sel = Array.isArray(initialProposal.products) ? initialProposal.products.map(p => typeof p === 'object' ? p.id : p).filter(Boolean) : [];
      setSelected(sel);
      setStep('edit');
      refreshPreview(initialProposal.fields);
    }
  }, [initialProposal]);

  // Reconnection and tab visibility recovery (e.g. returning from YouTube or other tabs)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (step === 'edit' && fields && viewMode === 'pdf' && !preview.url && !previewing) {
          refreshPreview(fields);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [step, fields, viewMode, preview.url, previewing]);

  const [confirmFreshOpen, setConfirmFreshOpen] = useState(false);

  const handleStartFresh = () => {
    setConfirmFreshOpen(true);
  };

  const executeStartFresh = () => {
    setConfirmFreshOpen(false);
    try {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
    setFields(null);
    setBusiness(null);
    setSelected([]);
    setFilter('');
    setStep('search');
    setResults([]);
    setError('');
    setPreview({ url: '', pages: {}, fields: null });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    contactEdits.current = {};
    if (onClearProposal) onClearProposal();
  };

  function jumpTo(key) {
    if (viewMode === 'pdf' && preview.url) {
      const page = key === 'cover' ? 1 : preview.pages[key];
      if (page) setJump(j => ({ page, n: j.n + 1 }));
    } else {
      const el = document.getElementById(`proposal-sec-${key}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  const previewStale = !!preview.url && preview.fields !== fields;
  // The rep edited something since the last refresh

  const byId = useMemo(() => Object.fromEntries(catalogue.map(p => [p.id, p])), [catalogue]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? catalogue.filter(p => `${p.name || ''} ${p.description || ''}`.toLowerCase().includes(f)) : catalogue;
    return list.reduce((acc, p) => { (acc[p.pillar] = acc[p.pillar] || []).push(p); return acc; }, {});
    // Products grouped by pillar (Networking, Internet, Cyber Security…); the search box matches product name and description
    // in every pillar, case-insensitive, and a pillar with no matches drops out
  }, [catalogue, filter]);
  const toggle = id => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const grad = `linear-gradient(90deg, ${accent}, #14b8a6)`;

  const field = (label, key, rows) => (
    <label style={S.label}>
      <span>{label}</span>
      {rows
        ? <textarea rows={rows} style={S.input} value={fields[key] || ''} onChange={e => set(key, e.target.value)} />
        : <input style={S.input} value={fields[key] || ''} onChange={e => set(key, e.target.value)} />}
    </label>
  );
  // One labelled edit box bound to fields[key]
  const refField = () => (
    <label style={S.label}>
      <span>Proposal Ref. No.</span>
      <input style={{ ...S.input, background: '#f1f5f9', cursor: 'default' }} value={fields.refNo || ''} readOnly title="Issued automatically; unique" />
      {/* Read-only: the server issues each reference once and records it, so it is never repeated */}
      <span style={{ fontSize: '0.72rem' }}>Issued automatically; unique{refFromSection ? '' : ' · No section in your account'}</span>
    </label>
  );
  // Same reference on the cover, every page header and the Acknowledgements page

  /* ───────────── Step 1: search for a business ───────────── */
  if (step === 'search') {
    return (
      <div>
        <form onSubmit={handleSearch} style={S.searchRow}>
          <div style={S.searchBox}>
            <Search size={20} color="var(--text-muted, #64748b)" />
            <input style={S.searchInput} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a business — e.g. Earl's Regency Hotel Kandy" />
          </div>
          <button type="submit" style={{ ...S.primary, background: grad }} disabled={busy === 'search'}>
            {busy === 'search' ? <Loader2 size={18} className="spin" /> : <Search size={18} />} {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && <div style={S.error}>{error}</div>}
        {busy === 'search' && <div style={S.empty}><Loader2 size={36} color={accent} className="spin" /><p>Searching for businesses… this can take up to a minute.</p></div>}
        {!busy && results.length === 0 && !error && (
          <div style={S.empty}>
            <FileText size={46} color={accent} strokeWidth={1.4} />
            <h3 style={{ margin: '12px 0 4px', color: 'var(--text-main, #0f172a)' }}>Search for a business to start a proposal</h3>
            <p style={{ margin: 0 }}>1. Pick the business &nbsp;→&nbsp; 2. Choose SLT-Mobitel products &nbsp;→&nbsp; 3. Generate, edit and export</p>
          </div>
        )}
        {busy !== 'search' && (
          <form
            style={S.manual}
            onSubmit={e => { e.preventDefault(); if (manual.name.trim()) chooseBusiness({ id: 'manual', city: '', ...manual, name: manual.name.trim() }); }}
          >
            {/* Skips the search: type the business details and continue straight to the product list */}
            <div style={S.h2}>Or enter the business manually</div>
            <div style={S.meta}>Use this if the search is unavailable or the business isn't listed.</div>
            <div style={S.manualRow}>
              <input style={S.input} placeholder="Business name *" value={manual.name} onChange={e => setManual(m => ({ ...m, name: e.target.value }))} />
              <input style={S.input} placeholder="Address — e.g. 12 Galle Road, Colombo 03" value={manual.address} onChange={e => setManual(m => ({ ...m, address: e.target.value }))} />
              <input style={S.input} placeholder="Business type — e.g. Hotel, Bank" value={manual.category} onChange={e => setManual(m => ({ ...m, category: e.target.value }))} />
              <button type="submit" style={{ ...S.primary, minHeight: 38, padding: '0 18px', background: grad, opacity: manual.name.trim() ? 1 : 0.5 }} disabled={!manual.name.trim()}>Continue</button>
            </div>
          </form>
        )}
        <div style={S.resultGrid}>
          {results.map(r => (
            <button key={r.id} style={S.resultCard} onClick={() => chooseBusiness(r)}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                <div style={{ ...S.bubble, background: `${accent}18`, color: accent }}><Building2 size={20} /></div>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <div style={S.name}>{r.name}</div>
                    {r.leadScore && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                        {r.leadScore}
                      </span>
                    )}
                  </div>
                  {r.category && <div style={S.meta}>{r.category}</div>}
                  {r.address && <div style={S.meta}><MapPin size={13} /> {r.address}</div>}
                  {r.phone && <div style={S.meta}>📞 {r.phone}</div>}
                  {r.rating != null && <div style={S.meta}><Star size={13} /> {r.rating}{r.reviews ? ` (${r.reviews})` : ''}</div>}
                </div>
              </div>
              <span style={{ ...S.pill, color: accent, borderColor: accent }}>Select</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const bizBar = (
    <div style={S.bizBar}>
      <button style={S.ghost} onClick={() => setStep(step === 'edit' ? 'products' : 'search')}>
        <ArrowLeft size={16} /> {step === 'edit' ? 'Change products' : 'Change business'}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '1.08rem', color: 'var(--text-main, #0f172a)' }}>{business.name}</div>
        <div style={S.meta}>{[business.category, business.address].filter(Boolean).join(' · ')}</div>
      </div>
      {step === 'edit' && (
        <button
          type="button"
          onClick={handleStartFresh}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', background: '#f8fafc',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: '0.82rem', fontWeight: 700, color: '#0B2A6F',
            cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
          }}
          title="Clear current active proposal draft and start fresh"
        >
          <RefreshCw size={13} /> Start Fresh Proposal
        </button>
      )}
    </div>
  );
  // Bar showing the chosen business, with a back button

  /* ───────────── Step 2: choose products, then Generate ───────────── */
  if (step === 'products') {
    return (
      <div>
        {bizBar}
        {error && <div style={S.error}>{error}</div>}
        <div style={S.productsHead}>
          <div>
            <div style={S.h2}>Which SLT-Mobitel products should go in the proposal?</div>
            <div style={S.meta}>{selected.length} selected{selected.length ? `: ${selected.map(id => byId[id]?.name).join(', ')}` : ''}</div>
          </div>
          <button style={{ ...S.primary, background: grad, opacity: selected.length ? 1 : 0.5 }} disabled={!selected.length || busy === 'generate'} onClick={handleGenerate}>
            {busy === 'generate' ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />} Generate proposal
          </button>
        </div>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', paddingLeft: 32, paddingRight: 32 }} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search products..." aria-label="Search products" />
          {filter && (
            <button type="button" onClick={() => setFilter('')} aria-label="Clear search" title="Clear search"
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex', color: '#64748b' }}>
              <X size={16} />
            </button>
          )}
        </div>
        {/* Search box: filters the cards below; ticked products stay ticked while searching or after clearing */}

        {filter.trim() && Object.keys(groups).length === 0 && (
          <div style={{ ...S.meta, justifyContent: 'center', padding: '24px 0' }}>No products match your search.</div>
        )}
        {Object.entries(groups).map(([pillar, items]) => {
          const open = filter.trim() ? true : !!openPillars[pillar];
          const count = items.filter(p => selected.includes(p.id)).length;
          return (
            <div key={pillar} style={S.group}>
              <button style={S.groupToggle} onClick={() => setOpenPillars(o => ({ ...o, [pillar]: !o[pillar] }))}>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span style={{ flex: 1, textAlign: 'left' }}>{pillar}</span>
                {count > 0 && <span style={{ ...S.count, background: accent }}>{count}</span>}
                <span style={S.meta}>{items.length} products</span>
              </button>
              {open && <div style={S.productGrid}>{items.map(p => <ProductRow key={p.id} p={p} on={selected.includes(p.id)} onToggle={toggle} accent={accent} />)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  /* ───────────── Step 3: edit the generated proposal, preview, export ───────────── */
  return (
    <div>
      {bizBar}
      {error && <div style={S.error}>{error}</div>}

      {/* Mobile-only toggle switcher between Form Editor and Live Preview */}
      <div className="proposal-mobile-tab-toggle">
        <button
          type="button"
          onClick={() => setMobileStep3Tab('editor')}
          className="proposal-mobile-tab-btn"
          style={{
            background: mobileStep3Tab === 'editor' ? '#ffffff' : 'transparent',
            color: mobileStep3Tab === 'editor' ? accent : '#64748b',
            boxShadow: mobileStep3Tab === 'editor' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
          }}
        >
          <FileText size={16} /> Edit Form
        </button>
        <button
          type="button"
          onClick={() => {
            if (!preview.url && viewMode === 'pdf') refreshPreview();
            setMobileStep3Tab('preview');
          }}
          className="proposal-mobile-tab-btn"
          style={{
            background: mobileStep3Tab === 'preview' ? '#ffffff' : 'transparent',
            color: mobileStep3Tab === 'preview' ? accent : '#64748b',
            boxShadow: mobileStep3Tab === 'preview' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
          }}
        >
          <Sparkles size={16} /> Live Preview
        </button>
      </div>

      <div className="proposal-split-container" style={S.split}>
        <div className={`proposal-split-left ${mobileStep3Tab === 'preview' ? 'mobile-hidden-pane' : ''}`} style={S.left}>
          <div style={S.h2}>Edit proposal</div>
          <p style={{ ...S.meta, marginBottom: 12 }}>Click Refresh preview to see your edits in the PDF.</p>

          <Section title="Cover & letter (pages 1–3)">
            {field('Business name', 'companyName')}
            <div style={{ marginBottom: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main, #0f172a)' }}>
                  Client Company Logo (Cover Page)
                </span>
                {fields.leadLogo && (
                  <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                    Loaded
                  </span>
                )}
              </div>

              {fields.leadLogo ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 10 }}>
                    <div style={{ minWidth: 64, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 4 }}>
                      <img
                        src={fields.leadLogo}
                        alt="Client logo"
                        style={{ maxHeight: 36, maxWidth: 90, objectFit: 'contain' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fields.companyName || 'Client'} Logo
                      </div>
                      <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                        Placed on the cover page to the right of the Mobitel logo
                      </div>
                    </div>
                    <label style={{ ...S.ghost, padding: '6px 12px', fontSize: '0.82rem', cursor: 'pointer', margin: 0, borderColor: '#0B2A6F', color: '#0B2A6F', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={14} /> Change logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => set('leadLogo', ev.target.result);
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      style={{ ...S.del, padding: 6, alignSelf: 'center', color: '#ef4444' }}
                      title="Remove logo"
                      onClick={() => set('leadLogo', '')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Logo Display Size Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Cover Logo Size:</span>
                    {[
                      { id: 'small', label: 'Small' },
                      { id: 'medium', label: 'Medium (Normal)' },
                      { id: 'large', label: 'Large (High visibility)' }
                    ].map(opt => {
                      const active = (fields.leadLogoSize || 'medium') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => set('leadLogoSize', opt.id)}
                          style={{
                            border: active ? '1.5px solid #0B2A6F' : '1px solid #cbd5e1',
                            background: active ? '#eff6ff' : '#fff',
                            color: active ? '#0B2A6F' : '#64748b',
                            fontWeight: active ? 700 : 500,
                            borderRadius: 6,
                            padding: '3px 10px',
                            fontSize: '0.74rem',
                            cursor: 'pointer'
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      style={{ ...S.input, flex: 1, fontSize: '0.82rem' }}
                      placeholder="Paste image URL or click Change logo to upload..."
                      value={fields.leadLogo || ''}
                      onChange={e => set('leadLogo', e.target.value)}
                    />
                    <label style={{ ...S.ghost, padding: '7px 14px', fontSize: '0.82rem', cursor: 'pointer', margin: 0, background: '#0B2A6F', color: '#fff', borderColor: '#0B2A6F', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={14} /> Change logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => set('leadLogo', ev.target.result);
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 6 }}>
                    Tip: If no logo is uploaded, the company name is formatted in bold dark navy Verdana.
                  </div>
                </div>
              )}
            </div>
            <div className="proposal-two-col" style={S.two}>{refField()}{field('Date (DD/MM/YYYY)', 'proposalDate')}</div>
            {field('Addressed to', 'recipientDesignation')}
            {field('Address line 1', 'addressLine1')}
            {field('Address line 2', 'addressLine2')}
            {field('City', 'city')}
            <p style={S.meta}>The letter prints the address on one line, separated by commas.</p>
            {field('Proposal for (solution)', 'solutionName')}
            {field('Letter paragraph 1', 'solutionIntro1', 5)}
            {field('Letter paragraph 2', 'solutionIntro2', 3)}
            <p style={S.meta}>The letter's closing line uses the Primary Contact name and number (Contact page section below).</p>
          </Section>

          <Section title="Your requirements (page 6)">
            {fields.requirements.map((r, i) => (
              <div key={i} style={S.card}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.input, flex: 1, fontWeight: 600 }} value={r.title} onChange={e => setRow('requirements', i, 'title', e.target.value)} />
                  <button style={S.del} onClick={() => delRow('requirements', i)} title="Remove"><Trash2 size={15} /></button>
                </div>
                <textarea rows={3} style={{ ...S.input, marginTop: 6 }} value={r.text} onChange={e => setRow('requirements', i, 'text', e.target.value)} />
                <div style={S.meta}>{r.id ? 'Network diagram included' : 'No diagram (custom requirement)'}</div>
                {(byId[r.id]?.features || []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ ...S.meta, gap: 6, cursor: 'pointer', color: 'var(--text-main, #0f172a)', fontWeight: 600 }}>
                      <input type="checkbox" checked={r.showFeatures !== false} onChange={e => setRow('requirements', i, 'showFeatures', e.target.checked)} />
                      Show Key Features
                    </label>
                    {/* On by default; unticked = this product's Key Features are left out of the preview and the Word/PDF */}
                    <ul style={{ ...S.featureList, opacity: r.showFeatures !== false ? 1 : 0.45 }}>
                      {byId[r.id].features.map((f, n) => <li key={n}>{f}</li>)}
                    </ul>
                    {/* Read-only: exact wording from the Product & Solution Portfolio knowledge base, as it will print */}
                  </div>
                )}
              </div>
            ))}
            <button style={S.add} onClick={() => addRow('requirements', { id: '', title: '', text: '' })}><Plus size={14} /> Add requirement</button>
          </Section>

          <Section title="About you and how we can help you (page 7)">
            {field('About the business (2–4 sentences)', 'aboutDescription', 5)}
            <p style={S.meta}>Written only from the business details above. Add facts you know about the customer; nothing is looked up.</p>
            <div style={{ ...S.groupLabel, marginTop: 6 }}>Recommended SLT-MOBITEL products</div>
            {(fields.recommendations || []).map((r, i) => (
              <div key={i} style={S.card}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.input, flex: 1, fontWeight: 600 }} value={byId[r.id] ? r.id : ''} onChange={e => setRecProduct(i, e.target.value)}>
                    {!byId[r.id] && <option value="">Choose a product…</option>}
                    {catalogue.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {/* Only knowledge-base products can be chosen, by their exact names */}
                  <button style={S.del} onClick={() => delRow('recommendations', i)} title="Remove"><Trash2 size={15} /></button>
                </div>
                <input style={{ ...S.input, marginTop: 6 }} placeholder="Why it fits this customer (one line)" value={r.reason || ''} onChange={e => setRow('recommendations', i, 'reason', e.target.value)} />
                <label style={{ ...S.meta, gap: 6, marginTop: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!r.highPriority} onChange={e => setRow('recommendations', i, 'highPriority', e.target.checked)} />
                  High priority
                </label>
              </div>
            ))}
            {(fields.recommendations || []).length < 5 && (
              <button style={S.add} onClick={() => addRow('recommendations', { id: '', name: '', reason: '', highPriority: false })}><Plus size={14} /> Add product</button>
            )}
            {(fields.recommendations || []).filter(r => byId[r.id]).length < 3 && <p style={{ ...S.meta, color: '#b45309' }}>Recommend 3 to 5 products.</p>}
            <p style={S.meta}>This section always prints on one page; very long text is shortened in the PDF/Word only.</p>
          </Section>

          <Section title="Your investment (LKR)">
            {fields.investment.map((r, i) => (
              <div key={i} style={S.card}>
                <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', fontWeight: 600 }} placeholder="Description" value={r.description} onChange={e => setRow('investment', i, 'description', e.target.value)} />
                <div className="proposal-two-col" style={{ ...S.two, marginTop: 6 }}>
                  <input style={S.input} placeholder="Speed" value={r.bandwidth} onChange={e => setRow('investment', i, 'bandwidth', e.target.value)} />
                  <input style={S.input} placeholder="QoS template" value={r.qosTemplate || ''} onChange={e => setRow('investment', i, 'qosTemplate', e.target.value)} />
                  <input style={S.input} placeholder="One-time" inputMode="decimal" value={r.oneTimeCharge} onChange={e => setRow('investment', i, 'oneTimeCharge', e.target.value)} />
                  <input style={S.input} placeholder="Monthly" inputMode="decimal" value={r.monthlyRental} onChange={e => setRow('investment', i, 'monthlyRental', e.target.value)} />
                </div>
                {/* Speed / QoS Template / One Time Charge / Monthly Rental, the four value columns of the template's table */}
                <button style={{ ...S.del, marginTop: 4 }} onClick={() => delRow('investment', i)}><Trash2 size={14} /> Remove row</button>
              </div>
            ))}
            <button style={S.add} onClick={() => addRow('investment', { description: '', bandwidth: '', qosTemplate: '', oneTimeCharge: '', monthlyRental: '' })}><Plus size={14} /> Add row</button>
            <p style={S.meta}>Blank prices print as "On request"; a blank QoS template prints "N/A".</p>
          </Section>

          <Section title="Contact page">
            <div style={S.groupLabel}>Primary Contact</div>
            <div className="proposal-two-col" style={S.two}>{field('Name', 'amName')}{field('Designation', 'amDesignation')}</div>
            <div className="proposal-two-col" style={S.two}>{field('Contact Number', 'amPhone')}{field('Email', 'amEmail')}</div>
            {field('Division', 'amDivision')}
            <p style={S.meta}>Filled from your InsightHub account (the Request Access form); anything your account doesn't have stays empty. Name and number also go in the letter's closing line.</p>
            <div style={{ ...S.groupLabel, marginTop: 10 }}>Secondary Contact</div>
            <div className="proposal-two-col" style={S.two}>{field('Name', 'rebmName')}{field('Designation', 'rebmDesignation')}</div>
            <div className="proposal-two-col" style={S.two}>{field('Contact Number', 'rebmPhone')}{field('Email', 'rebmEmail')}</div>
            {field('Division', 'rebmDivision')}
            <p style={S.meta}>Filled from the backend's proposal settings, not from your account. Empty fields print nothing.</p>
          </Section>

          <Section title="Acknowledgements page">
            {field('Addressee line 1', 'ackAddressee1')}
            {field('Addressee line 2', 'ackAddressee2')}
            <div className="proposal-two-col" style={S.two}>{field('Proposal submission date (DD/MM/YYYY)', 'ackDate')}{refField()}</div>
            <p style={S.meta}>The reference number is the same one as on the cover and every page header.</p>
            <label style={{ ...S.meta, gap: 6, margin: '6px 0 10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={fields.ackPrefill !== false} onChange={e => setAckPrefill(e.target.checked)} />
              Pre-fill from proposal (Company Name, Address, Solution)
            </label>
            {field('Company Name', 'ackCompanyName')}
            {field('Address', 'ackAddress')}
            {field('Solution', 'ackSolution')}
            <div className="proposal-two-col" style={S.two}>{field('Initial Charge', 'ackInitialCharge')}{field('Monthly Charge', 'ackMonthlyCharge')}</div>
            {field('Commitment Period', 'ackCommitment')}
            <p style={S.meta}>An empty line prints the dotted line for the customer to fill in by hand.</p>
          </Section>
        </div>

        <div className={`proposal-split-right ${mobileStep3Tab === 'editor' ? 'mobile-hidden-pane' : ''}`} style={S.right}>
          <div style={S.previewBar}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 3, background: '#f1f5f9', padding: '3px', borderRadius: 8, marginRight: 4 }}>
                <button
                  type="button"
                  onClick={() => setViewMode('doc')}
                  style={{
                    border: 'none',
                    padding: '4px 9px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    borderRadius: 6,
                    background: viewMode === 'doc' ? '#ffffff' : 'transparent',
                    color: viewMode === 'doc' ? accent : '#64748b',
                    boxShadow: viewMode === 'doc' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer'
                  }}
                >
                  📄 Document View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!preview.url) refreshPreview();
                    setViewMode('pdf');
                  }}
                  style={{
                    border: 'none',
                    padding: '4px 9px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    borderRadius: 6,
                    background: viewMode === 'pdf' ? '#ffffff' : 'transparent',
                    color: viewMode === 'pdf' ? accent : '#64748b',
                    boxShadow: viewMode === 'pdf' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer'
                  }}
                >
                  📑 Official PDF
                </button>
              </div>

              {[['Cover', 'cover'], ['Letter', 'letter'], ['Requirements', 'requirements'], ['About', 'about'], ['Solution', 'solution'], ['Investment', 'investment']].map(([label, key]) => {
                const page = key === 'cover' ? (preview.url ? 1 : 0) : preview.pages[key];
                return (
                  <button
                    key={label}
                    style={{ ...S.chip, opacity: viewMode === 'pdf' ? (page ? 1 : 0.5) : 1 }}
                    title={viewMode === 'pdf' && page ? `Page ${page}` : `Jump to ${label}`}
                    onClick={() => jumpTo(key)}
                  >
                    {label}
                  </button>
                );
              })}
              {/* Each chip scrolls to that section or opens the PDF page */}
              <button style={S.chip} disabled={previewing} onClick={() => refreshPreview()}>
                <RefreshCw size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Refresh preview
              </button>
              {previewing && <span style={S.meta}><Loader2 size={14} className="spin" /> Updating preview...</span>}
              {!previewing && previewStale && <span style={S.meta}>Edits not in preview yet</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.ghost} disabled={!!busy} onClick={() => handleExport('docx')}>
                {busy === 'docx' ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Word
              </button>
              <button style={{ ...S.primary, minHeight: 40, padding: '0 16px', background: grad }} disabled={!!busy} onClick={() => handleExport('pdf')}>
                {busy === 'pdf' ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Export PDF
              </button>
            </div>
          </div>
          {previewError && viewMode === 'pdf' && (
            <div style={{
              background: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe',
              borderRadius: 8,
              padding: '8px 12px',
              margin: '8px 12px',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <span>ℹ️</span>
              <span>Showing live Document View. (Official PDF engine connects automatically on production server or when LibreOffice is installed).</span>
            </div>
          )}
          <div style={{ ...S.previewArea, overflow: 'hidden' }}>
            {viewMode === 'pdf' ? (
              preview.url ? (
                <iframe key={`${preview.url}-${jump.n}`} src={`${preview.url}#page=${jump.page}&view=FitH`} title="Proposal preview" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
              ) : previewing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
                  <Loader2 size={36} className="spin" color={accent} />
                  <p style={{ marginTop: 12, fontWeight: 700, fontSize: '0.95rem', color: '#0B2A6F' }}>Generating Official PDF...</p>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>Compiling template layout and LibreOffice document pages...</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', padding: 20, textAlign: 'center' }}>
                  <FileText size={48} color="#94a3b8" style={{ marginBottom: 12 }} />
                  <p style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0B2A6F', margin: '0 0 6px' }}>Official PDF is not generated yet</p>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 16px', maxWidth: 400 }}>
                    Click below to generate the official LibreOffice PDF preview, or switch to Document View to edit fields.
                  </p>
                  <button
                    onClick={() => refreshPreview()}
                    style={{ padding: '8px 18px', background: accent, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <RefreshCw size={14} /> Generate Official PDF
                  </button>
                </div>
              )
            ) : (
              <ProposalDocumentPreview fields={fields} byId={byId} accent={accent} />
            )}
            {/* Live interactive document preview updates as you type, and switches to official PDF when ready */}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmFreshOpen}
        title="Start a Fresh Proposal?"
        message="Starting a fresh proposal will clear your active draft from the editor and return you to company selection. Any unsaved edits on this proposal will be discarded."
        confirmText="Yes, Start Fresh"
        cancelText="Keep Editing Draft"
        variant="primary"
        icon={<RefreshCw size={24} color="#0066FF" />}
        onConfirm={executeStartFresh}
        onCancel={() => setConfirmFreshOpen(false)}
      />
    </div>
  );
}

function ProposalDocumentPreview({ fields, byId, accent }) {
  if (!fields) return null;
  const navy = '#0B2A6F';
  const border = '1px solid #e2e8f0';

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f1f5f9', padding: '16px 12px' }}>
      <div style={{
        maxWidth: '820px',
        margin: '0 auto',
        background: '#ffffff',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        border: '1px solid #cbd5e1',
        overflow: 'hidden',
        color: '#1e293b',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        {/* Top Gradient Banner */}
        <div style={{ height: 6, background: `linear-gradient(90deg, ${navy} 0%, #0066FF 50%, #10b981 100%)` }} />

        {/* Document Header */}
        {/* Document Header & Dual Brand Logos */}
        <div id="proposal-sec-cover" style={{ padding: '28px 36px 20px', borderBottom: '2px solid #f1f5f9' }}>
          {/* Dual Brand Logos: Left SLT-Mobitel, Right Lead Company Logo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, paddingBottom: 18, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
            {/* Left: SLT-Mobitel Enterprise Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: navy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontWeight: 900, fontSize: '1rem', boxShadow: '0 2px 8px rgba(11,42,111,0.25)' }}>
                SLT
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: navy, letterSpacing: '-0.02em' }}>SLT-MOBITEL</span>
                  <span style={{ fontSize: '0.74rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>ENTERPRISE</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 2 }}>National Telecommunications Provider</div>
              </div>
            </div>

            {/* Right: Lead Company Logo / Identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', textAlign: 'right' }}>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>
                  {fields.companyName || 'Lead Company'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Client Enterprise</div>
              </div>
              {fields.leadLogo ? (
                <img
                  src={fields.leadLogo}
                  alt={fields.companyName}
                  style={{
                    maxHeight: fields.leadLogoSize === 'large' ? 56 : fields.leadLogoSize === 'small' ? 32 : 44,
                    maxWidth: fields.leadLogoSize === 'large' ? 165 : fields.leadLogoSize === 'small' ? 95 : 130,
                    objectFit: 'contain',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    padding: 4
                  }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f8fafc', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0B2A6F', fontWeight: 800, fontSize: '0.9rem' }}>
                  {(fields.companyName || 'LEAD').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0B2A6F', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px' }}>
              Proposal Ref. No. {fields.refNo || 'PENDING'}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Date: {fields.proposalDate || '—'}</div>
          </div>

          <div style={{ marginTop: 24, padding: '18px 20px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proposed Solution</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: navy, marginTop: 4 }}>{fields.solutionName || 'Customized Enterprise Solution'}</div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: '0.84rem' }}>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.76rem', display: 'block' }}>CUSTOMER COMPANY</span>
                <strong>{fields.companyName || '—'}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.76rem', display: 'block' }}>ADDRESSED TO</span>
                <strong>{fields.recipientDesignation || 'General Manager'}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.76rem', display: 'block' }}>LOCATION</span>
                <span>{[fields.addressLine1, fields.addressLine2, fields.city].filter(Boolean).join(', ') || 'Sri Lanka'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section: Cover Letter */}
        <div id="proposal-sec-letter" style={{ padding: '28px 36px', borderBottom: border }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Cover Letter</span>
          </div>
          <div style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#334155' }}>
            <p style={{ margin: '0 0 10px' }}>Dear Sir / Madam,</p>
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: navy }}>Business Proposal for {fields.companyName || 'Your Business'}</p>
            <p style={{ margin: '0 0 12px', whiteSpace: 'pre-line' }}>{fields.solutionIntro1}</p>
            <p style={{ margin: '0 0 16px', whiteSpace: 'pre-line' }}>{fields.solutionIntro2}</p>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>
              Account Representative: <strong>{fields.amName || 'Enterprise Account Manager'}</strong> {fields.amPhone ? `(${fields.amPhone})` : ''} · {fields.amDesignation || 'Account Manager'}
            </p>
          </div>
        </div>

        {/* Section: Requirements */}
        <div id="proposal-sec-requirements" style={{ padding: '28px 36px', borderBottom: border }}>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: navy, marginBottom: 16 }}>
            YOUR REQUIREMENTS & SOLUTION ARCHITECTURE
          </div>
          {(fields.requirements || []).map((r, i) => {
            const product = byId[r.id];
            const features = (product?.features || []).filter(Boolean);
            return (
              <div key={i} style={{ marginBottom: 24, padding: '16px 18px', background: '#f8fafc', borderRadius: 8, border: border }}>
                <div style={{ fontWeight: 700, fontSize: '0.96rem', color: navy, marginBottom: 6 }}>
                  {i + 1}. {r.title}
                </div>
                {r.text && <p style={{ fontSize: '0.86rem', lineHeight: 1.55, color: '#334155', margin: '0 0 10px' }}>{r.text}</p>}

                {/* Key Features */}
                {r.showFeatures !== false && features.length > 0 && (
                  <div style={{ marginTop: 10, marginBottom: 12, background: '#ffffff', padding: '10px 14px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: navy, marginBottom: 4 }}>Key Features:</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
                      {features.map((f, idx) => <li key={idx}>{f}</li>)}
                    </ul>
                  </div>
                )}

                {/* Solution Architecture Diagram */}
                <div style={{ marginTop: 12, background: '#ffffff', padding: '12px 14px', borderRadius: 6, border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: navy, marginBottom: 8, textAlign: 'left' }}>Solution Architecture Diagram:</div>
                  <img 
                    src={`${API}/diagrams/${r.id}.png`}
                    alt={`${r.title} Solution Diagram`}
                    style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 4, objectFit: 'contain' }}
                    onError={(e) => {
                      const cleanId = String(r.id).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
                      if (!e.currentTarget.dataset.retried) {
                        e.currentTarget.dataset.retried = '1';
                        e.currentTarget.src = `${API}/diagrams/${cleanId}.png`;
                      } else {
                        e.currentTarget.parentElement.style.display = 'none';
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Section: About You & How We Can Help */}
        <div id="proposal-sec-about" style={{ padding: '28px 36px', borderBottom: border }}>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: navy, marginBottom: 12 }}>
            ABOUT YOU AND HOW WE CAN HELP YOU
          </div>
          <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#334155', margin: '0 0 16px' }}>
            {fields.aboutDescription || 'Customized strategic intelligence designed for your business scale and needs.'}
          </p>

          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
            Recommended SLT-MOBITEL Products for Your Operations:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {(fields.recommendations || []).map((rec, i) => (
              <div key={i} style={{ padding: '10px 12px', background: '#f8fafc', border: border, borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <strong style={{ fontSize: '0.86rem', color: navy }}>{byId[rec.id]?.name || rec.name || rec.id}</strong>
                  {rec.highPriority && (
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4 }}>
                      HIGH PRIORITY
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>{rec.reason || byId[rec.id]?.description || 'Recommended solution component.'}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Section: Investment */}
        <div id="proposal-sec-investment" style={{ padding: '28px 36px', borderBottom: border }}>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: navy, marginBottom: 8 }}>
            YOUR INVESTMENT (LKR)
          </div>
          <div style={{ overflowX: 'auto', border: border, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Description</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>Speed</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700 }}>QoS Template</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'right' }}>One-Time (LKR)</th>
                  <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'right' }}>Monthly Rental (LKR)</th>
                </tr>
              </thead>
              <tbody>
                {(fields.investment || []).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{row.description || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#475569' }}>{row.bandwidth || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#475569' }}>{row.qosTemplate || 'N/A'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{row.oneTimeCharge || 'On request'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#0369a1' }}>{row.monthlyRental || 'On request'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: 8 }}>
            * Note: Applicable government taxes extra. Commitment Period: <strong>{fields.ackCommitment || '1 Year'}</strong>.
          </div>
        </div>

        {/* Section: Contacts & Signoff */}
        <div style={{ padding: '24px 36px', background: '#f8fafc', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div style={{ padding: 12, background: '#ffffff', borderRadius: 6, border: border }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: navy, textTransform: 'uppercase' }}>Primary Contact</div>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 2 }}>{fields.amName || 'Account Manager'}</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{fields.amDesignation || 'Regional Enterprise Executive'}</div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>Phone: {fields.amPhone || '—'} · Email: {fields.amEmail || '—'}</div>
          </div>
          <div style={{ padding: 12, background: '#ffffff', borderRadius: 6, border: border }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: navy, textTransform: 'uppercase' }}>Customer Acknowledgement</div>
            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>Company: <strong>{fields.ackCompanyName || fields.companyName || '—'}</strong></div>
            <div style={{ fontSize: '0.78rem', color: '#475569' }}>Solution: <strong>{fields.ackSolution || fields.solutionName || '—'}</strong></div>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 6, borderTop: '1px dashed #cbd5e1', paddingTop: 4 }}>Authorized Signature & Company Seal</div>
          </div>
        </div>
      </div>
    </div>
  );
}


function ProductRow({ p, on, onToggle, accent }) {
  return (
    <label style={{ ...S.product, borderColor: on ? accent : 'var(--border-color, #e2e8f0)', background: on ? `${accent}0d` : '#fff' }}>
      {/* One product with its tick box */}
      <input type="checkbox" checked={on} onChange={() => onToggle(p.id)} style={{ accentColor: accent, marginTop: 3 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main, #0f172a)' }}>{p.name}</div>
        <div style={S.desc}>{p.description}</div>
      </div>
    </label>
  );
}

function Section({ title, closed = false, children }) {
  const [open, setOpen] = useState(!closed);
  // Collapsible group of edit fields
  return (
    <div style={S.group}>
      <button style={S.groupToggle} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
      </button>
      {open && <div style={{ padding: '4px 6px 6px' }}>{children}</div>}
    </div>
  );
}

const BORDER = '1px solid var(--border-color, #e2e8f0)';
const S = {
  searchRow: { display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' },
  searchBox: { flex: '1 1 240px', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, border: BORDER, borderRadius: 12, padding: '0 18px', background: '#fff', minHeight: 56 },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '1rem', background: 'transparent', color: 'inherit' },
  primary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 12, padding: '0 24px', minHeight: 48, color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  ghost: { display: 'inline-flex', alignItems: 'center', gap: 6, border: BORDER, borderRadius: 10, padding: '8px 12px', background: '#fff', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.9rem' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted, #64748b)' },
  manual: { border: BORDER, borderRadius: 14, padding: 16, background: '#fff', marginBottom: 18 },
  manualRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 10, alignItems: 'center' },
  resultGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 },
  resultCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, border: BORDER, borderRadius: 14, padding: 16, background: '#fff', cursor: 'pointer', color: 'inherit', font: 'inherit' },
  bubble: { width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' },
  name: { fontWeight: 600, fontSize: '1rem', marginBottom: 3, color: 'var(--text-main, #0f172a)' },
  meta: { display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', color: 'var(--text-muted, #64748b)', marginTop: 2 },
  pill: { border: '1px solid', borderRadius: 999, padding: '3px 12px', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' },
  bizBar: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', border: BORDER, borderRadius: 14, padding: '12px 16px', marginBottom: 18, background: '#fff' },
  productsHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 },
  h2: { fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main, #0f172a)' },
  group: { border: BORDER, borderRadius: 12, padding: 8, marginBottom: 10, background: '#fff' },
  groupHead: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.88rem', padding: '4px 6px 8px', color: 'var(--text-main, #0f172a)' },
  groupToggle: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: 6, fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer', color: 'var(--text-main, #0f172a)' },
  count: { color: '#fff', borderRadius: 999, fontSize: '0.72rem', padding: '1px 8px' },
  productGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, padding: '4px 2px' },
  product: { display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid', borderRadius: 10, padding: '9px 11px', cursor: 'pointer' },
  featureList: { margin: '4px 0 0', paddingLeft: 20, fontSize: '0.78rem', lineHeight: 1.45, color: 'var(--text-muted, #64748b)' },
  // Read-only Key Features under a requirement (greyed out when "Show Key Features" is unticked)
  desc: { fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 2 },
  split: { display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  left: { maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 },
  right: { border: BORDER, borderRadius: 14, background: '#fff', overflow: 'hidden' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', marginBottom: 9, flex: 1, minWidth: 0 },
  groupLabel: { fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main, #0f172a)', marginBottom: 6 },
  input: { border: BORDER, borderRadius: 8, padding: '7px 10px', fontSize: '0.88rem', fontFamily: 'inherit', background: '#fff', color: 'var(--text-main, #0f172a)', resize: 'vertical', minWidth: 0 },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  card: { border: BORDER, borderRadius: 10, padding: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', background: '#f8fafc' },
  del: { display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem', alignSelf: 'flex-start' },
  add: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px dashed #94a3b8', background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-main, #0f172a)', marginBottom: 8 },
  previewBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderBottom: BORDER },
  chip: { border: BORDER, borderRadius: 999, padding: '5px 12px', fontSize: '0.8rem', background: '#fff', cursor: 'pointer', color: 'var(--text-main, #0f172a)' },
  previewArea: { height: 'calc(100vh - 310px)', minHeight: 420, overflowY: 'auto', background: '#e5e7eb' },
};
// Inline styles so nothing in App.css has to change; colours follow the Dashboard's CSS variables
