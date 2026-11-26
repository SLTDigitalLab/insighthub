const express = require('express');
const multer = require('multer');
const store = require('../services/templateStoreService');
const drafts = require('../services/templateDraftService');
const solutionTemplates = require('../services/solutionTemplateService');
const requireAdmin = require('../services/requireAdmin');

// /api/proposals/templates/* - template versions and the upload -> review -> confirm flow.
// Everything that uploads, reviews, changes or activates a template is admin-only (requireAdmin); reading the versions is open to approved users.
//
//   POST   /upload                  one step: analyse, tag, clean and activate (used by the Proposal Hub)
//   POST   /drafts                  upload a .docx: it is analysed (tags, outline, AI mapping) and kept as a draft
//   GET    /drafts                  drafts waiting for review
//   GET    /drafts/:id              the review view: mapping, warnings, cleanup plan, fields that stay empty
//   PUT    /drafts/:id/overrides    the admin's corrections to the mapping
//   POST   /drafts/:id/confirm      write the tags into a copy, check it, store it as the new active version
//   DELETE /drafts/:id
//   GET    /                        versions;  POST /:id/activate;  GET /:id/download[?original=1]
const router = express.Router();

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.docx$/i.test(file.originalname) || file.mimetype === DOCX_MIME) return cb(null, true);
    cb(new Error('Only Microsoft Word (.docx) documents are supported.'));
  },
});

const who = req => String(req.headers['x-user-email'] || (req.body && (req.body.uploadedBy || req.body.adminEmail)) || 'Admin').trim().toLowerCase();
const send = (res, err, label) => {
  if (!err.status || err.status >= 500) console.error(`[proposals/templates] ${label}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Request failed', ...(err.problems ? { problems: err.problems } : {}) });
};

function summary(t) {
  const { tags, bindings, mapping, ...rest } = t;
  return { ...rest, tagCount: tags.length };
}

// Product + Solution template: its own upload -> review -> Confirm routes (before the /:id routes below)
router.use('/product-solution', requireAdmin, require('./productSolutionTemplates')({ upload, who, send }));

router.post('/drafts', requireAdmin, upload.single('template'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Please select a .docx template file to upload.' });
    res.json({ success: true, draft: await drafts.create({ buffer: req.file.buffer, filename: req.file.originalname, uploadedBy: who(req) }) });
  } catch (err) { send(res, err, 'Draft upload'); }
});

// One step: analyse, tag, clean and activate. Only one upload runs at a time (a second one is refused, not queued).
let uploading = false;
router.post('/upload', requireAdmin, upload.single('template'), async (req, res) => {
  if (uploading) return res.status(409).json({ error: 'Another template upload is still running. Wait for it to finish.' });
  uploading = true;
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Please select a .docx template file to upload.' });
    if (req.body && req.body.type === 'solution') {
      // solution templates keep their own active version; their tags are written by the template author (no product mapping)
      const s = solutionTemplates.uploadAndActivate({ buffer: req.file.buffer, filename: req.file.originalname, uploadedBy: who(req) });
      return res.json({ success: true, type: 'solution', version: s.template.version, filename: s.template.filename, tags: s.schema.map(t => ({ name: t.name, type: t.type, fields: (t.children || []).map(c => c.name) })) });
    }
    if (req.body && req.body.type === 'productSolution') {
      // the Product + Solution template keeps its own active version (one step: analyse + confirm)
      const r = await require('../services/productSolutionTemplateService').uploadAndActivate({ buffer: req.file.buffer, filename: req.file.originalname, uploadedBy: who(req) });
      return res.json({ success: true, type: 'productSolution', version: r.template.version, filename: r.template.filename, autoTagged: r.autoTagged, ...(r.aiError ? { aiError: r.aiError } : {}), tags: r.schema.map(t => ({ name: t.name, type: t.type, fields: (t.children || []).map(c => c.name) })) });
    }
    const r = await drafts.uploadAndActivate({ buffer: req.file.buffer, filename: req.file.originalname, uploadedBy: who(req) });
    res.json({
      success: true,
      version: r.template.version,
      filename: r.template.filename,
      skipped: r.willStayEmpty.map(({ key, label, status, tag }) => ({ key, label, status, tag })),
      unconnectedRed: r.unconnectedRed,
      lostTags: r.lostTags, // for debugging only; the UI does not show it
      changes: {
        tags: r.changes.tags.length,
        setFieldsRemoved: r.changes.setFieldsRemoved.length,
        toc: r.changes.toc,
        headingsFixed: r.changes.headingsFixed,
        requirementsLoop: r.changes.requirementsLoop,
      },
      ...(r.aiError ? { aiError: r.aiError } : {}),
    });
  } catch (err) { send(res, err, 'Upload'); } finally { uploading = false; }
});

router.get('/drafts', requireAdmin, (req, res) => {
  try { res.json({ success: true, drafts: drafts.list() }); } catch (err) { send(res, err, 'Draft list'); }
});

router.get('/drafts/:id', requireAdmin, (req, res) => {
  try { res.json({ success: true, draft: drafts.get(req.params.id) }); } catch (err) { send(res, err, 'Draft view'); }
});

router.put('/drafts/:id/overrides', requireAdmin, (req, res) => {
  try { res.json({ success: true, draft: drafts.setOverrides(req.params.id, req.body && req.body.overrides) }); } catch (err) { send(res, err, 'Draft overrides'); }
});

router.get('/drafts/:id/original', requireAdmin, (req, res) => {
  try {
    const { filename, buffer } = drafts.original(req.params.id);
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) { send(res, err, 'Draft download'); }
});

router.post('/drafts/:id/confirm', requireAdmin, async (req, res) => {
  try { res.json({ success: true, ...(await drafts.confirm(req.params.id, who(req))) }); } catch (err) { send(res, err, 'Draft confirm'); }
});

router.delete('/drafts/:id', requireAdmin, (req, res) => {
  try { drafts.remove(req.params.id); res.json({ success: true }); } catch (err) { send(res, err, 'Draft delete'); }
});

router.get('/', (req, res) => {
  try {
    res.json({ success: true, templates: store.list(['solution', 'productSolution'].includes(req.query.type) ? req.query.type : 'product').map(t => ({ ...summary(t), tags: t.tags })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const entry = store.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Template version not found' });
    res.json({ success: true, template: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/activate', requireAdmin, (req, res) => {
  try {
    const entry = store.activate(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Template version not found' });
    res.json({ success: true, template: summary(entry) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const entry = store.remove(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Template version not found' });
    res.json({ success: true, deleted: summary(entry) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id/download', (req, res) => {
  try {
    const entry = store.get(req.params.id);
    const buffer = entry && (req.query.original ? store.readOriginal(entry.id) : store.readFile(entry.id));
    if (!buffer) return res.status(404).json({ error: 'Template file not found' });
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.filename)}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
