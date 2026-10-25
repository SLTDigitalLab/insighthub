const express = require('express');
// Router for /api/proposals/*
const axios = require('axios');
// Calls the Apify Google Maps actor for the business search
const { PRODUCTS, PRODUCT_BY_ID, suggestFor, generateFields, applyAgentProposal, renderProposal } = require('../services/proposalBuilder');
// Product catalogue + the proposal builder
const userService = require('../services/userService');
const refService = require('../services/refService');
// Unique Proposal Reference Numbers (EL-48291736), issued here on /generate
const pdfParse = require('pdf-parse');
// Reads the exported PDF's page text to find where each section starts (for the preview)
// InsightHub accounts (designation, department, mobile number from the Request Access form)

const multer = require('multer');
const uploadTemplate = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB
  fileFilter: (req, file, cb) => {
    const isDocx = file.originalname.match(/\.docx$/i) || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isDoc = file.originalname.match(/\.doc$/i) || file.mimetype === 'application/msword' || file.mimetype === 'application/x-msword';
    if (isDocx || isDoc) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Microsoft Word (.docx and .doc) documents are allowed.'));
    }
  }
});
const proposalStorage = require('../services/proposalStorageService');
const path = require('path');
const router = express.Router();

router.use('/diagrams', express.static(path.join(__dirname, '..', 'templates', 'diagrams')));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const N8N_PROPOSAL_WEBHOOK_URL = process.env.N8N_PROPOSAL_WEBHOOK_URL || (process.env.N8N_WEBHOOK_BASE ? `${process.env.N8N_WEBHOOK_BASE}/proposal` : '');
const N8N_SEARCH_WEBHOOK_URL = process.env.N8N_SEARCH_WEBHOOK_URL || (process.env.N8N_WEBHOOK_BASE ? `${process.env.N8N_WEBHOOK_BASE}/business-search` : '');
// Starting values for the secondary contact / acknowledgement page (the rep can still edit them)
const DEFAULTS = {
  rebmName: process.env.PROPOSAL_REBM_NAME || '',
  rebmDesignation: process.env.PROPOSAL_REBM_DESIGNATION || 'Regional Enterprise Business Manager',
  rebmPhone: process.env.PROPOSAL_REBM_PHONE || '',
  rebmEmail: process.env.PROPOSAL_REBM_EMAIL || '',
  rebmDivision: process.env.PROPOSAL_REBM_DIVISION || '',
  rebmArea: process.env.PROPOSAL_REBM_AREA || '',
  commitmentPeriod: process.env.PROPOSAL_COMMITMENT || '1 Year',
};

