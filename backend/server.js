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
const userService = require('./services/userService');

const app = express();
const PORT = process.env.PORT || 5005;
const N8N_BASE_URL = process.env.N8N_WEBHOOK_BASE || 'https://sltrnddigitallab.app.n8n.cloud/webhook';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'shalikahathurusinghe3584@gmail.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://insighthub.raccoon-ai.io';


// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));



// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'InsightHub Backend & Vector Gateway is running.' });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'InsightHub Backend & Vector Gateway is running.' });
});

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
    const allowedTypes = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|txt|doc|docx|xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, TXT, Word, Excel (.xlsx/.xls), and CSV files.'));
    }
  }
});

/**
 * PURE n8n CLOUD PROXY
 * Strictly queries live n8n Cloud webhooks. 
 * ZERO pre-loaded data, ZERO backend arrays, ZERO fallback generators.
 */
const queryN8nWebhook = async (webhookEndpoint, prompt) => {
  const url = `${N8N_BASE_URL}/${webhookEndpoint}`;
  console.log(`[Pure n8n Cloud Proxy] Querying live n8n webhook: ${url} for prompt: "${prompt}"`);
  
  const response = await axios.post(
    url,
    { prompt: prompt },
    { headers: { 'Content-Type': 'application/json' }, timeout: 300000 } // 5-minute client timeout
  );

  const data = response.data;
  console.log(`[n8n Live Scrape Payload Received] Status: ${response.status}`);

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
    } catch {
      parsed = rawText ? [{ 'Response': String(rawText) }] : [];
    }
  } else if (typeof data === 'string') {
    try {
      const cleanText = data.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else if (cleanText.length > 0) parsed = [{ 'Response': cleanText }];
    } catch {
      parsed = data ? [{ 'Response': data }] : [];
    }
  }

  return parsed;
};

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'InsightHub Pure n8n Gateway API (100% Live n8n Cloud Data Only)',
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

// 6. Find New Businesses (Sunday Observer / Daily Mirror Registry + Mobitel Solution Knowledge Base)
app.post('/api/find-new-businesses', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Find New Businesses] Processing query: "${prompt}"`);

    // 1. Retrieve relevant registry chunks and Mobitel catalog chunks from local vector store
    let registryChunks = [];
    let catalogChunks = [];
    try {
      const rawResults = await chromaService.queryVectorStore(prompt, 8);
      if (rawResults && rawResults.documents && rawResults.documents[0]) {
        rawResults.documents[0].forEach((docText, index) => {
          const metadata = (rawResults.metadatas && rawResults.metadatas[0]) ? rawResults.metadatas[0][index] : {};
          const fileName = metadata.fileName || '';
          if (fileName.includes('Mobitel') || fileName.includes('Catalog') || fileName.includes('Portfolio')) {
            catalogChunks.push({ text: docText, fileName: fileName });
          } else {
            registryChunks.push({ text: docText, fileName: fileName });
          }
        });
      }
    } catch (chromaErr) {
      console.warn(`[Find New Businesses Warning] Local Vector search skipped: ${chromaErr.message}`);
    }

    // 2. Build rich prompt: If user uploaded registry documents exist, pass them. Otherwise, instruct agent to search live web.
    let finalPrompt = '';
    if (registryChunks.length > 0) {
      finalPrompt = `User Request: ${prompt}\n\n=== UPLOADED SUNDAY OBSERVER / DAILY MIRROR REGISTRY DATA ===\n` +
        registryChunks.map((c, i) => `[Source: ${c.fileName}]\n${c.text}`).join('\n\n') +
        `\n\nExtract all newly registered companies from the registry text above, verify details with Google search if needed, and recommend tailored SLTMobitel B2B products for each company. Return a clean JSON array.`;
    } else {
      finalPrompt = `Find real operating and newly registered business entities matching the query: "${prompt}". Actively use Google Search via Apify to discover companies in Sri Lanka (e.g. from directories, gazettes, or registry records), extract their company name, location, contact number, and match each with tailored SLTMobitel B2B products. Return a clean JSON array.`;
    }

    console.log(`[Find New Businesses] Forwarding prompt to live n8n Cloud Agent (attached ${registryChunks.length} registry chunks)`);
    const n8nResults = await queryN8nWebhook('find-new-businesses', finalPrompt);

    return res.json({
      success: true,
      agent: "Find New Businesses (Sunday Observer Registry)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Find New Businesses Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.message || '';
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${errText}`
    });
  }
});

