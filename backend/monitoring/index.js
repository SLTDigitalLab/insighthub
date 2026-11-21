// Monitoring entry point: `app.use(monitoring.middleware)` first, then `monitoring.mountRoutes(app)`.
const metrics = require('./metrics');
const health = require('./health');
const { monitoringAuth } = require('./auth');

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
  app.get('/api/health/storage', monitoringAuth, probe(health.checkStorage));
  app.get('/api/health/chromadb', monitoringAuth, probe(health.checkChroma));
  app.get('/api/health/monitoring', monitoringAuth, async (req, res) => {
    const { healthy, body } = await health.checkAll();
    res.status(healthy ? 200 : 503).json(body);
  });
}

module.exports = { middleware: metrics.middleware, mountRoutes };
