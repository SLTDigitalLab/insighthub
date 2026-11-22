const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');
const proposalDocs = require('../services/proposalDocsService');
const proposalStorage = require('../services/proposalStorageService');
const draftService = require('../services/draftService');
const renderService = require('../services/renderService');
const store = require('../services/templateStoreService');
const requireAdmin = require('../services/requireAdmin');
const diagramService = require('../services/diagramService');
const versionSvc = require('../services/proposalVersionService');
const { diagramPath } = require('../services/ooxml');
const { PRODUCTS, PRODUCT_BY_ID } = require('../services/productCatalog');

const router = express.Router();

// Versioned templates (upload, list, activate, tag owners, download)
router.use('/templates', require('./proposalTemplates'));

// Solution proposals from a quotation Excel (own routes, each behind requireUser)
router.use('/solution', require('./solutionProposals'));

// Product + Solution proposals (one proposal from the combined template: products + quotation Excel; own routes, each behind requireUser)
router.use('/product-solution', require('./productSolutionProposals'));

router.use('/diagrams', express.static(require('../proposal/renderSettings').paths.diagramDir));

const APIFY_TOKEN = process.env.APIFY_TOKEN;

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
    suggested: [], // no built-in category -> product suggestions; the full catalogue is shown
  });
});

// Builds the edit screen's `fields` for a business + ticked products (proposal/fieldSchema.js) and saves the proposal.
router.post('/generate', async (req, res) => {
  try {
    const { business, productIds, user, agentContext } = req.body || {};
    const { fields, refFromSection, notes, aiError } = await draftService.generate({ business, productIds, user, agentContext });
    const active = store.getActive();
    try {
      const saved = proposalStorage.saveProposal({
        refNo: fields.refNo,
        companyName: fields.companyName,
        business,
        fields,
        templateId: active ? active.id : '',
        templateVersion: active ? active.version : null,
        user: user || {},
        products: (productIds || []).map(id => PRODUCT_BY_ID[id]).filter(Boolean).map(({ id, name }) => ({ id, name })),
      });
      versionSvc.storeVersionFiles(saved.id, 1); // v1's Word file, stored in the background
    } catch (saveErr) {
      console.warn('[proposals/generate] Failed to persist proposal history:', saveErr.message);
    }
    res.json({ fields, refFromSection, notes, sources: { aiWorkflow: !aiError }, ...(aiError ? { aiError } : {}) });
  } catch (err) {
    console.error('[proposals/generate]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build proposal' });
  }
});