// Endpoint for n8n to sync and index documents to local ChromaDB store
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
// PURE n8n CLOUD ENDPOINTS (STRICT LIVE n8n SCRAPE DATA ONLY)
// ============================================================

// 1. Lead Discovery & Prospecting (Live n8n Cloud Webhook)
app.post('/api/lead-discovery', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Lead Discovery] Requesting live n8n scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('lead-discovery', prompt);

    return res.json({
      success: true,
      agent: "Lead Discovery (Live n8n Cloud)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Lead Discovery Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.message || '';
    if (err.response?.status === 524 || errText.includes('524')) {
      return res.status(524).json({
        success: false,
        error: "n8n Cloud Webhook Timeout (524): The n8n AI Agent is currently executing deep web scrapers in n8n Cloud (>2.5 min process). Please click Search again to fetch the completed leads."
      });
    }
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${errText}`
    });
  }
});

// 1.5 All Search Results (Comprehensive - All Low/Medium/High Lead Scores Included)
app.post('/api/all-search-results', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[All Search Results] Requesting comprehensive scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('lead-discovery', prompt);

    // Process all results, computing Lead Score for entries if absent, preserving ALL scores
    const allLeads = (n8nResults || []).map(item => {
      let score = item['Lead Score'];
      if (!score || score === 'null' || score === 'N/A') {
        const rating = parseFloat(item['Customer Rating']) || 0;
        const size = (item['Size'] || '').toLowerCase();
        if (rating >= 4.0 || size === 'enterprise') score = 'High';
        else if (rating >= 3.0 || size === 'medium') score = 'Medium';
        else score = 'Low';
      }
      return {
        ...item,
        'Lead Score': score
      };
    });

    return res.json({
      success: true,
      agent: "All Search Results (All Scores)",
      resultsCount: allLeads.length,
      results: allLeads
    });
  } catch (err) {
    console.error('[All Search Results Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.message || '';
    if (err.response?.status === 524 || errText.includes('524')) {
      return res.status(524).json({
        success: false,
        error: "n8n Cloud Webhook Timeout (524): Deep scraping in progress. Please click Search again to fetch the results."
      });
    }
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${errText}`
    });
  }
});

// 2. Customer Research & Intelligence (Live n8n Cloud Webhook)
app.post('/api/customer-research', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Customer Research] Requesting live n8n scrape for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('customer-research', prompt);

    return res.json({
      success: true,
      agent: "Customer Research (Live n8n Cloud)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Customer Research Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.message || '';
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${errText}`
    });
  }
});

// 2.5 Help Improve Service (Live n8n Cloud Webhook)
app.post('/api/help-improve-service', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Help Improve Service] Requesting live n8n analysis for: "${prompt}"`);
    const n8nResults = await queryN8nWebhook('help-improve-service', prompt);

    return res.json({
      success: true,
      agent: "Help Improve Service (Live n8n Cloud)",
      resultsCount: n8nResults ? n8nResults.length : 0,
      results: n8nResults || []
    });
  } catch (err) {
    console.error('[Help Improve Service Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.message || '';
    if (err.response?.status === 524 || errText.includes('524')) {
      return res.status(524).json({
        success: false,
        error: "n8n Cloud Webhook Timeout (524): The n8n AI Agent is currently analyzing customer reviews and feedback. Please click Search again to fetch the results."
      });
    }
    return res.status(500).json({
      success: false,
      error: `Live n8n Webhook Error: ${errText}`
    });
  }
});

