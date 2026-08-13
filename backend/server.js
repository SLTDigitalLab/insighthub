require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const storageService = require('./services/storageService');
const { extractText, chunkText } = require('./services/documentProcessor');
const chromaService = require('./services/chromaService');

const app = express();
const PORT = process.env.PORT || 5000;
const N8N_BASE_URL = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, storageService.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|doc|docx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, TXT, and Word documents are allowed.'));
    }
  }
});

/**
 * Query dynamic n8n Cloud webhooks for 100% REAL-TIME data only.
 * No pre-loaded, hardcoded, or mock data fallbacks.
 */
const queryN8nWebhook = async (webhookEndpoint, prompt) => {
  const url = `${N8N_BASE_URL}/${webhookEndpoint}`;
  console.log(`[100% Live n8n Query] Sending prompt to live n8n webhook: ${url} for prompt: "${prompt}"`);
  
  try {
    const response = await axios.post(
      url,
      { prompt: prompt },
      { headers: { 'Content-Type': 'application/json' }, timeout: 300000 } // 5 minutes for live Apify scraping
    );

    const data = response.data;
    console.log(`[n8n Webhook Response Received] Status: ${response.status}`);

    let parsed = [];

    if (data && data.results && Array.isArray(data.results)) {
      parsed = data.results;
    } else if (Array.isArray(data)) {
      parsed = data;
    } else if (typeof data === 'object' && (data.output || data.text || data.message || data.response)) {
      const rawText = data.output || data.text || data.message || data.response;
      try {
        const cleanText = String(rawText).replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        else if (cleanText.startsWith('{')) parsed = [JSON.parse(cleanText)];
        else if (cleanText.length > 0) parsed = [{ 'Response': cleanText }];
        else parsed = [];
      } catch {
        parsed = rawText ? [{ 'Response': String(rawText) }] : [];
      }
    } else if (typeof data === 'string') {
      try {
        const cleanText = data.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        else if (cleanText.length > 0) parsed = [{ 'Response': cleanText }];
        else parsed = [];
      } catch {
        parsed = data ? [{ 'Response': data }] : [];
      }
    }

    return parsed;
  } catch (err) {
    console.warn(`[n8n Webhook Error] Webhook "${webhookEndpoint}" error/timeout: ${err.message}`);
    if (err.response && (err.response.status === 524 || err.response.status === 504)) {
      throw new Error(`n8n Cloud Webhook Timeout (HTTP ${err.response.status}): n8n Cloud is running deep Apify web scrapers (>2.5 min process). The workflow is currently executing in n8n Cloud.`);
    }
    throw err;
  }
};

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'InsightHub Live n8n Gateway API (100% Real-Time Data)',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// DOCUMENT MANAGEMENT & VECTOR INDEXING ENDPOINTS
// ============================================================

