// Guards for monitoring endpoints. Both fail closed (503) when METRICS_TOKEN is not configured.
//   tokenAuth      - bearer token only (401). Used by the /api/health/* probes, which Monitoring-Pulse calls
//                    through the public gateway, where the TCP peer is the proxy and an IP check cannot work.
//   monitoringAuth - IP allowlist (403) then bearer token (401). Used by /metrics, scraped directly on port 5000.
const crypto = require('crypto');

const DEFAULT_ALLOWED = '201.79.102.125,127.0.0.1,::1';

// The client address is the TCP peer. X-Forwarded-For / CF-Connecting-IP are deliberately NOT read: any
// client can forge them, and no trusted proxy is confirmed in front of the backend. Behind a proxy the
// peer is the proxy's address, so the guard denies instead of being fooled.
function clientIp(req) {
  const raw = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  return raw.replace(/^::ffff:/i, '');
}

function allowedIps() {
  return new Set(
    (process.env.MONITORING_ALLOWED_IPS || DEFAULT_ALLOWED)
      .split(',').map(s => s.trim().replace(/^::ffff:/i, '')).filter(Boolean)
  );
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function notConfigured(res) {
  return res.status(503).json({ status: 'error', error: 'Monitoring is disabled: METRICS_TOKEN is not configured.' });
}

function hasValidToken(req, expected) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return !!m && crypto.timingSafeEqual(digest(m[1].trim()), digest(expected));
}

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Bearer');
  return res.status(401).json({ status: 'error', error: 'Unauthorized' });
}

function tokenAuth(req, res, next) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return notConfigured(res);
  if (!hasValidToken(req, expected)) return unauthorized(res);
  next();
}

function monitoringAuth(req, res, next) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return notConfigured(res);
  if (!allowedIps().has(clientIp(req))) {
    return res.status(403).json({ status: 'error', error: 'Forbidden' });
  }
  if (!hasValidToken(req, expected)) return unauthorized(res);
  next();
}

module.exports = { monitoringAuth, tokenAuth, clientIp };
