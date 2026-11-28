# InsightHub monitoring (Monitoring-Pulse)

Monitoring-Pulse (201.79.102.125) already runs Prometheus and Grafana. InsightHub only exposes data for it to pull. Nothing is installed here.

`<INSIGHTHUB_HOST>` below is the public host or IP of the InsightHub origin server. **TO CONFIRM.** `deploy.bat` mentions 157.245.159.130 and `APP_BASE_URL` is `insighthub.raccoon-ai.io`, but nothing in the repo says which one Monitoring-Pulse should scrape.

## 1. Endpoints

All of them are served by the backend on its API port (**5000** in compose and `.env`).

| URL | Method | Port | Auth | Healthy | Unhealthy |
|---|---|---|---|---|---|
| `http://<INSIGHTHUB_HOST>:5000/metrics` | GET | 5000 | IP allowlist + bearer token | 200 (Prometheus text) | 401 bad/missing token, 403 IP not allowed, 503 `METRICS_TOKEN` not configured |
| `http://<INSIGHTHUB_HOST>:5000/api/health` | GET | 5000 | none (unchanged) | 200 `{"status":"ok","message":"InsightHub Backend & Vector Gateway is running."}` | no response / connection error |
| `https://insighthub.raccoon-ai.io/api/health/storage` | GET | 443 (gateway) or 5000 | bearer token only | 200 `{"status":"ok","component":"json_storage","path",...}` | 503 `{"status":"error",...,"error":"..."}` (401 bad/missing token, 503 `METRICS_TOKEN` not configured) |
| `https://insighthub.raccoon-ai.io/api/health/chromadb` | GET | 443 (gateway) or 5000 | bearer token only | 200 `{"status":"ok","component":"chromadb","heartbeat":...,"apiVersion":"v1\|v2",...}` | 503 with `error` |
| `https://insighthub.raccoon-ai.io/api/health/monitoring` | GET | 443 (gateway) or 5000 | bearer token only | 200 only if api, storage and chromadb are all ok | 503, body shows which one failed |

`/api/health` is also reachable through the gateway (`https://insighthub.raccoon-ai.io/api/health`) and stays public. It only reports the backend itself, so a ChromaDB outage does not make it unhealthy.

**Health endpoints are token only (no IP allowlist).** Monitoring-Pulse calls them through the public gateway, where the backend's TCP peer is the proxy, not 201.79.102.125, so an IP check would always return 403. No IP whitelisting is needed for them.

`/metrics` keeps IP allowlist + token. It is not under `/api/`, so the gateway does not proxy it. Prometheus must scrape it on port 5000 directly.

`/metrics` and `/api/health*` are not counted in the API traffic counters, so scrapes don't inflate them.

## 2. Authentication

```
Authorization: Bearer <value of METRICS_TOKEN>
```

- Env var: `METRICS_TOKEN`. It must be set on the backend, and the same value goes into Prometheus. If it is empty the monitoring endpoints answer 503, so they fail closed.
- **No token exists yet.** Generate one on the production server with `openssl rand -hex 32` and put it in that server's `backend/.env` as `METRICS_TOKEN=<value>` (gitignored, never committed). With Docker, it goes in the root `.env` instead. Restart the backend afterwards (`pm2 restart all --update-env`). Give the same value to Monitoring-Pulse through a private channel, not by email.
- `MONITORING_ALLOWED_IPS` is a comma-separated list of exact IPs. Default: `201.79.102.125,127.0.0.1,::1`. It applies to `/metrics` only.
- The client IP is the TCP peer address. `X-Forwarded-For` and `CF-Connecting-IP` are deliberately ignored and `trust proxy` is not set, because no proxy in front of the backend is confirmed. If a proxy is added later, the peer becomes the proxy's address and the allowlist will deny the monitoring server. See open items.
- Check order on `/metrics`: IP first (403), then token (401). The `/api/health/*` probes check the token only (401).
- **Decision:** `/metrics` is served on the API port, not a separate `METRICS_PORT`. That keeps it to one port, one firewall rule and one compose mapping. Token plus allowlist protect it. A separate port would add a mapping for no real gain.
- **Deviation from the brief:** `/api/health/storage` also requires auth. Its response contains a filesystem path and raw error text, so it shouldn't be public. The `insighthub_storage_up` gauge covers it anyway.

## 3. Network and firewall

