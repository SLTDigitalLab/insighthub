// ============================================================
// InsightHub Configuration (n8n Webhooks & Local Backend)
// ============================================================

export const N8N_BASE_URL = '/api/n8n';
export const LOCAL_BACKEND_URL = '/api';

export const WEBHOOK_URLS = {
  lead:                  `${N8N_BASE_URL}/lead-discovery`,
  research:              `${N8N_BASE_URL}/customer-research`,
  meeting:               `${N8N_BASE_URL}/meeting-prep`,
  product:               `${N8N_BASE_URL}/product-recommendation`,
  email:                 `${N8N_BASE_URL}/send-results-email`,
  improve:               `${N8N_BASE_URL}/help-improve-service`,
  localKnowledgeSync:    `${N8N_BASE_URL}/local-knowledge-sync`,
};

export const BACKEND_ENDPOINTS = {
  documents:          `${LOCAL_BACKEND_URL}/documents`,
  uploadDocument:     `${LOCAL_BACKEND_URL}/documents/upload`,
  vectorSearch:       `${LOCAL_BACKEND_URL}/vector/search`,
  recommendations:    `${LOCAL_BACKEND_URL}/recommendations`,
  meetingPrep:        `${LOCAL_BACKEND_URL}/meeting-prep`,
  leadDiscovery:      `${LOCAL_BACKEND_URL}/lead-discovery`,
  customerResearch:   `${LOCAL_BACKEND_URL}/customer-research`,
  helpImproveService: `${LOCAL_BACKEND_URL}/help-improve-service`,
  health:             `${LOCAL_BACKEND_URL}/health`,
};

