const express = require('express');
const fs = require('fs');
const solutionRouter = require('./solutionProposals');
const psTemplates = require('../services/productSolutionTemplateService');
const ps = require('../services/productSolutionService');
const renderSvc = require('../services/productSolutionRenderService');
const solution = require('../services/solutionService');
const docs = require('../services/proposalDocsService');
const versionSvc = require('../services/proposalVersionService');
const proposalStorage = require('../services/proposalStorageService');
const refService = require('../services/refService');
const logoSvc = require('../services/proposalLogoService');

// /api/proposals/product-solution/* - ONE proposal from the Product + Solution template: the products the rep ticked + a quotation Excel
// (see services/productSolutionService.js). Same sign-in check and same Excel upload as the solution routes (imported from there).
const router = express.Router();
router.use(solutionRouter.requireUser);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const send = (res, err, label) => {
  if (!err.status || err.status >= 500) console.error(`[proposals/product-solution] ${label}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Request failed', ...(err.retry ? { retry: true } : {}) });
};

// The active template and its generic tag schema (null template: the page tells the admin to upload one)
router.get('/template', (req, res) => {
  const { entry, schema } = psTemplates.active();
  res.json({ success: true, template: entry ? { id: entry.id, version: entry.version, filename: entry.filename, uploadedAt: entry.uploadedAt } : null, schema, logoPlace: !!(entry && Array.isArray(entry.logoPlaceholders) && entry.logoPlaceholders.length), logoField: logoSvc.logoFieldOf(entry, schema) }); // logoPlace: the template has a {%client_logo} place; logoField: the section it belongs to
});

router.post('/upload', (req, res) => {
  solutionRouter.excelUpload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The Excel file is larger than 10 MB.' : err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'Please select an Excel (.xlsx) file.' });
      res.json({ success: true, ...solution.createUpload({ buffer: req.file.buffer, filename: req.file.originalname, email: req.userEmail }) });
    } catch (e) { send(res, e, 'upload'); }
  });
});

router.post('/extract', async (req, res) => {
  try {
    const { uploadId, sheetName, user, productIds } = req.body || {};
    res.json({ success: true, ...(await ps.extract({ uploadId, sheetName, productIds, user: { ...(user || {}), email: (user && user.email) || req.userEmail } })) });
  } catch (e) { send(res, e, 'extract'); }
});

router.post('/export', async (req, res) => {
  try {
    const format = req.body && req.body.format === 'pdf' ? 'pdf' : 'docx';
    const { fields, templateId, companyName, id, logo } = req.body || {};
    // The reference, the products and the picture settings (diagrams, logo) are the saved proposal's own, never what the request carries;
    // `logo` (a PNG / JPG data URL, '' = none) is the customer logo being edited on the screen: the preview shows it before it is saved
    const saved = id ? proposalStorage.getProposalById(String(id)) : null;
    const ref = saved ? refService.sanitizeProductSolutionRef(saved.refNo) : '';
    const body = fields && typeof fields === 'object' && !Array.isArray(fields) ? { ...fields } : fields;
    if (body && typeof body === 'object') {
      delete body[renderSvc.META_KEY];
      const meta = logoSvc.withLogo(saved && saved.fields && saved.fields[renderSvc.META_KEY], logo);
      if (logoSvc.hasKeys(meta)) body[renderSvc.META_KEY] = meta;
    }
    const { buffer } = await renderSvc.render({ templateId, fields: body, companyName, products: saved ? saved.products : [], format, refNo: ref });
    const fileName = docs.buildFileName([docs.fileRef(saved), saved ? saved.companyName || companyName : companyName, 'Product_Solution'], format);
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (e) { send(res, e, 'export'); }
});

router.post('/:id/regenerate', async (req, res) => {
  try {
    const user = (req.body && req.body.user) || {};
    const result = await ps.regenerate(req.params.id, { ...user, email: user.email || req.userEmail });
    versionSvc.storeVersionFiles(docs.keyOf(result.proposal), result.proposal.currentVersion);
    res.json({ success: true, ...result });
  } catch (e) { send(res, e, 'regenerate'); }
});

router.get('/:id/source', (req, res) => {
  try {
    const { proposal } = ps.getProposal(req.params.id);
    const abs = docs.sourcePath(docs.keyOf(proposal));
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'The original Excel file was not found' });
    const sourceName = String((proposal.solution && proposal.solution.sourceName) || 'source.xlsx').replace(/[\\/:*?"<>|]+/g, '_');
    const name = [docs.fileRef(proposal), sourceName].filter(Boolean).join('_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.sendFile(abs);
  } catch (e) { send(res, e, 'source'); }
});

router.get('/:id', (req, res) => {
  try { res.json({ success: true, ...ps.getProposal(req.params.id) }); } catch (e) { send(res, e, 'get'); }
});

router.put('/:id/fields', (req, res) => {
  try {
    const proposal = ps.saveFields(req.params.id, { fields: req.body && req.body.fields, companyName: req.body && req.body.companyName, logo: req.body && req.body.logo }, req.userEmail);
    versionSvc.storeVersionFiles(docs.keyOf(proposal), proposal.currentVersion);
    res.json({ success: true, proposal });
  } catch (e) { send(res, e, 'save'); }
});

module.exports = router;