**Inbound rule:** allow TCP 5000 from 201.79.102.125 only.

**ufw (do not run blindly; just listed):**
```bash
sudo ufw allow from 201.79.102.125 to any port 5000 proto tcp comment 'Monitoring-Pulse scrape'
# only if port 5000 is not meant to be public otherwise:
# sudo ufw deny 5000/tcp
```

**iptables (host, non-Docker backend, e.g. pm2):**
```bash
sudo iptables -A INPUT -p tcp -s 201.79.102.125 --dport 5000 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5000 -j DROP   # only if 5000 should not be public otherwise
```

**Docker-published port.** Docker inserts its own rules and bypasses UFW, so if the backend runs in compose with `"5000:5000"`, the rules above are not enough. Use the `DOCKER-USER` chain. Note it sees the post-DNAT container port, so use `--ctorigdstport`:
```bash
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 5000 --ctdir ORIGINAL -j DROP
sudo iptables -I DOCKER-USER -p tcp -s 201.79.102.125 -m conntrack --ctorigdstport 5000 --ctdir ORIGINAL -j ACCEPT
```
The ACCEPT is inserted last, so it ends up first. If the frontend or users need to reach 5000 from elsewhere, adjust accordingly. They normally use port 80, which proxies `/api/` internally. Persist the rules with `iptables-persistent` or equivalent.

**Cloudflare or proxy:** none is confirmed in the repo. There is no tunnel config, and nginx only lives in the frontend container. If `insighthub.raccoon-ai.io` is proxied by Cloudflare, Monitoring-Pulse must scrape the **origin IP:5000 directly**, not the Cloudflare hostname. Cloudflare doesn't proxy port 5000 on the standard plan, and it would hide the source IP from the allowlist. **TO CONFIRM.**

**ChromaDB port 8000 is internal only.** `docker-compose.yml` has no ChromaDB service and no `8000` mapping at all. Chroma is started by hand with `start_chroma.bat`, and the backend reaches it through `CHROMA_URL`.
- If Chroma is started with `chroma run --port 8000`, it binds `127.0.0.1` by default. Don't pass `--host 0.0.0.0` without a firewall.
- Nothing in the repo was changed for this. Whatever starts Chroma on the real server still has to be checked. **TO CONFIRM.**

## 4. Prometheus config (Monitoring-Pulse)

```yaml
scrape_configs:
  - job_name: insighthub
    metrics_path: /metrics
    scheme: http
    scrape_interval: 30s
    scrape_timeout: 10s          # chromadb probe waits up to 3s when Chroma is down
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/insighthub_metrics_token   # file holding only the token
      # or: credentials: <token>   (inline, avoid committing it)
    static_configs:
      - targets: ['<INSIGHTHUB_HOST>:5000']    # origin IP, TO CONFIRM
        labels:
          app: insighthub
```

**Health endpoints:** no extra exporter is needed. The gauges `insighthub_storage_up` and `insighthub_chromadb_up` are refreshed on every `/metrics` scrape, because each scrape runs both probes. They carry the same information as the 200/503 codes of `/api/health/storage` and `/api/health/chromadb`. `up{job="insighthub"}` covers "API unreachable".

Only add `blackbox_exporter` if you want HTTP status codes and probe latency recorded as separate series. In that case use an `http_2xx` module with `authorization` set in the module's `http` config, and probe `/api/health/monitoring`.

## 5. PromQL for Grafana

```promql
# Request rate (req/s)
sum(rate(insighthub_http_requests_total[5m]))

# Success vs failure rate
sum(rate(insighthub_http_requests_success_total[5m]))
sum(rate(insighthub_http_requests_failed_total[5m]))

# Error %
100 * sum(rate(insighthub_http_requests_failed_total[5m]))
    / clamp_min(sum(rate(insighthub_http_requests_total[5m])), 1e-9)

# Latency by route (p50 / p95 / p99; change 0.95)
histogram_quantile(0.95, sum by (le, route) (rate(insighthub_http_request_duration_seconds_bucket[5m])))
histogram_quantile(0.50, sum by (le, route) (rate(insighthub_http_request_duration_seconds_bucket[5m])))
histogram_quantile(0.99, sum by (le, route) (rate(insighthub_http_request_duration_seconds_bucket[5m])))

# Time since last API request (seconds)
time() - insighthub_last_request_timestamp_seconds

# Storage / ChromaDB up (1 = ok)
insighthub_storage_up
insighthub_chromadb_up

# API reachable
up{job="insighthub"}
```