// Product network diagrams (services/diagramService.js). Upload: checks the image (max size, really an image), converts
// anything that is not PNG / JPEG to PNG and, if asked, keeps it as that product's default for future proposals.
router.post('/diagrams/upload', async (req, res) => {
  try {
    const { productId, image, setDefault } = req.body || {};
    res.json({ success: true, ...(await diagramService.processUpload({ productId, image, setDefault: !!setDefault })) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not use this image' });
  }
});

// The diagram a product has when a proposal has no override of its own: its stored default, else the shared catalogue diagram
router.get('/diagrams/:productId/default', (req, res) => {
  const file = diagramService.defaultFile(req.params.productId) || diagramPath(PRODUCT_BY_ID[req.params.productId]);
  if (!file) return res.status(404).json({ error: 'No diagram' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(file));
});

// Fills the active template with the (edited) fields; format 'docx' or 'pdf' (the PDF is also the live preview)
router.post('/export', async (req, res) => {
  try {
    const format = req.body && req.body.format === 'pdf' ? 'pdf' : 'docx';
    const { fields, templateId } = req.body || {};
    const { buffer, baseName, entry } = await renderService.render({ templateId, fields, format });
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format}"`);
    if (format === 'pdf') {
      try { res.setHeader('X-Proposal-Pages', JSON.stringify(await renderService.sectionPages(buffer, entry, fields))); } catch (e) { console.warn('[proposals/export] section pages:', e.message); }
    }
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Proposal-Pages');
    res.send(buffer);
  } catch (err) {
    console.error('[proposals/export]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build proposal' });
  }
});

// ============================================================
// SAVED PROPOSALS HISTORY ENDPOINTS
// ============================================================
router.get('/saved', (req, res) => {
  try {
    // The list carries the current content only; every version's snapshot is fetched on demand (GET /:refNo/versions/:n)
    const list = proposalStorage.getAllProposals().map(p => ({ ...p, versions: versionSummaries(p) }));
    res.json({ success: true, count: list.length, proposals: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/saved/:id', requireUser, (req, res) => { // requireUser: the caller must be a known, approved user
  // Only admins and Section Managers may delete (the UI hides the button for everyone else; this stops direct API calls)
  if (!userService.canDeleteProposals(req.userRole, req.userDesignation)) return res.status(403).json({ error: 'Only admins and section managers can delete proposals' });
  try {
    proposalStorage.deleteProposal(req.params.id);
    res.json({ success: true, message: 'Proposal removed from system' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UPLOAD LATEST TEMPLATE TAB (ADMIN ONLY in the UI, as before)
// Backed by the versioned template store. Uploads go through the review flow (routes/proposalTemplates.js: /templates/drafts).
// ============================================================
const templateMeta = t => (t ? { filename: t.filename, updatedAt: t.uploadedAt, uploadedBy: t.uploadedBy, sizeBytes: t.sizeBytes || 0, version: t.version, convertedFromDoc: false, logoPlaceholders: (t.logoPlaceholders || []).map(l => ({ kind: l.kind, location: l.location, nearField: l.nearField || '', nearSection: l.nearSection || '' })) } : {});

router.get('/template/info', (req, res) => {
  try {
    res.json({ success: true, template: templateMeta(store.getActive(['solution', 'productSolution'].includes(req.query.type) ? req.query.type : 'product')) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/template/download', (req, res) => {
  const active = store.getActive(['solution', 'productSolution'].includes(req.query.type) ? req.query.type : 'product');
  const buffer = active && store.readFile(active.id);
  if (!buffer) return res.status(404).json({ error: 'Proposal template file not found on server' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(active.filename)}"`);
  res.send(buffer);
});

// Back to the first version (the system default template)
router.post('/template/reset', requireAdmin, (req, res) => {
  try {
    const first = store.list().slice().sort((a, b) => a.version - b.version)[0];
    if (!first) return res.status(404).json({ error: 'No template versions exist' });
    res.json({ success: true, message: 'Proposal template has been restored to the system default template.', template: templateMeta(store.activate(first.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reset template' });
  }
});

// ============================================================
// STATUS TRACKING + DOCUMENT UPLOADS (new routes only; each is behind requireUser)
// ============================================================
function requireUser(req, res, next) {
  const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  if (!email) return res.status(401).json({ error: 'Authentication required' });
  const verified = userService.verifyAccess(email);
  if (!verified || !verified.approved) return res.status(403).json({ error: 'Access not approved' });
  req.userEmail = email;
  req.userRole = verified.role; // used by the delete permission check
  req.userDesignation = verified.user && verified.user.designation;
  next();
}

const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: proposalDocs.MAX_BYTES, files: proposalDocs.DOC_TYPES.length } });
const statusUpload = docUpload.fields(proposalDocs.DOC_TYPES.map(name => ({ name, maxCount: 1 })));
const singleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: proposalDocs.MAX_BYTES, files: 1 } }).single('file');

// Finds the proposal by its id (:refNo is that id; an old reference still works as the key). The reference itself is never validated:
// an empty, missing or junk reference must not stop any action. Responds 404 when there is no such proposal.
function resolveDocRequest(req, res, next) {
  const proposal = proposalStorage.getProposalById(req.params.refNo);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  req.proposal = proposal;
  req.proposalKey = proposalDocs.keyOf(proposal); // storage key: the reference when it is a safe folder name, otherwise the id
  // Changes need the version model; reading (GET) works on old-format records too, in memory
  if (req.method !== 'GET' && !proposalStorage.isMigrated(req.proposalKey)) {
    return res.status(409).json({ error: 'This proposal is stored in the old format. Run "node scripts/migrate-proposal-versions.js --write" in the backend folder first.' });
  }
  next();
}

// Version list without the (large) snapshot content
function versionSummaries(p) {
  return (p.versions || []).map(v => ({
    versionNumber: v.versionNumber, createdAt: v.createdAt, createdBy: v.createdBy, reason: v.reason, snapshotAvailable: !!v.snapshotAvailable,
    files: { docx: !!(v.files && v.files.docx), pdf: !!(v.files && v.files.pdf) },
  }));
}

const uploadError = err => (err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB' : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected upload field' : err.message);
const BAD_FILE = 'Only PDF, DOC, DOCX, JPG and PNG files are allowed';

// Builds the stored doc record for an uploaded multer file (writes the file to disk)
function storeUpload(refNo, docType, file, email) {
  const ext = proposalDocs.validateFile(file);
  if (!ext) { const e = new Error(BAD_FILE); e.status = 400; throw e; }
  return {
    id: uuidv4(),
    docType,
    originalName: path.basename(file.originalname || `${docType}${ext}`),
    storedPath: proposalDocs.saveFile(refNo, docType, ext, file.buffer),
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy: email,
    uploadedAt: new Date().toISOString(),
  };
}

// Ordered (oldest -> newest) history with documents
router.get('/:refNo/history', requireUser, resolveDocRequest, (req, res) => {
  res.json({ success: true, status: req.proposal.status, currentVersion: req.proposal.currentVersion, versions: versionSummaries(req.proposal), history: req.proposal.statusHistory });
});

// One version: its snapshot (fields + file references), its history events and whether it is the current version
router.get('/:refNo/versions/:versionNumber', requireUser, resolveDocRequest, (req, res) => {
  const n = Number(req.params.versionNumber);
  const snap = Number.isInteger(n) ? req.proposal.versions.find(v => v.versionNumber === n) : null;
  if (!snap) return res.status(404).json({ error: 'Version not found' });
  const { fields, companyName, templateId, templateVersion, products, files, ...meta } = snap;
  res.json({
    success: true,
    proposal: { refNo: req.proposal.refNo, companyName: req.proposal.companyName, proposalType: req.proposal.proposalType },
    versionNumber: n,
    currentVersion: req.proposal.currentVersion,
    isCurrent: n === req.proposal.currentVersion,
    snapshotAvailable: !!snap.snapshotAvailable,
    snapshot: snap.snapshotAvailable ? { ...meta, fields, companyName, templateId, templateVersion, products, files: files || { docx: null, pdf: null } } : null,
    events: req.proposal.statusHistory.filter(h => h.versionNumber === n),
  });
});

// Word / PDF of one step of the timeline: GET /:refNo/download?format=docx|pdf&step=<event id> (no step = the current step).
// The older ?version=N form (the stored file of a content version) still works when no step is given.
router.get('/:refNo/download', requireUser, resolveDocRequest, async (req, res) => {
  try {
    const format = req.query.format === 'pdf' ? 'pdf' : 'docx';
    const step = req.query.step ? String(req.query.step) : '';
    const { buffer, mimeType, fileName } = !step && req.query.version
      ? await versionSvc.getVersionFile(req.proposalKey, req.query.version, format)
      : await versionSvc.getStepFile(req.proposalKey, step, format);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('[proposals/download]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to build the file' });
  }
});

// Saves an edit of a product proposal's content. A change creates the next version (full snapshot); no change creates nothing.
router.put('/:refNo/fields', requireUser, resolveDocRequest, (req, res) => {
  if (req.proposal.proposalType === 'solution') return res.status(400).json({ error: 'Solution proposals are saved from the solution page' });
  if (req.proposal.proposalType === 'productSolution') return res.status(400).json({ error: 'Product + Solution proposals are saved from the Product + Solution page' });
  const fields = req.body && req.body.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return res.status(400).json({ error: 'fields are required' });
  try {
    const result = proposalStorage.reviseProposal(req.proposalKey, p => ({ ...p, fields, companyName: fields.companyName || p.companyName }), { reason: 'edit', userEmail: req.userEmail });
    if (!result) return res.status(404).json({ error: 'Proposal not found' });
    if (result.changed) versionSvc.storeVersionFiles(req.proposalKey, result.versionNumber);
    res.json({ success: true, changed: result.changed, currentVersion: result.proposal.currentVersion, status: result.proposal.status, history: result.proposal.statusHistory, proposal: { ...result.proposal, versions: versionSummaries(result.proposal) } });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[proposals/fields]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save the proposal' });
  }
});

// Adds a history entry (+ optional documents) and makes it the proposal's current status
router.post('/:refNo/status', requireUser, resolveDocRequest, (req, res) => {
  statusUpload(req, res, err => {
    if (err) return res.status(400).json({ error: uploadError(err) });
    const stored = [];
    const cleanup = () => stored.forEach(d => proposalDocs.removeStored(d.storedPath));
    try {
      const status = req.body && req.body.status;
      if (!proposalDocs.STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${proposalDocs.STATUSES.join(', ')}` });
      }
      // The status can only move forward: Draft → Sent → Revised → Revised & Sent → Confirmed → Completed (editing content is what goes back to Revised)
      const allowedNext = proposalDocs.nextStatuses(req.proposal.status);
      if (!allowedNext.includes(status)) {
        return res.status(422).json({ error: allowedNext.length ? `A proposal that is ${req.proposal.status} can only be moved to: ${allowedNext.join(', ')}.` : `A ${req.proposal.status} proposal is final: its status can no longer be changed.` });
      }
      const note = String((req.body && req.body.note) || '').trim();
      if (note.length > proposalDocs.MAX_NOTE) return res.status(400).json({ error: `Note must be ${proposalDocs.MAX_NOTE} characters or fewer` });
      const allowed = proposalDocs.STATUS_DOC_TYPES[status] || [];
      const files = req.files || {};
      for (const docType of Object.keys(files)) {
        if (!allowed.includes(docType)) return res.status(400).json({ error: `${docType} documents are not accepted for status ${status}` });
      }
      for (const docType of allowed) {
        const file = files[docType] && files[docType][0];
        if (file && !proposalDocs.validateFile(file)) return res.status(400).json({ error: BAD_FILE });
      }
      const documents = {};
      for (const docType of allowed) {
        const file = files[docType] && files[docType][0];
        if (!file) continue;
        documents[docType] = storeUpload(req.proposalKey, docType, file, req.userEmail);
        stored.push(documents[docType]);
      }
      let entry;
      // A status change never creates a version: it is an event on the current one
      const updated = proposalStorage.updateProposal(req.proposalKey, p => {
        if (!proposalDocs.nextStatuses(p.status).includes(status)) throw Object.assign(new Error(`A proposal that is ${p.status} cannot be moved to ${status}.`), { status: 422 }); // changed meanwhile
        entry = proposalDocs.makeEvent(p, { status, note, documents, userEmail: req.userEmail, versionNumber: p.currentVersion });
        return { ...p, status, statusHistory: [...p.statusHistory, entry] };
      });
      if (!updated) { cleanup(); return res.status(404).json({ error: 'Proposal not found' }); }
      res.json({ success: true, entry, status: updated.status, history: updated.statusHistory });
    } catch (e) {
      cleanup();
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update status' });
    }
  });
});

// Adds or replaces one document on an existing history entry (upload field: file)
router.post('/:refNo/history/:historyId/documents/:docType', requireUser, resolveDocRequest, (req, res) => {
  const entry = req.proposal.statusHistory.find(h => h.id === req.params.historyId);
  if (!entry) return res.status(404).json({ error: 'History entry not found' });
  if (!(proposalDocs.STATUS_DOC_TYPES[entry.status] || []).includes(req.params.docType)) {
    return res.status(400).json({ error: `${req.params.docType} documents are not accepted for status ${entry.status}` });
  }
  singleUpload(req, res, err => {
    if (err) return res.status(400).json({ error: uploadError(err) });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    let doc;
    try {
      doc = storeUpload(req.proposalKey, req.params.docType, req.file, req.userEmail);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to store file' });
    }
    let previous;
    const updated = proposalStorage.updateProposal(req.proposalKey, p => ({
      ...p,
      statusHistory: p.statusHistory.map(h => {
        if (h.id !== entry.id) return h;
        previous = h.documents[doc.docType];
        return { ...h, documents: { ...h.documents, [doc.docType]: doc } };
      }),
    }));
    if (!updated) { proposalDocs.removeStored(doc.storedPath); return res.status(404).json({ error: 'Proposal not found' }); }
    if (previous) proposalDocs.removeStored(previous.storedPath);
    res.json({ success: true, document: doc, status: updated.status, history: updated.statusHistory });
  });
});

function findDoc(proposal, docId) {
  for (const h of proposal.statusHistory) {
    const doc = Object.values(h.documents).find(d => d.id === docId);
    if (doc) return doc;
  }
  return null;
}

router.get('/:refNo/documents/:docId', requireUser, resolveDocRequest, (req, res) => {
  const doc = findDoc(req.proposal, req.params.docId);
  const abs = doc && proposalDocs.resolveStored(doc.storedPath);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Document not found' });
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.sendFile(abs);
});

module.exports = router;
