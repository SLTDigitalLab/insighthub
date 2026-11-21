// Component probes for monitoring. Each returns a plain object with status 'ok' | 'error' and never throws.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const metrics = require('./metrics');

const CHROMA_TIMEOUT_MS = 3000;
const MAX_PROBE_JSON_BYTES = 1024 * 1024; // parse at most a 1 MB file

// Same resolution every service uses, so nothing that already works changes.
const dataDir = () => process.env.DATA_DIR || path.join(__dirname, '..', 'data');

async function checkStorage() {
  const started = Date.now();
  const dir = dataDir();
  const base = { component: 'json_storage', path: dir };
  let result;
  try {
    const st = await fs.promises.stat(dir);
    if (!st.isDirectory()) throw new Error('not a directory');
    await fs.promises.access(dir, fs.constants.R_OK);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    // Parse the smallest non-empty .json file as a cheap read/parse proof.
    const jsonFiles = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.json')) continue;
      const s = await fs.promises.stat(path.join(dir, e.name));
      if (s.size > 0 && s.size <= MAX_PROBE_JSON_BYTES) jsonFiles.push({ name: e.name, size: s.size });
    }
    if (jsonFiles.length) {
      jsonFiles.sort((a, b) => a.size - b.size);
      JSON.parse(await fs.promises.readFile(path.join(dir, jsonFiles[0].name), 'utf8'));
    }
    result = { status: 'ok', ...base };
  } catch (err) {
    result = { status: 'error', ...base, error: err.message };
  }
  result.checkedAt = new Date().toISOString();
  result.latencyMs = Date.now() - started;
  metrics.storageUp.set(result.status === 'ok' ? 1 : 0);
  return result;
}

async function heartbeat(baseUrl, version) {
  const res = await axios.get(`${baseUrl}/api/${version}/heartbeat`, {
    timeout: CHROMA_TIMEOUT_MS,
    signal: AbortSignal.timeout(CHROMA_TIMEOUT_MS),
    validateStatus: () => true
  });
  return res;
}

async function checkChroma() {
  const started = Date.now();
  const baseUrl = (process.env.CHROMA_URL || 'http://localhost:8000').replace(/\/+$/, '');
  let result;
  try {
    // v1 first; Chroma 1.x answers 404/410 there, so fall back to v2.
    let apiVersion = 'v1';
    let res = await heartbeat(baseUrl, 'v1');
    if (res.status === 404 || res.status === 410) {
      apiVersion = 'v2';
      res = await heartbeat(baseUrl, 'v2');
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`heartbeat ${apiVersion} returned HTTP ${res.status}`);
    const body = res.data;
    const hb = body && typeof body === 'object' ? Object.values(body)[0] : body;
    result = { status: 'ok', component: 'chromadb', heartbeat: hb ?? null, apiVersion };
  } catch (err) {
    result = { status: 'error', component: 'chromadb', error: err.message };
  }
  result.checkedAt = new Date().toISOString();
  result.latencyMs = Date.now() - started;
  metrics.chromadbUp.set(result.status === 'ok' ? 1 : 0);
  return result;
}

async function checkAll() {
  const [storage, chromadb] = await Promise.all([checkStorage(), checkChroma()]);
  const api = { status: 'ok', component: 'api', uptimeSeconds: Math.round(process.uptime()), checkedAt: new Date().toISOString() };
  const healthy = storage.status === 'ok' && chromadb.status === 'ok';
  return { healthy, body: { status: healthy ? 'ok' : 'error', checkedAt: api.checkedAt, api, storage, chromadb } };
}

module.exports = { checkStorage, checkChroma, checkAll };