function parseN8nResponse(data) {
  if (Array.isArray(data)) {
    if (data.length === 1 && typeof data[0] === 'object' && (data[0].output || data[0].text || data[0].message || data[0].response)) {
      return parseN8nResponse(data[0]);
    }
    return data;
  }
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.places)) return data.places;
  if (typeof data === 'object' && (data.output || data.text || data.message || data.response)) {
    const raw = data.output || data.text || data.message || data.response;
    try {
      const clean = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      if (clean.startsWith('{')) return [JSON.parse(clean)];
    } catch (e) {
      console.warn('[proposals/search] JSON parse failed on n8n output:', e.message);
    }
  }
  if (typeof data === 'string') {
    try {
      const clean = data.replace(/```json/gi, '').replace(/```/g, '').trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    } catch {}
  }
  return [];
}

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });

  // 1. Prioritize n8n lead-discovery (checks test webhook, production webhook, or custom env webhook)
  const candidateN8nUrls = [];
  if (process.env.N8N_SEARCH_WEBHOOK_URL) {
    candidateN8nUrls.push(process.env.N8N_SEARCH_WEBHOOK_URL);
  }
  candidateN8nUrls.push('https://sltrnddigitallab.app.n8n.cloud/webhook/lead-discovery');
  if (process.env.N8N_WEBHOOK_BASE) {
    candidateN8nUrls.push(`${process.env.N8N_WEBHOOK_BASE}/lead-discovery`);
    candidateN8nUrls.push(`${process.env.N8N_WEBHOOK_BASE}/business-search`);
  }
  candidateN8nUrls.push('https://sltrnddigitallab.app.n8n.cloud/webhook-test/lead-discovery');

  // De-duplicate URLs
  const uniqueUrls = [...new Set(candidateN8nUrls)];

  for (const webhookUrl of uniqueUrls) {
    try {
      console.log(`[proposals/search] Requesting businesses from n8n: ${webhookUrl} for prompt: "${q}"`);
      const { data } = await axios.post(
        webhookUrl,
        { prompt: q, query: q },
        { headers: { 'Content-Type': 'application/json' }, timeout: 180000 }
      );
      const items = parseN8nResponse(data);
      if (Array.isArray(items) && items.length > 0) {
        const results = items.map((r, idx) => {
          const name = r['Company Name'] || r.name || r.title || r.company || '';
          const address = r['Location'] || r.address || r.street || r.city || '';
          const category = r['Industry'] || r.category || r.categoryName || r['Size'] || 'Enterprise';
          const phone = (r['Contact Number'] && r['Contact Number'] !== 'N/A' && !/pending/i.test(r['Contact Number'])) ? r['Contact Number'] : (r.phone || '');
          const website = (r['Website'] && r['Website'] !== 'N/A') ? r['Website'] : (r.website || r.url || '');
          let rating = null;
          if (r['Customer Rating'] && r['Customer Rating'] !== 'N/A') {
            rating = parseFloat(String(r['Customer Rating']).replace(/\/5/, '')) || null;
          } else if (r.rating != null) {
            rating = r.rating;
          } else if (r.totalScore != null) {
            rating = r.totalScore;
          }
          return {
            id: String(r.id || r.placeId || `lead-${idx}-${encodeURIComponent(name)}`),
            name,
            address,
            city: r.city || '',
            category,
            phone,
            website,
            rating,
            reviews: r.reviews || r.reviewsCount || null,
            leadScore: r['Lead Score'] || null,
            reason: r['Reason'] || '',
          };
        }).filter(r => r.name);

        if (results.length > 0) {
          console.log(`[proposals/search] n8n returned ${results.length} found businesses via ${webhookUrl}`);
          return res.json({ results, source: 'n8n', webhookUrl });
        }
      }
    } catch (err) {
      const status = err.response?.status;
      // 404 simply means test endpoint is not actively listening; try next candidate
      console.warn(`[proposals/search] n8n attempt on ${webhookUrl} skipped (${status || err.message})`);
    }
  }

  // 2. Direct Apify Google Maps Actor if APIFY_TOKEN is set
  if (APIFY_TOKEN) {
    try {
      const { data } = await axios.post(
        'https://api.apify.com/v2/acts/compass~google-maps-extractor/run-sync-get-dataset-items',
        {
          searchStringsArray: [/sri lanka/i.test(q) ? q : `${q} Sri Lanka`],
          maxCrawledPlacesPerSearch: 8,
          language: 'en',
        },
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` }, timeout: 60000 }
      );
      const results = (Array.isArray(data) ? data : []).map(r => ({
        id: r.placeId || r.url || r.title,
        name: r.title,
        address: r.address || '',
        city: r.city || '',
        category: r.categoryName || (r.categories || [])[0] || '',
        phone: r.phone || '',
        website: r.website || '',
        rating: r.totalScore ?? null,
        reviews: r.reviewsCount ?? null,
      })).filter(r => r.name);
      if (results.length > 0) {
        return res.json({ results, source: 'apify' });
      }
    } catch (err) {
      console.warn('[proposals/search] Apify actor skipped/failed (' + err.message + '), using open directory fallback');
    }
  }

  // 3. Zero-token Open Directory Lookup (OpenStreetMap Nominatim for Sri Lanka)
  try {
    const cleanQ = q.replace(/sri lanka/gi, '').trim();
    const { data: osm } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: `${cleanQ} Sri Lanka`, format: 'json', addressdetails: 1, limit: 8 },
      headers: { 'User-Agent': 'InsightHub-Proposal-Agent/1.0 (Enterprise Sales Platform)' },
      timeout: 10000,
    });
    const results = (Array.isArray(osm) ? osm : []).map(r => {
      const a = r.address || {};
      const city = a.city || a.town || a.suburb || a.village || a.county || '';
      const rawCat = a.office || a.amenity || a.shop || a.commercial || a.tourism || r.type || 'Enterprise';
      const category = rawCat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return {
        id: `osm-${r.osm_id || Math.random().toString(36).substring(2, 9)}`,
        name: r.name || (r.display_name ? r.display_name.split(',')[0].trim() : cleanQ),
        address: r.display_name || '',
        city: city,
        category: category,
        phone: '',
        website: '',
        rating: null,
        reviews: null,
      };
    }).filter(r => r.name);

    return res.json({ results, source: 'directory' });
  } catch (err) {
    console.error('[proposals/search] Open directory fallback error:', err.message);
    return res.json({ results: [], source: 'none' });
  }
});

router.get('/products', (req, res) => {
  res.json({
    products: PRODUCTS.map(({ id, name, pillar, description, features }) => ({ id, name, pillar, description, features })),
    // The 70 SLT products for the tick list; features = Key Features from the knowledge base (shown read-only in the editor)
    suggested: suggestFor(String(req.query.category || '')),
    // Ids to show under "Suggested" for this business type
  });
});

function approvedAccount(email) {
  const account = userService.getUserByEmail(String(email || '').trim());
  return account && account.status === 'approved' ? account : {};
  // The logged-in rep's own InsightHub account (filled in on the Request Access form); {} if none
}

function currentUser(sent = {}, approved = approvedAccount(sent.email)) {
  const clean = v => String(v || '').trim();
  return {
    name: clean(sent.name) || clean(approved.name),
    designation: clean(sent.designation) || clean(approved.designation),
    phone: clean(sent.phone) || clean(approved.mobileNumber),
    email: clean(sent.email),
    division: clean(sent.division) || clean(approved.department) || clean(approved.rebmArea),
    // department is built from the form's section / sub-section ("REBM - WPC1"); rebmArea only if it is missing
  };
  // What the frontend sent wins; anything it didn't have comes from the account; still missing = empty (no demo or default values)
}

router.post('/generate', async (req, res) => {
  let fields;
  const account = approvedAccount(req.body.user?.email);
  const user = currentUser(req.body.user, account);
  try {
    fields = generateFields({ ...req.body, refNo: '', user, defaults: DEFAULTS });
    // Company, date, address, contacts etc. from the business + ticked products + logged-in user
    // (a reference number sent by the browser is ignored: it is issued below, on the server)
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  const { business = {}, productIds = [], agentContext } = req.body;
  const payload = {
    company: { name: business.name, industry: business.category || '', location: business.address || '', address: business.address || '', overview: '' },
    user: { name: user.name, email: user.email, phone: user.phone, designation: user.designation },
    selectedProducts: productIds.map(id => PRODUCT_BY_ID[id]).filter(Boolean).map(({ id, name, description, features }) => ({ id, name, description, features })),
    requirements: '',
    pricing: [],
    ...(agentContext ? { agentContext } : {}),
  };

  let agentResponse = null;
  if (N8N_PROPOSAL_WEBHOOK_URL) {
    try {
      const { data } = await axios.post(N8N_PROPOSAL_WEBHOOK_URL, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
      const body = Array.isArray(data) ? data[0] : data;
      if (body && body.success !== false && body.proposal) {
        agentResponse = body;
      } else {
        console.warn('[proposals/generate] n8n returned no proposal body, using catalog defaults');
      }
    } catch (err) {
      console.warn('[proposals/generate] n8n call skipped/failed (' + err.message + '), using built-in catalog generator');
    }
  }

  const { prefix, fromSection } = refService.prefixFor(account);
  let refNo;
  try {
    refNo = refService.issueRef(prefix);
  } catch (err) {
    console.error('[proposals/generate] reference number error:', err.message);
    refNo = `SLT-${Math.floor(10000000 + Math.random() * 90000000)}`;
  }

  const finalFields = agentResponse?.proposal ? applyAgentProposal(fields, agentResponse.proposal) : fields;
  const proposalWithRef = { ...finalFields, refNo };

  // Store the newly prepared proposal in the system
  try {
    proposalStorage.saveProposal({
      refNo,
      companyName: business.name || finalFields.companyName,
      business,
      fields: proposalWithRef,
      user,
      products: payload.selectedProducts
    });
  } catch (saveErr) {
    console.warn('[proposals/generate] Failed to persist proposal history:', saveErr.message);
  }

  res.json({
    fields: proposalWithRef,
    refFromSection: fromSection,
    notes: agentResponse?.proposal?.notes || ['Generated from SLT-Mobitel Product Knowledge Base'],
    sources: agentResponse?.sources || agentResponse?.proposal?.sources || { localKnowledgeBase: true }
  });
});

// ============================================================
// SAVED PROPOSALS HISTORY ENDPOINTS
// ============================================================
router.get('/saved', (req, res) => {
  try {
    const list = proposalStorage.getAllProposals();
    res.json({ success: true, count: list.length, proposals: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/saved/:id', (req, res) => {
  try {
    proposalStorage.deleteProposal(req.params.id);
    res.json({ success: true, message: 'Proposal removed from system' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// LATEST PROPOSAL TEMPLATE MANAGEMENT ENDPOINTS (ADMIN ONLY)
// ============================================================
router.get('/template/info', (req, res) => {
  try {
    const meta = proposalStorage.getTemplateMeta();
    res.json({ success: true, template: meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/template/download', (req, res) => {
  const tplPath = proposalStorage.TEMPLATE_PATH;
  if (!fs.existsSync(tplPath)) {
    return res.status(404).json({ error: 'Proposal template file not found on server' });
  }
  const meta = proposalStorage.getTemplateMeta();
  res.download(tplPath, meta.filename || 'proposal_template.docx');
});

router.post('/template/upload', uploadTemplate.single('template'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please select a valid Microsoft Word (.docx or .doc) template file to upload.' });
    }
    const adminEmail = (req.body.adminEmail || 'admin').toLowerCase().trim();
    const meta = await proposalStorage.saveLatestTemplate(req.file.buffer, req.file.originalname, adminEmail);
    console.log(`[proposals/template] New latest template uploaded by ${adminEmail} (${req.file.originalname}, ${req.file.size} bytes, format: ${meta.uploadedFormat})`);
    res.json({
      success: true,
      message: meta.convertedFromDoc
        ? 'Latest template converted via native Microsoft Word and set as active. Note: To guarantee 100% exact formatting without any conversion, uploading native .docx is always recommended.'
        : 'Latest template (.docx) uploaded successfully with 100% exact layout preserved. All new proposals will use this template.',
      template: meta
    });
  } catch (err) {
    console.error('[proposals/template] Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to upload template' });
  }
});

router.post('/template/reset', (req, res) => {
  try {
    const meta = proposalStorage.resetToDefaultTemplate();
    console.log('[proposals/template] Template reset to system default template');
    res.json({
      success: true,
      message: 'Proposal template has been successfully restored to the official system default template.',
      template: meta
    });
  } catch (err) {
    console.error('[proposals/template] Reset error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to reset template' });
  }
});

async function sectionPages(pdf) {
  const texts = [];
  await pdfParse(pdf, {
    pagerender: page => page.getTextContent().then(tc => {
      const t = tc.items.map(it => it.str).join('').replace(/\s+/g, '');
      texts.push(t);
      return t;
    }),
  });
  const find = (text, from = 2) => texts.findIndex((t, k) => k >= from && t.includes(text.replace(/\s+/g, ''))) + 1;
  // 1-based PDF page of the first page after the cover + Contents that contains `text` (0 = not found)
  return { cover: 1, letter: find('Dear Sir/ Madam'), requirements: find('YOUR REQUIREMENTS'), about: find('ABOUT YOU AND HOW WE CAN HELP YOU'), solution: find('PROPOSED SOLUTION'), investment: find('YOUR INVESTMENT') };
  // Pages the preview's quick-jump chips go to
}

router.post('/export', async (req, res) => {
  try {
    const format = req.body.format === 'pdf' ? 'pdf' : 'docx';
    // 'docx' for Word export, 'pdf' for PDF export and the live preview
    const { buffer: out, baseName } = await renderProposal(req.body.fields, format);
    // Builds the Word file from the (edited) fields, with Contents page numbers measured from the rendered PDF;
    // PDF = the same Word file converted by LibreOffice, so the layout is identical
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format}"`);
    if (format === 'pdf') {
      try { res.setHeader('X-Proposal-Pages', JSON.stringify(await sectionPages(out))); } catch (e) { console.warn('[proposals/export] section pages:', e.message); }
      // Where Cover / Letter / Requirements / Solution / Investment start, for the preview's chips (the PDF is sent either way)
    }
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Proposal-Pages');
    // Lets the React app read the file name and the section pages
    res.send(out);
  } catch (err) {
    console.error('[proposals/export]', err.properties?.errors || err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build proposal' });
  }
});

module.exports = router;
// server.js: app.use('/api/proposals', require('./routes/proposals'));
