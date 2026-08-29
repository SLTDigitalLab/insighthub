import axios from 'axios';
import { BACKEND_ENDPOINTS } from './config';

/**
 * Uploads a document to the local backend & indexes to ChromaDB vector store
 */
export const uploadKnowledgeBaseDocument = async (file, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(
    BACKEND_ENDPOINTS.uploadDocument,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      },
      timeout: 180000 // 3 minutes timeout for parsing/embedding
    }
  );

  return response.data;
};

/**
 * Fetches all indexed knowledge base documents from local storage
 */
export const fetchKnowledgeBaseDocuments = async () => {
  const response = await axios.get(BACKEND_ENDPOINTS.documents);
  return response.data;
};

/**
 * Deletes a knowledge base document from local storage and vector DB
 */
export const deleteKnowledgeBaseDocument = async (docId) => {
  const response = await axios.delete(`${BACKEND_ENDPOINTS.documents}/${docId}`);
  return response.data;
};

/**
 * Performs vector similarity search on the local ChromaDB store
 */
export const searchKnowledgeBaseVectors = async (queryText, nResults = 5) => {
  const response = await axios.post(BACKEND_ENDPOINTS.vectorSearch, {
    query: queryText,
    nResults: nResults
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches product recommendations generated directly from local ChromaDB vector store
 */
export const fetchProductRecommendations = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.recommendations, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches meeting preparation briefs generated directly from local ChromaDB vector store
 */
export const fetchMeetingPreparation = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.meetingPrep, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches lead discovery results (Booking.com hotels & Sri Lanka business directory)
 */
export const fetchLeadDiscovery = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.leadDiscovery, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches customer research report with verified company profiles & social links
 */
export const fetchCustomerResearch = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.customerResearch, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches service improvement & review sentiment analysis
 */
export const fetchHelpImproveService = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.helpImproveService, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Fetches newly registered businesses from Sunday Observer registry and matches with Mobitel B2B solutions
 */
export const fetchFindNewBusinesses = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.findNewBusinesses, {
    prompt: promptText
  }, { timeout: 240000 });
  return response.data;
};

/**
 * Sends formatted report results to recipient via backend email gateway
 */
export const sendResultsEmail = async (emailData) => {
  const response = await axios.post('/api/send-results-email', emailData, { timeout: 35000 });
  return response.data;
};


