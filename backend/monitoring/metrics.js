// Prometheus metrics for InsightHub (prefix insighthub_).
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'insighthub_' });

const httpRequestsTotal = new client.Counter({
  name: 'insighthub_http_requests_total',
  help: 'API requests by method, route template, status code and outcome',
  labelNames: ['method', 'route', 'status_code', 'outcome'],
  registers: [register]
});
const httpRequestsSuccess = new client.Counter({
  name: 'insighthub_http_requests_success_total',
  help: 'API requests that finished with status < 400',
  registers: [register]
});
const httpRequestsFailed = new client.Counter({
  name: 'insighthub_http_requests_failed_total',
  help: 'API requests that finished with status >= 400',
  registers: [register]
});
const httpDuration = new client.Histogram({
  name: 'insighthub_http_request_duration_seconds',
  help: 'API request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register]
});
const lastRequestTimestamp = new client.Gauge({
  name: 'insighthub_last_request_timestamp_seconds',
  help: 'Unix time (seconds) of the most recent counted API request',
  registers: [register]
});

// Probe gauges: health.js sets them on every check, and every scrape runs both checks (collect), so they
// never go stale. health.js is required lazily because it requires this file for the gauges.
const storageUp = new client.Gauge({
  name: 'insighthub_storage_up',
  help: '1 if the JSON data directory is readable, else 0',
  registers: [register],
  async collect() { await require('./health').checkStorage(); }
});
const chromadbUp = new client.Gauge({
  name: 'insighthub_chromadb_up',
  help: '1 if the ChromaDB heartbeat answers, else 0',
  registers: [register],
  async collect() { await require('./health').checkChroma(); }
});

// Monitoring/scrape traffic must not inflate API counters.
function isExcluded(urlPath) {
  return urlPath === '/metrics' || urlPath === '/health' || urlPath === '/api/health' || urlPath.startsWith('/api/health/');
}

// Route TEMPLATE (e.g. /api/proposals/templates/:id), never the raw URL, to keep cardinality bounded.
function routeLabel(req) {
  if (!req.route) return 'unmatched';
  const p = Array.isArray(req.route.path) ? req.route.path.join('|') : String(req.route.path);
  return `${req.baseUrl || ''}${p}`;
}

function middleware(req, res, next) {
  const urlPath = req.path || '/';
  if (isExcluded(urlPath)) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const status = res.statusCode;
    const outcome = status < 400 ? 'success' : 'failure';
    const route = routeLabel(req);
    httpRequestsTotal.inc({ method: req.method, route, status_code: status, outcome });
    (outcome === 'success' ? httpRequestsSuccess : httpRequestsFailed).inc();
    httpDuration.observe({ method: req.method, route, status_code: status }, seconds);
    lastRequestTimestamp.set(Date.now() / 1000);
  });
  next();
}

module.exports = { register, middleware, storageUp, chromadbUp };
