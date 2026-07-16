// ============================================================
// n8n Webhook Configuration
// ============================================================
// Update N8N_BASE_URL to match your n8n instance.
// - Local: http://localhost:5678/webhook
// - Cloud: https://your-n8n-instance.app.n8n.cloud/webhook
// - Self-hosted: https://your-domain.com/webhook
// ============================================================

export const N8N_BASE_URL = '/api/n8n';

export const WEBHOOK_URLS = {
  lead:     `${N8N_BASE_URL}/lead-discovery`,
  research: `${N8N_BASE_URL}/customer-research`,
  meeting:  `${N8N_BASE_URL}/meeting-prep`,
  product:  `${N8N_BASE_URL}/product-recommendation`,
  email:    `${N8N_BASE_URL}/send-results-email`,
};