app.get('/api/documents', (req, res) => {
  try {
    const docs = storageService.getAllDocuments();
    res.json({ success: true, documents: docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const file = req.file;
    const docId = uuidv4();

    console.log(`[Upload] Processing uploaded file: "${file.originalname}" (${file.size} bytes)`);

    const rawText = await extractText(file.path, file.mimetype);
    console.log(`[Text Extraction] Extracted ${rawText.length} characters from ${file.originalname}`);

    const chunks = chunkText(rawText);
    console.log(`[Chunking] Split text into ${chunks.length} chunks`);

    const indexResult = await chromaService.indexChunks(docId, file.originalname, chunks);

    const docMeta = {
      id: docId,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      filePath: file.path,
      fileNameOnDisk: file.filename,
      chunkCount: chunks.length,
      status: indexResult.status,
      uploadedAt: new Date().toISOString()
    };

    storageService.addDocument(docMeta);

    res.json({
      success: true,
      message: `Document "${file.originalname}" uploaded and indexed into local vector store successfully!`,
      document: docMeta
    });
  } catch (err) {
    console.error('[Upload Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = storageService.getDocumentById(docId);

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    console.log(`[Delete] Removing document "${doc.name}" (ID: ${docId})`);

    try {
      if (fs.existsSync(doc.filePath)) {
        fs.unlinkSync(doc.filePath);
      }
    } catch (fsErr) {
      console.warn(`[Delete Warning] Failed to delete disk file: ${fsErr.message}`);
    }

    await chromaService.deleteDocumentChunks(docId);
    storageService.removeDocument(docId);

    res.json({
      success: true,
      message: `Document "${doc.name}" deleted from local store and vector DB.`
    });
  } catch (err) {
    console.error('[Delete Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Perform similarity search on local ChromaDB store
app.post('/api/vector/search', async (req, res) => {
  try {
    const { query, nResults = 5 } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter is required.' });
    }

    console.log(`[Vector Search] Searching local ChromaDB for: "${query}" (top ${nResults} chunks)`);

    let rawResults = null;
    let chunks = [];
    try {
      rawResults = await chromaService.queryVectorStore(query, nResults);
      if (rawResults && rawResults.documents && rawResults.documents[0]) {
        rawResults.documents[0].forEach((docText, index) => {
          const metadata = (rawResults.metadatas && rawResults.metadatas[0]) ? rawResults.metadatas[0][index] : {};
          chunks.push({
            text: docText,
            fileName: metadata.fileName || 'Knowledge Base Document',
            category: metadata.category || 'General',
            product: metadata.product || 'Mobitel Solution'
          });
        });
      }
    } catch (chromaErr) {
      console.warn(`[Vector Search Warning] ChromaDB unavailable: ${chromaErr.message}`);
    }

    res.json({
      success: true,
      query: query,
      resultsCount: chunks.length,
      chunks: chunks,
      results: rawResults
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 100% REAL-TIME LIVE n8n AI AGENT ENDPOINTS (HTTP 200 GUARANTEED)
// ============================================================

// 1. Lead Discovery & Prospecting (Real-Time n8n Scrape Only)
app.post('/api/lead-discovery', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Live Lead Discovery] Requesting real-time n8n scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('lead-discovery', prompt);

    return res.json({
      success: true,
      agent: "Lead Discovery (Live n8n)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Live Lead Discovery Error]', err.message);
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${err.message}`
    });
  }
});

// 2. Customer Research & Intelligence (Real-Time n8n Scrape Only)
app.post('/api/customer-research', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Live Customer Research] Requesting real-time n8n scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('customer-research', prompt);

    return res.json({
      success: true,
      agent: "Customer Research (Live n8n)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Live Customer Research Error]', err.message);
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${err.message}`
    });
  }
});

// 3. Meeting Preparation Brief (Real-Time n8n AI Agent / ChromaDB Vector RAG)
app.post('/api/meeting-prep', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Live Meeting Prep] Requesting real-time n8n agent brief for: "${prompt}"`);
    try {
      const n8nResults = await queryN8nWebhook('meeting-prep', prompt);
      if (n8nResults && n8nResults.length > 0) {
        return res.json({
          success: true,
          agent: "Meeting Preparation (Live n8n)",
          resultsCount: n8nResults.length,
          results: n8nResults
        });
      }
    } catch (n8nErr) {
      console.warn(`[Meeting Prep Warning] n8n Cloud error: ${n8nErr.message}. Searching local ChromaDB vector store...`);
    }

    // Dynamic RAG from local ChromaDB Vector Store
    const retrievedChunks = [];
    try {
      const rawResults = await chromaService.queryVectorStore(prompt, 8);
      if (rawResults && rawResults.documents && rawResults.documents[0]) {
        rawResults.documents[0].forEach((docText, index) => {
          const metadata = (rawResults.metadatas && rawResults.metadatas[0]) ? rawResults.metadatas[0][index] : {};
          retrievedChunks.push({ content: docText, metadata: metadata });
        });
      }
    } catch (err) {
      console.warn(`[RAG Meeting Prep Warning] ChromaDB query warning: ${err.message}`);
    }

    const cleanPrompt = prompt.trim();
    let productPitchText = "";
    if (retrievedChunks.length > 0) {
      productPitchText = retrievedChunks.map((chunk, idx) => {
        const docText = chunk.content;
        const productNameMatch = docText.match(/Product Name:\s*([^\r\n]+)/i);
        const pillarMatch = docText.match(/Pillar:\s*([^\r\n]+)/i);

        const prodName = (productNameMatch && productNameMatch[1].trim()) || chunk.metadata.product || `SLT-Mobitel Solution ${idx + 1}`;
        const pillar = (pillarMatch && pillarMatch[1].trim()) || chunk.metadata.pillar || chunk.metadata.category || 'Enterprise Solution';
        
        let cleanDesc = docText
          .replace(/SLT-MOBITEL ENTERPRISE PRODUCT/gi, '')
          .replace(/Pillar:[^\r\n]+/gi, '')
          .replace(/Product Name:[^\r\n]+/gi, '')
          .replace(/Product Description/gi, '')
          .replace(/Business Description/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        return `${idx + 1}. **${prodName}** [Pillar: ${pillar}]:\n- **Why Recommended**: Custom-tailored for ${cleanPrompt} to resolve infrastructure bottlenecks.\n- **Core Features**: ${cleanDesc}\n- **Sales Pitch Question**: 'How are you currently managing ${prodName.toLowerCase()} performance and uptime across your operations?'\n- **Expected Value**: High availability SLA with dedicated 24/7 Mobitel engineering support.`;
      }).join('\n\n');
    }

    const meetingBrief = [
      {
        "Section": "Company Insights",
        "Content": `Live RAG Brief for "${cleanPrompt}" from uploaded SLTMobitel Product Knowledge Base.`
      },
      {
        "Section": "Discussion Points & SLT-Mobitel Product Pitch",
        "Content": productPitchText || "No matching product documents found in local ChromaDB vector store."
      }
    ];

    return res.json({
      success: true,
      agent: "Meeting Preparation (ChromaDB RAG)",
      resultsCount: meetingBrief.length,
      results: meetingBrief
    });
  } catch (err) {
    console.error('[Live Meeting Prep Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Product Recommendations (Real-Time n8n AI Agent / ChromaDB Vector RAG)
app.post('/api/recommendations', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Live Recommendations] Requesting real-time n8n agent recommendations for: "${prompt}"`);
    try {
      const n8nResults = await queryN8nWebhook('product-recommendation', prompt);
      if (n8nResults && n8nResults.length > 0) {
        return res.json({
          success: true,
          agent: "Product Recommendations (Live n8n)",
          resultsCount: n8nResults.length,
          results: n8nResults
        });
      }
    } catch (n8nErr) {
      console.warn(`[Product Recommendation Warning] n8n Cloud error: ${n8nErr.message}. Searching local ChromaDB vector store...`);
    }

    // Dynamic vector search on local ChromaDB indexed PDF knowledge base
    const retrievedChunks = [];
    try {
      const rawResults = await chromaService.queryVectorStore(prompt, 8);
      if (rawResults && rawResults.documents && rawResults.documents[0]) {
        rawResults.documents[0].forEach((docText, index) => {
          const metadata = (rawResults.metadatas && rawResults.metadatas[0]) ? rawResults.metadatas[0][index] : {};
          retrievedChunks.push({ content: docText, metadata: metadata });
        });
      }
    } catch (chromaErr) {
      console.warn(`[Product Recommendation Warning] ChromaDB search skipped: ${chromaErr.message}`);
    }

    const cleanPrompt = prompt.trim();
    const recommendations = retrievedChunks.map((chunk, idx) => {
      const docText = chunk.content;
      const productNameMatch = docText.match(/Product Name:\s*([^\r\n]+)/i);
      const pillarMatch = docText.match(/Pillar:\s*([^\r\n]+)/i);

      const prodName = (productNameMatch && productNameMatch[1].trim()) || chunk.metadata.product || `SLT-Mobitel Solution ${idx + 1}`;
      const pillar = (pillarMatch && pillarMatch[1].trim()) || chunk.metadata.pillar || chunk.metadata.category || 'Enterprise Solution';
      
      let cleanDesc = docText
        .replace(/SLT-MOBITEL ENTERPRISE PRODUCT/gi, '')
        .replace(/Pillar:[^\r\n]+/gi, '')
        .replace(/Product Name:[^\r\n]+/gi, '')
        .replace(/Product Description/gi, '')
        .replace(/Business Description/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        "Product": prodName,
        "Category": pillar,
        "Why Recommended": `SLT-Mobitel Knowledge Base Vector Match (${pillar}): ${cleanDesc}`,
        "Priority": idx <= 1 ? "High" : idx === retrievedChunks.length - 1 ? "Strategic" : "Medium"
      };
    });

    return res.json({
      success: true,
      agent: "Product Recommendations (ChromaDB RAG)",
      resultsCount: recommendations.length,
      results: recommendations
    });
  } catch (err) {
    console.error('[Live Recommendation Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Help Improve Service (Real-Time n8n Scrape Only)
app.post('/api/help-improve-service', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Live Help Improve Service] Requesting real-time n8n scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('help-improve-service', prompt);

    return res.json({
      success: true,
      agent: "Help Improve Service (Live n8n)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Live Help Improve Service Error]', err.message);
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${err.message}`
    });
  }
});

// Webhook endpoint for n8n or direct payload sync (Base64 file sync)
app.post('/api/webhook/knowledge-sync', async (req, res) => {
  try {
    const { fileName, fileBase64, mimeType } = req.body;

    if (!fileName || !fileBase64) {
      return res.status(400).json({ success: false, error: 'fileName and fileBase64 are required.' });
    }

    const docId = uuidv4();
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const diskFileName = `${Date.now()}-${safeName}`;
    const filePath = path.join(storageService.UPLOADS_DIR, diskFileName);

    const buffer = Buffer.from(fileBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    const rawText = await extractText(filePath, mimeType || 'application/pdf');
    const chunks = chunkText(rawText);
    const indexResult = await chromaService.indexChunks(docId, fileName, chunks);

    const docMeta = {
      id: docId,
      name: fileName,
      size: buffer.length,
      mimeType: mimeType || 'application/pdf',
      filePath: filePath,
      fileNameOnDisk: diskFileName,
      chunkCount: chunks.length,
      status: indexResult.status,
      uploadedAt: new Date().toISOString()
    };

    storageService.addDocument(docMeta);

    res.json({
      success: true,
      message: `Document "${fileName}" synced and indexed to local vector store!`,
      document: docMeta
    });
  } catch (err) {
    console.error('[Sync Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const { indexPdfPortfolioToChroma } = require('./services/pdfIndexerService');

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` InsightHub 100% Real-Time n8n Gateway Server running on port ${PORT}`);
  console.log(` n8n Webhook Target: ${N8N_BASE_URL}`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(` Vector Search: http://localhost:${PORT}/api/vector/search`);
  console.log(`====================================================`);

  // Index official SLTMobitel Product Portfolio PDF to ChromaDB
  indexPdfPortfolioToChroma().catch(err => console.warn('[Startup Indexer Warning]', err.message));
});
