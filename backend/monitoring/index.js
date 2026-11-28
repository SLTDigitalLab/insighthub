// Monitoring entry point: `app.use(monitoring.middleware)` first, then `monitoring.mountRoutes(app)`.
const metrics = require('./metrics');
const health = require('./health');
const { monitoringAuth, tokenAuth } = require('./auth');

function mountRoutes(app) {
  app.get('/metrics', monitoringAuth, async (req, res) => {
    try {
      res.set('Content-Type', metrics.register.contentType);
      res.end(await metrics.register.metrics());
    } catch (err) {
      res.status(500).end(err.message);
    }
  });

  const probe = (check) => async (req, res) => {
    const result = await check();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  };
  // Token only (no IP allowlist): these are reached through the public gateway, where the peer is the proxy.
  app.get('/api/health/storage', tokenAuth, probe(health.checkStorage));
  app.get('/api/health/chromadb', tokenAuth, probe(health.checkChroma));
  app.get('/api/health/monitoring', tokenAuth, async (req, res) => {
    const { healthy, body } = await health.checkAll();
    res.status(healthy ? 200 : 503).json(body);
  });
}

module.exports = { middleware: metrics.middleware, mountRoutes };
