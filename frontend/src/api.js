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
  });
  return response.data;
};

/**
 * Fetches product recommendations generated directly from local ChromaDB vector store
 */
export const fetchProductRecommendations = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.recommendations, {
    prompt: promptText
  });
  return response.data;
};

/**
 * Fetches meeting preparation briefs generated directly from local ChromaDB vector store
 */
export const fetchMeetingPreparation = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.meetingPrep, {
    prompt: promptText
  });
  return response.data;
};

/**
 * Fetches lead discovery results (Booking.com hotels & Sri Lanka business directory)
 */
export const fetchLeadDiscovery = async (promptText) => {
  const response = await axios.post(BACKEND_ENDPOINTS.leadDiscovery, {
    prompt: promptText
  });
  return response.data;
};