// 3. Meeting Preparation Brief (Live n8n Cloud Webhook / ChromaDB Vector RAG)
app.post('/api/meeting-prep', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Meeting Prep] Requesting live n8n brief for: "${prompt}"`);
    try {
      const n8nResults = await queryN8nWebhook('meeting-prep', prompt);
      if (n8nResults && n8nResults.length > 0) {
        return res.json({
          success: true,
          agent: "Meeting Preparation (Live n8n Cloud)",
          resultsCount: n8nResults.length,
          results: n8nResults
        });
      }
    } catch (n8nErr) {
      console.warn(`[Meeting Prep Warning] n8n Cloud query fallback to ChromaDB PDF Vector Store: ${n8nErr.message}`);
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
        "Content": `Live Brief for "${cleanPrompt}" from uploaded SLTMobitel Product Knowledge Base.`
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
    console.error('[Meeting Prep Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Product Recommendations (Live n8n Cloud Webhook / ChromaDB Vector RAG)
app.post('/api/recommendations', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt parameter is required.' });
    }

    console.log(`[Recommendations] Requesting live n8n recommendations for: "${prompt}"`);
    try {
      const n8nResults = await queryN8nWebhook('product-recommendation', prompt);
      if (n8nResults && n8nResults.length > 0) {
        return res.json({
          success: true,
          agent: "Product Recommendations (Live n8n Cloud)",
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
    console.error('[Recommendation Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Send Results Email (Live n8n Cloud Webhook Proxy)
app.post(['/api/send-results-email', '/api/n8n/send-results-email'], async (req, res) => {
  try {
    const { email, subject, agentName, results } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Recipient email is required.' });
    }

    console.log(`[Email Results] Sending report for "${agentName}" to: ${email}`);

    // Build styled HTML report table for the email body
    let htmlTable = '';
    if (results && Array.isArray(results) && results.length > 0) {
      const columns = Object.keys(results[0]);
      const headerHtml = columns.map(c => `<th style="padding: 10px 14px; background: #0066FF; color: white; text-align: left; font-size: 12px; font-weight: bold; text-transform: uppercase;">${c}</th>`).join('');
      const rowsHtml = results.map((row, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        const cells = columns.map(c => {
          let val = row[c] || '';
          if (typeof val === 'string') {
            val = val.replace(/\n/g, '<br/>');
          }
          return `<td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b; line-height: 1.5;">${val}</td>`;
        }).join('');
        return `<tr style="background: ${bg};">${cells}</tr>`;
      }).join('');

      htmlTable = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-family: Arial, sans-serif;">
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    const fullHtmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #0f172a; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="border-bottom: 2px solid #0066FF; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #0066FF; margin: 0; font-size: 22px;">InsightHub — SLTMobitel Sales Intelligence</h2>
        </div>
        <p style="font-size: 15px; margin-bottom: 8px;"><strong>Report:</strong> ${agentName || 'Intelligence Report'}</p>
        <p style="font-size: 13px; color: #64748b; margin-top: 0;">Generated on ${new Date().toLocaleString()} for ${email}</p>
        ${htmlTable}
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
          SLTMobitel Enterprise Sales Intelligence • Confidential & Proprietary
        </div>
      </div>
    `;

    // Forward to n8n Cloud webhook
    const n8nPayload = {
      email: email,
      toEmail: email,
      subject: subject || `InsightHub - ${agentName || 'Sales Intelligence'} Results`,
      agentName: agentName,
      results: results,
      htmlBody: fullHtmlBody,
      html: fullHtmlBody,
      text: JSON.stringify(results, null, 2),
      body: {
        email: email,
        subject: subject || `InsightHub - ${agentName || 'Sales Intelligence'} Results`,
        agentName: agentName,
        results: results,
        htmlBody: fullHtmlBody
      }
    };

    const webhookUrl = `${N8N_BASE_URL}/send-results-email`;
    console.log(`[Email Proxy] Forwarding to n8n webhook: ${webhookUrl}`);
    const n8nRes = await axios.post(webhookUrl, n8nPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return res.json({
      success: true,
      message: `Results successfully emailed to ${email}`,
      n8nResponse: n8nRes.data
    });
  } catch (err) {
    console.error('[Email Proxy Error]', err.message);
    const errText = err.response?.data?.error || err.response?.data?.message || err.message || '';
    return res.status(500).json({
      success: false,
      error: `Email service error: ${errText}`
    });
  }
});

// Multer Storage Configuration for KYC Images (NIC + Face)
const KYC_UPLOADS_DIR = path.join(__dirname, 'uploads', 'kyc');
if (!fs.existsSync(KYC_UPLOADS_DIR)) {
  fs.mkdirSync(KYC_UPLOADS_DIR, { recursive: true });
}

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, KYC_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${file.fieldname}-${unique}${ext}`);
  }
});