`insighthub_http_requests_success_total` and `_failed_total` are unlabelled, so `rate()` of them has no per-route breakdown. For one, use `insighthub_http_requests_total{outcome="failure"}`. Routes served by `express.static` (such as `/uploads`) and 404s are labelled `route="unmatched"`. If the server has never received a request, the labelled series and `last_request_timestamp` don't exist yet.

## 6. Files changed

| File | Change |
|---|---|
| `backend/monitoring/metrics.js` (new) | prom-client registry, `insighthub_` default metrics, HTTP counters, histogram, last-request gauge, `storage_up` and `chromadb_up` gauges, request middleware |
| `backend/monitoring/health.js` (new) | storage probe (`DATA_DIR` or `backend/data`: stat, R_OK, readdir, parse the smallest `.json`) and ChromaDB probe (`CHROMA_URL`, v1 then v2 on 404/410, 3 s timeout) |
| `backend/monitoring/auth.js` (new) | `monitoringAuth` (IP allowlist then bearer token) and `tokenAuth` (bearer token only), constant-time compare, both fail closed |
| `backend/monitoring/index.js` (new) | mounts `/metrics` (`monitoringAuth`) and `/api/health/{storage,chromadb,monitoring}` (`tokenAuth`) |
| `backend/server.js` | 4 lines right after `express()`: metrics middleware and monitoring routes mounted before everything else. Existing `/api/health` untouched |
| `backend/package.json`, `package-lock.json` | adds `prom-client` ^15.1.3 |
| `backend/.env.example` | `METRICS_TOKEN` (empty placeholder) and `MONITORING_ALLOWED_IPS` |
| `docker-compose.yml` | passes `METRICS_TOKEN` and `MONITORING_ALLOWED_IPS` through to the backend container |
| `scripts/verify-monitoring.sh` / `.ps1` (new) | the verification checks |
| `docs/MONITORING.md` (new) | this file |

`METRICS_PORT` is not used.

## 7. Verification results and open items

**Verified on 2026-11-19.** Docker isn't running on this machine and no real ChromaDB is installed, so I ran the backend with `node server.js` (port 5055, temp copy of the data dir) against a small fake Chroma server (v1 answers 410, v2 answers 200).
- `/api/health` is identical to the response recorded before the change.
- `/metrics`: 401 with no token, 401 with a wrong token, 200 with the right one. A non-allowlisted IP gets 403, including when `X-Forwarded-For` or `CF-Connecting-IP` are forged. With `METRICS_TOKEN` empty it returns 503.
- After one success and one 404, `success_total`, `failed_total` and the timestamp all increased. The `outcome` and `route` labels were correct, including `route="unmatched"`.
- Storage: 200, then 503 after the data directory was deleted while the server was running.
- ChromaDB: 200 with `apiVersion:"v2"` (v1 returned 410). 503 and `insighthub_chromadb_up 0` after the fake server was stopped, then 200 again after it was restarted.
- Both `scripts/verify-monitoring.sh` and `.ps1` ended with ALL CHECKS PASSED against that instance.

**Not verified (TO CONFIRM):**
- Real ChromaDB. The server version and whether it answers v1 or v2 are unknown (the JS client is 1.10.5). Both are handled.
- `docker compose up -d --build` was not run. The compose Dockerfile looks broken: the build context is the repo root, `COPY package*.json` finds no root `package.json`, and `CMD node server.js` runs from `/app` while the code would sit in `/app/backend`. It was like this before this change.
- `docker port` and `compose ps` output for 8000 (step 6). There is no compose service to show.
- Which server Monitoring-Pulse should scrape, and how the backend is actually run in production (`deploy.bat` suggests pm2).
- Whether Cloudflare or another proxy sits in front of the origin. If one does, the exact-IP allowlist needs a trusted-proxy setup.
- `METRICS_TOKEN` has not been set on the production server yet (see section 2). With pm2 it goes in `backend/.env`; with Docker, compose reads it from the shell or the root `.env`, not from `backend/.env`.
- The chromadb service name and port. Compose references `chromadb:8000` but defines no such service.

**Pre-existing, unrelated:** `server.js` defines `/api/health` twice (the first wins).
