const userService = require('./userService');

// Same admin rule as server.js (verifyAdminRequest): a listed admin email, or an approved user whose role is 'admin'.
const ADMIN_EMAILS = [
  'dineshpi@slt.com.lk',
  '020601@intranet.slt.com.lk',
  (process.env.ADMIN_EMAIL || 'lahirus@slt.com.lk').toLowerCase().trim()
];

// Express middleware: only administrators may continue (the caller is identified by the x-user-email header, like the rest of the proposal API).
module.exports = function requireAdmin(req, res, next) {
  const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  if (!email) return res.status(401).json({ error: 'Authentication required' });
  if (ADMIN_EMAILS.includes(email)) return next();
  const verified = userService.verifyAccess(email);
  if (verified && verified.approved && verified.role === 'admin') return next();
  return res.status(403).json({ error: 'Only administrators can change proposal templates' });
};
