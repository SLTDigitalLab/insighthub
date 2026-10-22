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

const path = require('path');
const router = express.Router();

router.use('/diagrams', express.static(path.join(__dirname, '..', 'templates', 'diagrams')));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
// Same Apify token n8n uses, set in backend/.env
const N8N_PROPOSAL_WEBHOOK_URL = process.env.N8N_PROPOSAL_WEBHOOK_URL || (process.env.N8N_WEBHOOK_BASE ? `${process.env.N8N_WEBHOOK_BASE}/proposal` : '');
// n8n "Proposal Agent" workflow that writes the letter, requirements, solution table and investment rows
const DEFAULTS = {
  rebmName: process.env.PROPOSAL_REBM_NAME || '',
  rebmDesignation: process.env.PROPOSAL_REBM_DESIGNATION || 'Regional Enterprise Business Manager',
  rebmPhone: process.env.PROPOSAL_REBM_PHONE || '',
  rebmEmail: process.env.PROPOSAL_REBM_EMAIL || '',
  rebmDivision: process.env.PROPOSAL_REBM_DIVISION || '',
  rebmArea: process.env.PROPOSAL_REBM_AREA || '',
  commitmentPeriod: process.env.PROPOSAL_COMMITMENT || '1 Year',
};
// Starting values for the secondary contact / acknowledgement page (the rep can still edit them)

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  // What the rep typed, e.g. "hotels in kandy"
  if (!q) return res.status(400).json({ error: 'q is required' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN is not set in backend/.env' });
  try {
    const { data } = await axios.post(
      'https://api.apify.com/v2/acts/compass~google-maps-extractor/run-sync-get-dataset-items',
      {
        searchStringsArray: [/sri lanka/i.test(q) ? q : `${q} Sri Lanka`],
        // Puts "Sri Lanka" in the search text itself instead of using locationQuery
        maxCrawledPlacesPerSearch: 6,
        // Fewer places so the actor finishes sooner
        language: 'en',
      },
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` }, timeout: 110000 },
      // Gives slow actor runs up to 110 s before giving up
    );
    // Runs the Google Maps actor and waits for its results (usually 15–40 s)
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
    // Keeps only what the proposal page needs
    res.json({ results });
  } catch (err) {
    console.error('[proposals/search]', err.response?.status, err.response?.data || err.message);
    res.status(502).json({ error: 'Business search failed', detail: err.response?.data?.error?.message || err.message });
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
  res.json({
    fields: { ...finalFields, refNo },
    refFromSection: fromSection,
    notes: agentResponse?.proposal?.notes || ['Generated from SLT-Mobitel Product Knowledge Base'],
    sources: agentResponse?.sources || agentResponse?.proposal?.sources || { localKnowledgeBase: true }
  });
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
