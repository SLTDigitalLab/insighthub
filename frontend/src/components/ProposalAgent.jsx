import { useEffect, useMemo, useRef, useState } from 'react';
// React hooks for state, effects, memoised lists and DOM refs
import axios from 'axios';
// Same HTTP client as the rest of InsightHub
import { Search, Building2, MapPin, Star, Download, ChevronDown, ChevronRight, ArrowLeft, Loader2, FileText, Plus, Trash2, Sparkles, X, RefreshCw } from 'lucide-react';
// Same icon library the Dashboard already uses

const API = '/api/proposals';
// Relative path like the other calls in api.js — Vite/nginx forwards it to the backend
const PHONE_KEY = 'insighthub.proposal.phone';
// Remembers the rep's phone number (login doesn't store one)
const CONTACT_KEYS = ['amName', 'amDesignation', 'amPhone', 'amEmail', 'amDivision', 'rebmName', 'rebmDesignation', 'rebmPhone', 'rebmEmail', 'rebmDivision', 'rebmArea'];
// Contact fields the rep can edit on the Contact page section
const ACK_KEYS = ['ackAddressee1', 'ackAddressee2', 'ackDate', 'ackPrefill', 'ackCompanyName', 'ackAddress', 'ackSolution', 'ackCharges', 'ackCommitment'];
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
  // pages = { cover, letter, requirements, solution, investment } -> PDF page numbers, for the quick-jump chips
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }
// localStorage can throw in private windows — never let that break the page

