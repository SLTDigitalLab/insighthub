const express = require('express');
const fs = require('fs');
const multer = require('multer');
const userService = require('../services/userService');
const store = require('../services/templateStoreService');
const solution = require('../services/solutionService');
const renderSvc = require('../services/solutionRenderService');
const schemaSvc = require('../services/solutionSchemaService');
const docs = require('../services/proposalDocsService');
const versionSvc = require('../services/proposalVersionService');
const proposalStorage = require('../services/proposalStorageService');
const refService = require('../services/refService');
const logoSvc = require('../services/proposalLogoService');

// /api/proposals/solution/* - solution proposals built from an uploaded quotation Excel (see services/solutionService.js).
// Every route needs the signed-in user's email (same check as the status / documents routes of routes/proposals.js).
const router = express.Router();

function requireUser(req, res, next) {
  const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  if (!email) return res.status(401).json({ error: 'Authentication required' });
  const verified = userService.verifyAccess(email);
  if (!verified || !verified.approved) return res.status(403).json({ error: 'Access not approved' });
  req.userEmail = email;
  next();
}
router.use(requireUser);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only Excel (.xlsx) files are supported.'))),
});

const send = (res, err, label) => {
  if (!err.status || err.status >= 500) console.error(`[proposals/solution] ${label}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Request failed', ...(err.retry ? { retry: true } : {}), ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}), ...(err.existingRefNo ? { existingRefNo: err.existingRefNo } : {}) });
};

// The active solution template and its generic tag schema (null template: the page tells the admin to upload one)
router.get('/template', (req, res) => {
  const entry = store.getActive('solution');
  res.json({
    success: true,
    template: entry ? { id: entry.id, version: entry.version, filename: entry.filename, uploadedAt: entry.uploadedAt } : null,
    schema: entry ? schemaSvc.buildSchema(entry.tags) : [],
    logoPlace: !!(entry && Array.isArray(entry.logoPlaceholders) && entry.logoPlaceholders.length), // the template has a {%client_logo} place
    logoField: entry ? logoSvc.logoFieldOf(entry, schemaSvc.buildSchema(entry.tags)) : '', // the section it belongs to
  });
});

router.post('/upload', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The Excel file is larger than 10 MB.' : err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'Please select an Excel (.xlsx) file.' });
      res.json({ success: true, ...solution.createUpload({ buffer: req.file.buffer, filename: req.file.originalname, email: req.userEmail }) });
    } catch (e) { send(res, e, 'upload'); }
  });
});

router.post('/extract', async (req, res) => {
  try {
    const { uploadId, sheetName, user } = req.body || {};
    res.json({ success: true, ...(await solution.extract({ uploadId, sheetName, user: { ...(user || {}), email: (user && user.email) || req.userEmail } })) });
  } catch (e) { send(res, e, 'extract'); }
});

router.post('/export', async (req, res) => {
  try {
    const format = req.body && req.body.format === 'pdf' ? 'pdf' : 'docx';
    const { fields, templateId, companyName, id, logo } = req.body || {};
    // The reference printed in the document is the saved proposal's own (found by id) or nothing - never what the fields hold
    const saved = id ? proposalStorage.getProposalById(String(id)) : null;
    // A Product + Solution proposal (or one of its template versions) is rendered by its own store / render service, whichever page asks
    const tpl = templateId ? store.get(String(templateId)) : null;
    if ((saved && saved.proposalType === 'productSolution') || (tpl && tpl.type === store.PS_TYPE)) {
      const psRender = require('../services/productSolutionRenderService');
      const body = fields && typeof fields === 'object' && !Array.isArray(fields) ? { ...fields } : fields;
      if (body && typeof body === 'object') {
        delete body[psRender.META_KEY];
        const meta = logoSvc.withLogo(saved && saved.fields && saved.fields[psRender.META_KEY], logo);
        if (logoSvc.hasKeys(meta)) body[psRender.META_KEY] = meta;
      }
      const psType = saved && saved.proposalType === 'productSolution';
      const { buffer } = await psRender.render({ templateId, fields: body, companyName, products: psType ? saved.products : [], format, refNo: psType ? refService.sanitizeProductSolutionRef(saved.refNo) : undefined });
      const name = docs.buildFileName([docs.fileRef(psType ? saved : null), psType ? saved.companyName || companyName : companyName, 'Product_Solution'], format);
      res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : DOCX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      return res.send(buffer);
    }
    const ref = saved ? (refService.sanitizeSolutionRef(saved.refNo) || (refService.isValid(saved.refNo) ? saved.refNo : '')) : '';
    // the customer logo is the saved proposal's own; `logo` is the one being edited on the screen (a PNG / JPG data URL, '' = none)
    const body = fields && typeof fields === 'object' && !Array.isArray(fields) ? { ...fields } : fields;
    if (body && typeof body === 'object') {
      delete body[renderSvc.META_KEY];
      const meta = logoSvc.withLogo(saved && saved.fields && saved.fields[renderSvc.META_KEY], logo);
      if (logoSvc.hasKeys(meta)) body[renderSvc.META_KEY] = meta;
    }
    // The document prints the reference of the proposal's current step: <base> for Original / Confirmed / Completed, <base>-Vn after a status change
    const steps = saved ? docs.buildSteps(saved.statusHistory) : [];
    const printRef = ref ? docs.stepRef(ref, steps[steps.length - 1]) : ref;
    const printFields = body && typeof body === 'object' && !Array.isArray(body) && ref && printRef !== ref ? docs.fieldsWithRef(body, docs.refTagKeysOf(body, ref), ref, printRef) : body;
    const { buffer, baseName } = await renderSvc.render({ templateId, fields: printFields, companyName, format, refNo: printRef });
    const fileName = docs.buildFileName([docs.fileRef(saved && printRef ? { ...saved, refNo: printRef } : saved), saved ? saved.companyName || companyName : companyName, 'Solution'], format);
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (e) { send(res, e, 'export'); }
});

// The proposal is found by its id (an old reference still works as the key). The reference is never validated here: an empty, missing
// or junk reference must not stop any action.
const resolveRef = (req, res, next) => next();

router.post('/:id/regenerate', resolveRef, async (req, res) => {
  try {
    const user = (req.body && req.body.user) || {};
    const result = await solution.regenerate(req.params.id, { ...user, email: user.email || req.userEmail });
    versionSvc.storeVersionFiles(docs.keyOf(result.proposal), result.proposal.currentVersion);
    res.json({ success: true, ...result });
  } catch (e) { send(res, e, 'regenerate'); }
});

router.get('/:id/source', resolveRef, (req, res) => {
  try {
    const { proposal } = solution.getSolution(req.params.id);
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

router.get('/:id', resolveRef, (req, res) => {
  try { res.json({ success: true, ...solution.getSolution(req.params.id) }); } catch (e) { send(res, e, 'get'); }
});

router.put('/:id/fields', resolveRef, (req, res) => {
  try {
    const proposal = solution.saveFields(req.params.id, { fields: req.body && req.body.fields, companyName: req.body && req.body.companyName, logo: req.body && req.body.logo }, req.userEmail);
    versionSvc.storeVersionFiles(docs.keyOf(proposal), proposal.currentVersion); // Word of this version in the background (a no-op when nothing changed)
    res.json({ success: true, proposal });
  } catch (e) { send(res, e, 'save'); }
});

// shared with the Product + Solution routes (routes/productSolutionProposals.js)
router.requireUser = requireUser;
router.excelUpload = upload;

module.exports = router;
