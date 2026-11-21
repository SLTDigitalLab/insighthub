const express = require('express');
const psTemplates = require('../services/productSolutionTemplateService');

// /api/proposals/templates/product-solution/* - upload -> review -> single Confirm of the Product + Solution template.
// Mounted by routes/proposalTemplates.js, which hands over its upload middleware and helpers (same limits, same admin handling).
//
//   POST   /analyse             upload a .docx: kept unchanged, a tagged copy is made (tags already in the file are kept as they are)
//   GET    /drafts/:id          the review view: tags found, what was added / removed compared with the active template
//   POST   /drafts/:id/confirm  the single Confirm: becomes the active Product + Solution template
//   DELETE /drafts/:id
// Versions, restore ("activate") and download are the shared routes of proposalTemplates.js (GET /?type=productSolution ...).
module.exports = ({ upload, who, send }) => {
  const router = express.Router();

  router.post('/analyse', upload.single('template'), async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Please select a .docx template file to upload.' });
      res.json({ success: true, draft: await psTemplates.analyse({ buffer: req.file.buffer, filename: req.file.originalname, uploadedBy: who(req) }) });
    } catch (err) { send(res, err, 'Product + Solution analyse'); }
  });

  router.get('/drafts/:id', (req, res) => {
    try { res.json({ success: true, draft: psTemplates.view(req.params.id) }); } catch (err) { send(res, err, 'Product + Solution draft'); }
  });

  router.post('/drafts/:id/confirm', (req, res) => {
    try {
      const r = psTemplates.confirm(req.params.id, who(req));
      res.json({ success: true, type: 'productSolution', version: r.template.version, filename: r.template.filename, autoTagged: r.autoTagged, ...(r.aiError ? { aiError: r.aiError } : {}), tags: r.schema.map(t => ({ name: t.name, type: t.type, fields: (t.children || []).map(c => c.name) })) });
    } catch (err) { send(res, err, 'Product + Solution confirm'); }
  });

  router.delete('/drafts/:id', (req, res) => {
    try { psTemplates.remove(req.params.id); res.json({ success: true }); } catch (err) { send(res, err, 'Product + Solution draft delete'); }
  });

  return router;
};