export default function ProposalAgent({ user = {}, accent = '#0284c7' }) {
  // user = logged-in rep { name, email } (designation / phone / division too, if the page has them); accent = this agent's sidebar colour
  const [step, setStep] = useState('search');
  // 'search' -> 'products' -> 'edit'
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  // '' or what is running: 'search' | 'generate' | 'docx' | 'pdf'
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [manual, setManual] = useState({ name: '', address: '', category: '' });
  // Business typed in by hand — used when the search isn't available or doesn't find the business
  const [business, setBusiness] = useState(null);
  // The business the rep picked
  const [catalogue, setCatalogue] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [refNo, setRefNo] = useState('');
  const [selected, setSelected] = useState([]);
  // Ticked product ids, in the order ticked (= order in the proposal)
  const [filter, setFilter] = useState('');
  const [openPillars, setOpenPillars] = useState({});
  const [fields, setFields] = useState(null);
  const [checks, setChecks] = useState({ notes: [], failed: [] });
  // Proposal Agent notes + sources it couldn't read (kept in state, not shown)
  // Every red part of the template, generated then edited by the rep
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState({ url: '', pages: {}, fields: null });
  // Last good preview: blob URL of the PDF, section pages, and the fields it was made from
  const [previewError, setPreviewError] = useState('');
  const [jump, setJump] = useState({ page: 1, n: 0 });
  // Page the preview is showing; n changes on every chip click so the viewer reloads at that page
  const urlRef = useRef('');
  const seq = useRef(0);
  const contactEdits = useRef({});
  // Contact Us values the rep has typed (key -> value), kept across Generate for this session
  // urlRef = current blob URL (freed when replaced / on leaving); seq drops out-of-date preview responses

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy('search'); setError(''); setResults([]);
    try {
      const { data } = await axios.get(`${API}/search`, { params: { q: query.trim() }, timeout: 120000 });
      // Google Maps search through the backend; can take 15–40 s
      setResults(data.results);
      if (data.results.length === 0) setError('No businesses found. Try a more specific name, or enter the business manually below.');
    } catch (err) {
      const msg = await apiError(err);
      setError(/APIFY_TOKEN/.test(msg) ? 'Business search is not connected yet. Enter the business manually below.' : `${msg}. You can enter the business manually below.`);
      // Search needs the Apify token; until it is added, the manual form below does the same job
    } finally { setBusy(''); }
  }

  async function chooseBusiness(b) {
    setBusiness(b); setSelected([]); setFilter(''); setOpenPillars({}); setError(''); setFields(null);
    // Start a fresh proposal for this business
    try {
      const { data } = await axios.get(`${API}/products`, { params: { category: b.category } });
      // SLT product list + suggestions for this business type
      setCatalogue(data.products); setSuggested(data.suggested); setRefNo('');
      // No reference number is generated: the rep types it on the edit screen
      setStep('products');
    } catch (err) { setError(await apiError(err)); }
  }

  async function handleGenerate() {
    setBusy('generate'); setError('');
    try {
      const { data } = await axios.post(`${API}/generate`, {
        business, productIds: selected, refNo,
        user: {
          name: user.name || '',
          designation: user.designation || '',
          phone: user.phone || safeGet(PHONE_KEY) || '',
          email: user.email || '',
          division: user.division || '',
        },
      });
      // Backend fills all the red parts from the business, the ticked products and the logged-in user
      // (it looks up any missing designation / phone / division in this user's account by email)
      const next = { ...data.fields, ...contactEdits.current };
      // Contact values the rep already typed this session win over the regenerated ones
      setFields(next);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
      setPreview({ url: '', pages: {}, fields: null }); setPreviewError(''); setJump({ page: 1, n: 0 });
      // A new proposal never shows the previous business's PDF
      refreshPreview(next);
      // First preview of the new proposal, from the cover
      setChecks({ notes: Array.isArray(data.notes) ? data.notes : [], failed: Array.isArray(data.sources?.failed) ? data.sources.failed : [] });
      setStep('edit');
    } catch (err) { setError(await apiError(err)); } finally { setBusy(''); }
  }

  async function handleExport(format) {
    setBusy(format); setError('');
    try {
      const file = await exportFile(fields, format);
      saveBlob(file.blob, file.fileName);
      // Downloads the Word or PDF file
    } catch (err) { setError(await apiError(err)); } finally { setBusy(''); }
  }

  const set = (key, value) => {
    setFields(f => ({ ...f, [key]: value }));
    // Changes only this one field; every other edit stays as it is
    if (CONTACT_KEYS.includes(key) || ACK_KEYS.includes(key)) contactEdits.current = { ...contactEdits.current, [key]: value };
    // Remembers typed contact / acknowledgement values so a later Generate doesn't overwrite them
    if (key === 'amPhone') safeSet(PHONE_KEY, value);
    // Remember the rep's phone for next time
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
  const addRow = (list, empty) => setFields(f => ({ ...f, [list]: [...f[list], empty] }));
  const delRow = (list, i) => setFields(f => ({ ...f, [list]: f[list].filter((_, n) => n !== i) }));
  // Helpers to edit one field, one table cell, or add/remove a row

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
      setJump(j => ({ page: j.page, n: j.n + 1 }));
      // Shows the new PDF at the page the rep was on
    } catch (err) {
      if (mine === seq.current) setPreviewError(`Preview could not be updated: ${await apiError(err)}`);
      // The previous preview stays on screen
    } finally {
      if (mine === seq.current) setPreviewing(false);
    }
  }
  // Renders the real PDF (same as Export PDF). Runs after Generate and when the rep clicks "Refresh preview" — not on every keystroke

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  // Frees the PDF when leaving the page

  function jumpTo(key) {
    const page = key === 'cover' ? 1 : preview.pages[key];
    if (page) setJump(j => ({ page, n: j.n + 1 }));
    // Reloads the PDF viewer at that page (#page=N)
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
                  <div style={S.name}>{r.name}</div>
                  {r.category && <div style={S.meta}>{r.category}</div>}
                  {r.address && <div style={S.meta}><MapPin size={13} /> {r.address}</div>}
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
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '1.08rem', color: 'var(--text-main, #0f172a)' }}>{business.name}</div>
        <div style={S.meta}>{[business.category, business.address].filter(Boolean).join(' · ')}</div>
      </div>
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
      <div style={S.split}>
        <div style={S.left}>
          <div style={S.h2}>Edit proposal</div>
          <p style={{ ...S.meta, marginBottom: 12 }}>Everything here is what was marked red in the template. Click Refresh preview to see your edits in the PDF.</p>

          <Section title="Cover & letter (pages 1–3)">
            {field('Business name', 'companyName')}
            <div style={S.two}>{field('Proposal Ref. No.', 'refNo')}{field('Date', 'proposalDate')}</div>
            {field('Addressed to', 'recipientDesignation')}
            {field('Address line 1', 'addressLine1')}
            {field('Address line 2', 'addressLine2')}
            {field('City', 'city')}
            {field('Proposal for (solution)', 'solutionName')}
            {field('Letter paragraph 1', 'solutionIntro1', 5)}
            {field('Letter paragraph 2', 'solutionIntro2', 3)}
            <p style={S.meta}>The letter's closing line uses the Primary Contact name and number (Contact page section below).</p>
          </Section>

          <Section title="Your requirements (page 7)">
            {fields.requirements.map((r, i) => (
              <div key={i} style={S.card}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.input, flex: 1, fontWeight: 600 }} value={r.title} onChange={e => setRow('requirements', i, 'title', e.target.value)} />
                  <button style={S.del} onClick={() => delRow('requirements', i)} title="Remove"><Trash2 size={15} /></button>
                </div>
                <textarea rows={3} style={{ ...S.input, marginTop: 6 }} value={r.text} onChange={e => setRow('requirements', i, 'text', e.target.value)} />
                <div style={S.meta}>{r.id ? 'Network diagram included' : 'No diagram (custom requirement)'}</div>
              </div>
            ))}
            <button style={S.add} onClick={() => addRow('requirements', { id: '', title: '', text: '' })}><Plus size={14} /> Add requirement</button>
          </Section>

          <Section title="Proposed solution table (page 8)">
            {field('Text above the table', 'solutionSummary', 2)}
            {fields.components.map((r, i) => (
              <div key={i} style={S.card}>
                <div style={S.two}>
                  <input style={S.input} placeholder="Service" value={r.service} onChange={e => setRow('components', i, 'service', e.target.value)} />
                  <input style={S.input} placeholder="Station" value={r.station} onChange={e => setRow('components', i, 'station', e.target.value)} />
                  <input style={S.input} placeholder="Access media" value={r.accessMedia} onChange={e => setRow('components', i, 'accessMedia', e.target.value)} />
                  <input style={S.input} placeholder="NTU / equipment" value={r.ntu} onChange={e => setRow('components', i, 'ntu', e.target.value)} />
                </div>
                <button style={{ ...S.del, marginTop: 4 }} onClick={() => delRow('components', i)}><Trash2 size={14} /> Remove row</button>
              </div>
            ))}
            <button style={S.add} onClick={() => addRow('components', { service: '', station: '', accessMedia: '', ntu: '' })}><Plus size={14} /> Add row</button>
          </Section>

          <Section title="Your investment (LKR)">
            {fields.investment.map((r, i) => (
              <div key={i} style={S.card}>
                <input style={{ ...S.input, width: '100%', boxSizing: 'border-box', fontWeight: 600 }} placeholder="Description" value={r.description} onChange={e => setRow('investment', i, 'description', e.target.value)} />
                <div style={{ ...S.three, marginTop: 6 }}>
                  <input style={S.input} placeholder="Speed" value={r.bandwidth} onChange={e => setRow('investment', i, 'bandwidth', e.target.value)} />
                  <input style={S.input} placeholder="One-time" inputMode="decimal" value={r.oneTimeCharge} onChange={e => setRow('investment', i, 'oneTimeCharge', e.target.value)} />
                  <input style={S.input} placeholder="Monthly" inputMode="decimal" value={r.monthlyRental} onChange={e => setRow('investment', i, 'monthlyRental', e.target.value)} />
                </div>
                <button style={{ ...S.del, marginTop: 4 }} onClick={() => delRow('investment', i)}><Trash2 size={14} /> Remove row</button>
              </div>
            ))}
            <button style={S.add} onClick={() => addRow('investment', { description: '', bandwidth: '', oneTimeCharge: '', monthlyRental: '' })}><Plus size={14} /> Add row</button>
            <p style={S.meta}>Blank prices print as "On request".</p>
            {field('Commitment period', 'commitmentPeriod')}
          </Section>

          <Section title="Contact page">
            <div style={S.groupLabel}>Primary Contact</div>
            <div style={S.two}>{field('Name', 'amName')}{field('Designation', 'amDesignation')}</div>
            <div style={S.two}>{field('Contact Number', 'amPhone')}{field('Email', 'amEmail')}</div>
            {field('Division', 'amDivision')}
            <p style={S.meta}>Filled from your login; anything missing stays empty. Name and number also go in the letter's closing line.</p>
            <div style={{ ...S.groupLabel, marginTop: 10 }}>Secondary Contact</div>
            <div style={S.two}>{field('Name', 'rebmName')}{field('Designation', 'rebmDesignation')}</div>
            <div style={S.two}>{field('Contact Number', 'rebmPhone')}{field('Email', 'rebmEmail')}</div>
            {field('Division', 'rebmDivision')}
            <p style={S.meta}>Empty fields print nothing.</p>
          </Section>

          <Section title="Acknowledgements page">
            {field('Addressee line 1', 'ackAddressee1')}
            {field('Addressee line 2', 'ackAddressee2')}
            {field('Addressee line 3 (REBM area)', 'rebmArea')}
            <div style={S.two}>{field('Proposal submission date', 'ackDate')}{field('Proposal Ref. No.', 'refNo')}</div>
            <p style={S.meta}>The reference number is the same one as on the cover and every page header.</p>
            <label style={{ ...S.meta, gap: 6, margin: '6px 0 10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={fields.ackPrefill !== false} onChange={e => setAckPrefill(e.target.checked)} />
              Pre-fill from proposal (Company Name, Address, Solution)
            </label>
            {field('Company Name', 'ackCompanyName')}
            {field('Address', 'ackAddress')}
            {field('Solution', 'ackSolution')}
            {field('Initial & Monthly Charges', 'ackCharges')}
            {field('Commitment Period', 'ackCommitment')}
            <p style={S.meta}>An empty line prints the dotted line for the customer to fill in by hand.</p>
          </Section>
        </div>

        <div style={S.right}>
          <div style={S.previewBar}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {[['Cover', 'cover'], ['Letter', 'letter'], ['Requirements', 'requirements'], ['Solution', 'solution'], ['Investment', 'investment']].map(([label, key]) => {
                const page = key === 'cover' ? (preview.url ? 1 : 0) : preview.pages[key];
                return (
                  <button key={label} style={{ ...S.chip, opacity: page ? 1 : 0.5 }} disabled={!page} title={page ? `Page ${page}` : ''} onClick={() => jumpTo(key)}>{label}</button>
                );
              })}
              {/* Each chip opens the page that section starts on in the current PDF */}
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
          {previewError && <div style={{ ...S.error, margin: '8px 12px' }}>{previewError}</div>}
          <div style={{ ...S.previewArea, overflow: 'hidden' }}>
            {preview.url ? (
              <iframe key={`${preview.url}-${jump.n}`} src={`${preview.url}#page=${jump.page}&view=FitH`} title="Proposal preview" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
            ) : (
              <div style={S.empty}>
                {previewing ? <><Loader2 size={32} color={accent} className="spin" /><p>Building the PDF preview…</p></> : <p>Click Refresh preview to see the proposal.</p>}
              </div>
            )}
            {/* The real exported PDF, shown by the browser's PDF viewer; it stays on screen while a newer one is built */}
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
  searchBox: { flex: '1 1 320px', display: 'flex', alignItems: 'center', gap: 12, border: BORDER, borderRadius: 12, padding: '0 18px', background: '#fff', minHeight: 56 },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '1rem', background: 'transparent', color: 'inherit' },
  primary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 12, padding: '0 24px', minHeight: 48, color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  ghost: { display: 'inline-flex', alignItems: 'center', gap: 6, border: BORDER, borderRadius: 10, padding: '8px 12px', background: '#fff', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.9rem' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted, #64748b)' },
  manual: { border: BORDER, borderRadius: 14, padding: 16, background: '#fff', marginBottom: 18 },
  manualRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 10, alignItems: 'center' },
  resultGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 },
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
  productGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, padding: '4px 2px' },
  product: { display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid', borderRadius: 10, padding: '9px 11px', cursor: 'pointer' },
  desc: { fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 2 },
  split: { display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  left: { maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 },
  right: { border: BORDER, borderRadius: 14, background: '#fff', overflow: 'hidden' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', marginBottom: 9, flex: 1, minWidth: 0 },
  groupLabel: { fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main, #0f172a)', marginBottom: 6 },
  input: { border: BORDER, borderRadius: 8, padding: '7px 10px', fontSize: '0.88rem', fontFamily: 'inherit', background: '#fff', color: 'var(--text-main, #0f172a)', resize: 'vertical', minWidth: 0 },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  three: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 },
  card: { border: BORDER, borderRadius: 10, padding: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', background: '#f8fafc' },
  del: { display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.78rem', alignSelf: 'flex-start' },
  add: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px dashed #94a3b8', background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-main, #0f172a)', marginBottom: 8 },
  previewBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderBottom: BORDER },
  chip: { border: BORDER, borderRadius: 999, padding: '5px 12px', fontSize: '0.8rem', background: '#fff', cursor: 'pointer', color: 'var(--text-main, #0f172a)' },
  previewArea: { height: 'calc(100vh - 310px)', minHeight: 420, overflowY: 'auto', background: '#e5e7eb' },
};
// Inline styles so nothing in App.css has to change; colours follow the Dashboard's CSS variables