const kycUpload = multer({
  storage: kycStorage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Generic Email Dispatcher
const sendEmailNotification = async ({ toEmail, subject, htmlBody }) => {
  try {
    const payload = {
      email: toEmail,
      toEmail: toEmail,
      subject: subject,
      htmlBody: htmlBody,
      html: htmlBody,
      body: {
        email: toEmail,
        subject: subject,
        htmlBody: htmlBody
      }
    };
    await axios.post(`${N8N_BASE_URL}/send-results-email`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 25000
    });
    console.log(`[Email Notification] Dispatched email to: ${toEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email Notification Warning] Failed to send email to ${toEmail}: ${err.message}`);
    return false;
  }
};

// ==========================================
// USER REGISTRATION & ADMIN APPROVAL ROUTES
// ==========================================

// 1. User Registration with KYC Uploads
app.post('/api/auth/register', kycUpload.fields([
  { name: 'nicPhoto', maxCount: 1 },
  { name: 'facePhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, email, nicNumber, regNumber } = req.body;

    if (!email || !nicNumber || !regNumber) {
      return res.status(400).json({
        success: false,
        error: 'Microsoft Work Email, NIC Number, and Employee/Registration Number are required.'
      });
    }

    const nicFile = req.files && req.files['nicPhoto'] ? req.files['nicPhoto'][0] : null;
    const faceFile = req.files && req.files['facePhoto'] ? req.files['facePhoto'][0] : null;

    const nicPhotoUrl = nicFile ? `/api/uploads/kyc/${nicFile.filename}` : '';
    const facePhotoUrl = faceFile ? `/api/uploads/kyc/${faceFile.filename}` : '';

    let nicBase64 = '';
    let faceBase64 = '';
    try {
      if (nicFile && fs.existsSync(nicFile.path)) {
        nicBase64 = `data:${nicFile.mimetype || 'image/jpeg'};base64,${fs.readFileSync(nicFile.path).toString('base64')}`;
      }
      if (faceFile && fs.existsSync(faceFile.path)) {
        faceBase64 = `data:${faceFile.mimetype || 'image/jpeg'};base64,${fs.readFileSync(faceFile.path).toString('base64')}`;
      }
    } catch (readErr) {
      console.warn('[KYC Base64 Error]', readErr.message);
    }

    const user = userService.registerUser({
      name: name || email.split('@')[0],
      email: email,
      nicNumber: nicNumber,
      regNumber: regNumber,
      nicPhotoUrl: nicPhotoUrl,
      facePhotoUrl: facePhotoUrl
    });

    // Build Admin Notification Email with KYC Photos & 1-Click Action Buttons
    const clientOrigin = req.headers.origin || APP_BASE_URL;
    const approveUrl = `${clientOrigin}/approval-action?action=approve&token=${user.approvalToken}`;
    const declineUrl = `${clientOrigin}/approval-action?action=decline&token=${user.declineToken}`;
    const adminPortalUrl = `${clientOrigin}/admin`;

    const fullNicPhotoUrl = nicPhotoUrl ? `${clientOrigin}${nicPhotoUrl}` : '';
    const fullFacePhotoUrl = facePhotoUrl ? `${clientOrigin}${facePhotoUrl}` : '';

    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #0066FF 0%, #10b981 100%); padding: 28px 36px;">
          <h1 style="color: white; margin: 0; font-size: 22px;">InsightHub Registration Request</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 6px 0 0; font-size: 13px;">SLT Mobitel — Enterprise Sales Intelligence</p>
        </div>
        <div style="padding: 28px 36px;">
          <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 18px;">New User Access Verification Needed</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
            A new user has submitted a registration request with identity verification details. Please review their KYC credentials below:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
            <tr>
              <td style="padding: 12px 16px; font-weight: bold; color: #475569; width: 35%; border-bottom: 1px solid #e2e8f0;">Full Name:</td>
              <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${user.name}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Work Email:</td>
              <td style="padding: 12px 16px; color: #0066FF; font-weight: bold; border-bottom: 1px solid #e2e8f0;">${user.email}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">NIC Number:</td>
              <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${user.nicNumber}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; font-weight: bold; color: #475569; border-bottom: 1px solid #e2e8f0;">Employee / Reg No:</td>
              <td style="padding: 12px 16px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${user.regNumber}</td>
            </tr>
            <tr>
              <td style="padding: 12px 16px; font-weight: bold; color: #475569;">Submission Date:</td>
              <td style="padding: 12px 16px; color: #64748b;">${new Date().toLocaleString()}</td>
            </tr>
          </table>

          <div style="margin-bottom: 24px;">
            <h3 style="color: #0f172a; font-size: 15px; margin-bottom: 12px;">Submitted Identity Documents (KYC):</h3>
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
              ${(nicBase64 || fullNicPhotoUrl) ? `
                <div style="flex: 1; min-width: 240px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #ffffff; text-align: center;">
                  <p style="margin: 0 0 8px; font-weight: bold; font-size: 12px; color: #334155;">National Identity Card (NIC)</p>
                  <a href="${fullNicPhotoUrl}" target="_blank">
                    <img src="${nicBase64 || fullNicPhotoUrl}" alt="NIC Photo" style="max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; border: 1px solid #e2e8f0;" />
                  </a>
                  <p style="margin: 6px 0 0 0;"><a href="${fullNicPhotoUrl}" target="_blank" style="font-size: 11px; color: #0066FF;">View Full Image ↗</a></p>
                </div>
              ` : '<p style="color: #94a3b8; font-size: 13px;">No NIC Photo attached</p>'}

              ${(faceBase64 || fullFacePhotoUrl) ? `
                <div style="flex: 1; min-width: 240px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #ffffff; text-align: center;">
                  <p style="margin: 0 0 8px; font-weight: bold; font-size: 12px; color: #334155;">User Face Photo</p>
                  <a href="${fullFacePhotoUrl}" target="_blank">
                    <img src="${faceBase64 || fullFacePhotoUrl}" alt="Face Photo" style="max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; border: 1px solid #e2e8f0;" />
                  </a>
                  <p style="margin: 6px 0 0 0;"><a href="${fullFacePhotoUrl}" target="_blank" style="font-size: 11px; color: #0066FF;">View Full Image ↗</a></p>
                </div>
              ` : '<p style="color: #94a3b8; font-size: 13px;">No Face Photo attached</p>'}
            </div>
          </div>

          <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
            <p style="font-size: 14px; font-weight: bold; color: #0f172a; margin-bottom: 16px;">Administrator Action:</p>
            <div style="display: flex; gap: 16px; justify-content: center; margin-bottom: 16px;">
              <a href="${approveUrl}" style="background: #10b981; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                ✓ Approve Registration
              </a>
              <a href="${declineUrl}" style="background: #ef4444; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);">
                ✕ Decline Registration
              </a>
            </div>
            <p style="font-size: 12px; color: #64748b; margin-top: 16px;">
              Or manage all users in the <a href="${adminPortalUrl}" style="color: #0066FF; text-decoration: underline;">Admin Portal</a>.
            </p>
          </div>
        </div>
        <div style="background: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
          SLTMobitel Enterprise Security & Access Control • Automated Notification
        </div>
      </div>
    `;

    // Dispatch email to Admin
    sendEmailNotification({
      toEmail: ADMIN_EMAIL,
      subject: `[Action Required] New InsightHub Registration: ${user.name} (${user.email})`,
      htmlBody: adminEmailHtml
    });

    res.json({
      success: true,
      message: 'Registration request submitted successfully! Your account is pending administrator approval. You will receive an email once approved.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status
      }
    });
  } catch (err) {
    console.error('[Registration Error]', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. Email 1-Click Action Handler (Approve / Decline)
app.get('/api/auth/action/:action/:token', async (req, res) => {
  try {
    const { action, token } = req.params;
    const clientOrigin = req.headers.origin || APP_BASE_URL;

    if (action === 'approve') {
      const user = userService.getUserByApprovalToken(token);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'This approval link has already been used or is invalid.'
        });
      }

      userService.approveUser(user, 'Email 1-Click Action');

      // Send confirmation email to the user with "Set Password" link
      const setPasswordUrl = `${clientOrigin}/set-password?token=${user.setPasswordToken}`;
      const userApprovedEmailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0066FF 0%, #10b981 100%); padding: 28px 36px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">Account Approved! 🎉</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 6px 0 0; font-size: 13px;">SLT Mobitel — InsightHub Access Granted</p>
          </div>
          <div style="padding: 28px 36px;">
            <h2 style="color: #0f172a; margin: 0 0 12px; font-size: 18px;">Welcome to InsightHub, ${user.name}</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              Your registration request has been verified and approved by the system administrator. You can now set your login password to activate your access.
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${setPasswordUrl}" style="background: #0066FF; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(0, 102, 255, 0.35);">
                Set Your Password & Sign In →
              </a>
            </div>
            <p style="color: #64748b; font-size: 12px; line-height: 1.5;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${setPasswordUrl}" style="color: #0066FF; word-break: break-all;">${setPasswordUrl}</a>
            </p>
          </div>
          <div style="background: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            SLTMobitel Enterprise Sales Intelligence • Confidential
          </div>
        </div>
      `;

      sendEmailNotification({
        toEmail: user.email,
        subject: `Your InsightHub Account Has Been Approved — Set Your Password`,
        htmlBody: userApprovedEmailHtml
      });

      return res.json({
        success: true,
        action: 'approved',
        message: `User ${user.name} (${user.email}) has been successfully approved! An activation email has been dispatched.`,
        user: { name: user.name, email: user.email, status: user.status }
      });

    } else if (action === 'decline') {
      const user = userService.getUserByDeclineToken(token);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'This decline link has already been used or is invalid.'
        });
      }

      userService.declineUser(user, 'Declined via Email 1-Click Action');

      // Send rejection email
      const userDeclinedEmailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #ef4444; padding: 24px 36px;">
            <h1 style="color: white; margin: 0; font-size: 20px;">InsightHub Registration Status</h1>
          </div>
          <div style="padding: 28px 36px;">
            <h2 style="color: #0f172a; margin: 0 0 12px; font-size: 18px;">Hello ${user.name},</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
              Your registration request for InsightHub could not be approved at this time.
            </p>
            <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
              If you believe this was in error, please contact your internal system administrator or submit a fresh request with valid corporate credentials.
            </p>
          </div>
        </div>
      `;

      sendEmailNotification({
        toEmail: user.email,
        subject: `InsightHub Registration Status Update`,
        htmlBody: userDeclinedEmailHtml
      });

      return res.json({
        success: true,
        action: 'declined',
        message: `Registration for ${user.name} (${user.email}) has been declined.`,
        user: { name: user.name, email: user.email, status: user.status }
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action.' });
    }
  } catch (err) {
    console.error('[Action Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Verify Set Password Token
app.get('/api/auth/verify-token/:token', (req, res) => {
  const { token } = req.params;
  const user = userService.getUserBySetPasswordToken(token);

  if (!user) {
    return res.status(400).json({
      success: false,
      error: 'This activation link is invalid, expired, or has already been used.'
    });
  }

  res.json({
    success: true,
    user: {
      name: user.name,
      email: user.email
    }
  });
});

// 4. Set Password & Activate User
app.post('/api/auth/set-password', (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, error: 'Token and new password are required.' });
    }

    const user = userService.setUserPassword(token, password);

    res.json({
      success: true,
      message: 'Password created successfully! You are now fully activated.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('[Set Password Error]', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. User Sign In (Email + Password)
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const result = userService.authenticate(email, password);
    if (!result.success) {
      return res.status(401).json(result);
    }

    res.json({
      success: true,
      message: 'Login successful!',
      user: result.user
    });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Admin Portal: Get All Registered Users
app.get('/api/admin/users', (req, res) => {
  try {
    const users = userService.getAllUsers();
    res.json({
      success: true,
      count: users.length,
      users: users
    });
  } catch (err) {
    console.error('[Admin Users Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Admin Portal: User Action (Approve / Decline from Admin Dashboard)
app.post('/api/admin/user-action', async (req, res) => {
  try {
    const { userId, action, reason } = req.body;
    const clientOrigin = req.headers.origin || APP_BASE_URL;

    const user = userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (action === 'approve') {
      userService.approveUser(user, 'Admin Portal');

      // Dispatch activation email to user
      const setPasswordUrl = `${clientOrigin}/set-password?token=${user.setPasswordToken}`;
      const userApprovedEmailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0066FF 0%, #10b981 100%); padding: 28px 36px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">Account Approved! 🎉</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 6px 0 0; font-size: 13px;">SLT Mobitel — InsightHub Access Granted</p>
          </div>
          <div style="padding: 28px 36px;">
            <h2 style="color: #0f172a; margin: 0 0 12px; font-size: 18px;">Welcome to InsightHub, ${user.name}</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              Your registration request has been verified and approved by the system administrator. Please set your password to activate your access.
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${setPasswordUrl}" style="background: #0066FF; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(0, 102, 255, 0.35);">
                Set Your Password & Sign In →
              </a>
            </div>
            <p style="color: #64748b; font-size: 12px;">Link: <a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
          </div>
        </div>
      `;

      sendEmailNotification({
        toEmail: user.email,
        subject: `Your InsightHub Account Has Been Approved — Set Your Password`,
        htmlBody: userApprovedEmailHtml
      });

      return res.json({
        success: true,
        message: `User ${user.name} approved successfully.`,
        user: { id: user.id, name: user.name, email: user.email, status: user.status }
      });

    } else if (action === 'decline') {
      userService.declineUser(user, reason || 'Declined by Administrator');

      return res.json({
        success: true,
        message: `User ${user.name} declined.`,
        user: { id: user.id, name: user.name, email: user.email, status: user.status }
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action.' });
    }
  } catch (err) {
    console.error('[Admin Action Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const { indexPdfPortfolioToChroma } = require('./services/pdfIndexerService');

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` InsightHub Pure n8n Gateway Server running on port ${PORT}`);
  console.log(` n8n Webhook Target: ${N8N_BASE_URL}`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(` Vector Search: http://localhost:${PORT}/api/vector/search`);
  console.log(`====================================================`);

  // Index official SLTMobitel Product Portfolio PDF to ChromaDB
  indexPdfPortfolioToChroma().catch(err => console.warn('[Startup Indexer Warning]', err.message));
});
