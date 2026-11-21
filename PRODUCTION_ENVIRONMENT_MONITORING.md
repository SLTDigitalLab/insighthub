# InsightHub Production Environment — Monitoring Specification

This document provides technical specifications and service details for configuring system, application, and health monitoring (e.g., Prometheus, Grafana, Uptime Kuma) for the **InsightHub** production environment.

---

## 1. Frontend

* **Service Name:** `frontend` *(Docker Compose service identifier)*
* **Container Name:** `insighthub-frontend` *(Docker container name)*
* **Internal Port:** `80` *(Nginx HTTP web server)*
* **External Port Mapping:** `80:80` (or `443:443` with SSL termination)
* **Architecture / Technology:** React 19 (Vite) built to static distribution files served via Nginx Alpine.
* **Production Host Setup (Alternative):**
  * Server IP: `157.245.159.130`
  * Path: `/var/www/insighthub/frontend/dist`
  * Deployed via host Nginx proxying requests to the backend API.

---

## 2. Backend / API

* **Exact Service Name:** `backend` *(Docker Compose)* / `insighthub-backend` *(Container name)*
  * *Package Name (`package.json`):* `insight-hub-backend`
  * *Host Process (PM2):* `node server.js`
* **Internal Port:** `5000` *(Configurable via `PORT` environment variable; fallback default: `5005`)*
* **Runtime:** Node.js 20 (Alpine) / Express.js
* **Health-Check Endpoints:** `/api/health` and `/health`

---

## 3. Backend Health Check

* **Exposed Endpoints:**
  * **Primary Endpoint:** `/api/health`
  * **Secondary / Legacy Endpoint:** `/health`
* **Endpoint URLs:**
  * **Direct to Backend (Internal Container / Host):**
    ```http
    GET http://<backend-host>:5000/api/health
    GET http://localhost:5000/api/health
    ```
  * **Via Reverse Proxy / Public Gateway (Nginx):**
    ```http
    GET http://<domain-or-ip>/api/health
    GET http://157.245.159.130/api/health
    GET https://insighthub.raccoon-ai.io/api/health
    ```
* **Sample HTTP 200 Response (`/api/health`):**
  ```json
  {
    "status": "ok",
    "service": "InsightHub Pure n8n Gateway API (100% Live n8n Cloud Data Only)",
    "timestamp": "2026-11-03T16:00:00.000Z"
  }
  ```
* **Sample HTTP 200 Response (`/health`):**
  ```json
  {
    "status": "ok",
    "message": "InsightHub Backend & Vector Gateway is running."
  }
  ```

---

## 4. Database

* **Production Database Type:** **File-based JSON Document Store** *(Local Filesystem Persistence)*
  * InsightHub does not connect to an external RDBMS/NoSQL server (such as PostgreSQL, MySQL, or MongoDB).
  * Application state and business records are stored directly as structured JSON files inside `backend/data/` (mounted into `/app/backend/data` via Docker volume `backend_data`).
  * **Managed Data Stores:**
    * `users.json` — User credentials, access requests, roles, and administrative statuses.
    * `documents.json` — Knowledge base PDF and document metadata.
    * `products.json` — SLT-Mobitel enterprise solutions & catalog data.
    * `saved_proposals.json` — Generated B2B customer proposals.
    * `proposal_refs.jsonl` — Sequential proposal reference IDs (`EL-XXXXXX`).
    * `search_history.json` — User search and discovery history.
    * `vector_store.json` — Local vector embeddings fallback.
* **Service Name:** N/A *(Embedded directly in Node.js backend services)*
* **Hostname:** `localhost` *(Local filesystem access)*
* **Port:** N/A *(Direct file system I/O)*

---

## 5. Database Monitoring

* **Is a database exporter (e.g. Prometheus exporter) running?**  
  **No.** Because there is no standalone database daemon process, no dedicated database exporter (like `postgres_exporter` or `mysqld_exporter`) is present.
* **Is there a database health endpoint that Prometheus can scrape?**  
  **No.** There is no dedicated database health endpoint.
* **Monitoring Strategy & Recommendations:**
  1. **Filesystem / Disk Space Monitoring:** Because storage depends on local disk I/O, deploy `node-exporter` on the host to monitor disk capacity and inode exhaustion on the partition hosting `/backend/data/` or Docker volume mounts.
  2. **Process Health:** Monitoring `GET /api/health` validates that the Node.js process is active and healthy.

---

## 6. Chroma (Vector Database)

* **Is Chroma used in Production?**  
  **Yes, in Hybrid / Dual Mode.**
  * The backend initializes a Chroma client using the `CHROMA_URL` environment variable.
  * In addition, the backend implements an autonomous in-memory & file-based cosine similarity vector fallback (`vector_store.json`). If ChromaDB is offline, vector searches seamlessly fall back to local computation without throwing fatal errors.
* **Service Name:** `chromadb`
* **Hostname:**
  * *Within Docker Network (`insighthub-network`):* `chromadb` (configured as `CHROMA_URL=http://chromadb:8000`)
  * *Standalone Host:* `localhost` / `127.0.0.1`
* **Port:** `8000`
* **Health-Check Endpoint:**  
  ```http
  GET http://<chroma-host>:8000/api/v1/heartbeat
  ```
  *(Standard ChromaDB API heartbeat; returns a nanosecond heartbeat timestamp)*

---

## 7. Prometheus Metrics

* **Are Prometheus metrics endpoints currently exposed?**  
  **No.** Neither the frontend nor the backend currently exposes an active `/metrics` endpoint.
* **Current Status:**
  * Backend: No Prometheus client (such as `prom-client`) is installed in `backend/package.json`.
  * Frontend: Static bundle served by Nginx without `nginx-prometheus-exporter` or `/stub_status` enabled.
* **Recommended Implementation:**
  * **Backend (`/api/metrics` or `/metrics`):**
    1. Install `prom-client`:
       ```bash
       cd backend && npm install prom-client
       ```
    2. Register default metrics in `backend/server.js`:
       ```javascript
       const client = require('prom-client');
       const collectDefaultMetrics = client.collectDefaultMetrics;
       collectDefaultMetrics({ register: client.register });

       app.get('/metrics', async (req, res) => {
         res.set('Content-Type', client.register.contentType);
         res.end(await client.register.metrics());
       });
       ```
  * **Frontend / Nginx:**
    Enable `stub_status` inside `nginx.conf` and attach a lightweight `nginx-prometheus-exporter` sidecar container:
    ```nginx
    location /stub_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
    ```

---

## 8. Summary Table for Monitoring Configuration

| Component | Target Host | Port | Health Check / Probe URL | Metrics Endpoint |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | `localhost` / `157.245.159.130` | `80` (HTTP) / `443` (HTTPS) | `http://<host>/` | N/A (Optional: Nginx stub_status) |
| **Backend API** | `localhost` / `insighthub-backend` | `5000` | `http://<host>:5000/api/health` | `/metrics` *(requires `prom-client`)* |
| **Reverse Proxy API** | `localhost` / `157.245.159.130` | `80` / `443` | `http://<host>/api/health` | N/A |
| **ChromaDB** | `chromadb` / `localhost` | `8000` | `http://<host>:8000/api/v1/heartbeat` | N/A |
| **Storage / Data** | Host Filesystem | N/A | Host Disk Check (`backend/data/`) | Host `node-exporter` (disk metrics) |

