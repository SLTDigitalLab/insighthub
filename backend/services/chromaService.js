const fs = require('fs');
const path = require('path');
const { ChromaClient } = require('chromadb');

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'mobitel-knowledge-base';

let client = null;
let collection = null;

const DEFAULT_MOBITEL_CATALOG = [
  {
    id: 'mobitel_prod_01',
    text: 'Mobitel Managed Wi-Fi & Guest Internet: Enterprise managed Wi-Fi with high-density access points, captive portal customization, guest authentication, bandwidth controls, and separate staff/guest SSIDs. Designed for hospitality (hotels, resorts, guest houses), retail centers, and educational institutes. Provides high-speed reliable wireless coverage across large premises.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Managed Services', product: 'Managed Wi-Fi' }
  },
  {
    id: 'mobitel_prod_02',
    text: 'Mobitel SD-WAN Solutions: Software-Defined Wide Area Network for enterprise multi-branch connectivity. Intelligently routes traffic over MPLS, LTE, 5G, and broadband links. Reduces WAN connectivity costs by up to 40%, improves cloud app performance, and provides centralized network orchestration for multi-branch banks, chain hotels, and retail outlets.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Enterprise Connectivity', product: 'SD-WAN Solutions' }
  },
  {
    id: 'mobitel_prod_03',
    text: 'Mobitel Managed Firewall & 24/7 SOC: Enterprise cybersecurity suite offering Next-Generation Managed Firewall (NGFW), intrusion prevention system (IPS), malware scanning, and 24/7 Security Operations Center (SOC) threat monitoring. Protects sensitive financial, guest, and corporate data against cyber threats and compliance breaches.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Cybersecurity', product: 'Managed Firewall + SOC' }
  },
  {
    id: 'mobitel_prod_04',
    text: 'Mobitel Hosted PBX & UCaaS: Cloud-based virtual PABX phone system replacing legacy hardware PBX. Includes omni-channel voice, video conferencing, team chat, auto-attendant, IVR, extension dialing across branches, and mobile app integration for staff and guest service desks.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Unified Communications', product: 'Hosted PBX / UCaaS' }
  },
  {
    id: 'mobitel_prod_05',
    text: 'Mobitel Business SMS Gateway & Bulk Messaging API: High-throughput HTTP/REST API for automated transactional and promotional SMS notifications. Enables guest reservation confirmations, OTP authentication, marketing campaigns, and payment alerts.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Unified Communications', product: 'Business SMS Gateway' }
  },
  {
    id: 'mobitel_prod_06',
    text: 'Mobitel Disaster Recovery as a Service (DRaaS) & Cloud Backup: Enterprise cloud hosting and continuous data replication hosted locally in Mobitel Sri Lanka Tier-III Data Center. Guarantees business continuity, zero data loss RPO, and rapid recovery RTO for financial institutions and critical hospitality enterprise databases.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Cloud & Data Center', product: 'Disaster Recovery as a Service (DRaaS)' }
  },
  {
    id: 'mobitel_prod_07',
    text: 'Mobitel Hospitality Connect Bundle: Specialized bundle combining Managed Wi-Fi + Hosted PBX + Business SMS Gateway + Cybersecurity Suite. Specifically tailored for hotels, boutique resorts, and heritage properties (such as Queens Hotel Kandy, Earl\'s Regency, Cinnamon Hotels). Delivers complete digital hospitality infrastructure with seamless guest Wi-Fi and inter-department voice communication at a 20% bundled discount.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Strategic Bundle', product: 'Bundle: Hospitality Connect Pack' }
  },
  {
    id: 'mobitel_prod_08',
    text: 'Mobitel Digital Banking Infrastructure Pack: Comprehensive enterprise bundle combining SD-WAN + Managed Firewall & 24/7 SOC + DRaaS + Contact Center (CCaaS). Engineered for commercial banks, finance companies, and insurance firms needing ultra-secure branch connectivity and regulatory compliance at 25% discount.',
    metadata: { fileName: 'Mobitel_B2B_Catalog.pdf', category: 'Strategic Bundle', product: 'Bundle: Digital Banking Infrastructure Pack' }
  }
];

const LOCAL_STORE_FILE = path.join(__dirname, '..', 'data', 'vector_store.json');

// Helper to save and load local vector store
function loadLocalStore() {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[Local Store Load Warning]', err.message);
  }
  return [];
}

function saveLocalStore(items) {
  try {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Local Store Save Warning]', err.message);
  }
}

let localStore = loadLocalStore();
if (localStore.length === 0) {
  localStore = DEFAULT_MOBITEL_CATALOG.map(item => ({
    id: item.id,
    text: item.text,
    metadata: item.metadata
  }));
  saveLocalStore(localStore);
}

class LocalFastEmbeddingFunction {
  async generate(texts) {
    return texts.map(text => {
      const vec = new Array(384).fill(0);
      const clean = (text || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const words = clean.split(/\s+/).filter(Boolean);
      words.forEach(w => {
        let hash = 0;
        for (let i = 0; i < w.length; i++) {
          hash = (hash * 31 + w.charCodeAt(i)) & 0x7fffffff;
        }
        vec[hash % 384] += 1;
      });
      const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
      return vec.map(val => val / magnitude);
    });
  }
}

const embeddingFunction = new LocalFastEmbeddingFunction();

async function getCollection() {
  if (collection) return collection;

  try {
    client = new ChromaClient({ path: CHROMA_URL });
    collection = await client.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: { "description": "InsightHub Knowledge Base Collection" },
      embeddingFunction: embeddingFunction
    });
    console.log(`[ChromaDB] Connected to collection '${COLLECTION_NAME}' at ${CHROMA_URL}`);
    
    // Seed Mobitel B2B catalog if collection is empty
    await seedMobitelCatalog(collection);
    
    return collection;
  } catch (err) {
    return null;
  }
}

/**
 * Seeds default Mobitel catalog items into ChromaDB if empty
 */
async function seedMobitelCatalog(coll) {
  try {
    const count = await coll.count();
    if (count === 0) {
      console.log(`[ChromaDB] Collection is empty. Seeding default Mobitel B2B product catalog...`);
      await coll.upsert({
        ids: DEFAULT_MOBITEL_CATALOG.map(item => item.id),
        documents: DEFAULT_MOBITEL_CATALOG.map(item => item.text),
        metadatas: DEFAULT_MOBITEL_CATALOG.map(item => item.metadata)
      });
      console.log(`[ChromaDB] Successfully seeded ${DEFAULT_MOBITEL_CATALOG.length} Mobitel products into ChromaDB!`);
    }
  } catch (err) {
    console.warn(`[ChromaDB Seed Warning] ${err.message}`);
  }
}

/**
 * Indexes document chunks into ChromaDB & Local Vector Store
 */
async function indexChunks(docId, fileName, chunks) {
  if (!chunks || chunks.length === 0) return { indexed: 0, status: 'empty' };

  const ids = chunks.map((_, i) => `${docId}_chunk_${i}`);
  const metadatas = chunks.map((_, i) => ({
    docId: docId,
    fileName: fileName,
    chunkIndex: i,
    totalChunks: chunks.length,
    timestamp: new Date().toISOString()
  }));

  // 1. Index into local JSON store
  chunks.forEach((chunkText, i) => {
    localStore.push({
      id: ids[i],
      text: chunkText,
      metadata: metadatas[i]
    });
  });
  saveLocalStore(localStore);
  console.log(`[Local Vector Store] Indexed ${chunks.length} chunks for "${fileName}" (total entries: ${localStore.length})`);

  // 2. Index into ChromaDB if available
  const coll = await getCollection();
  if (coll) {
    try {
      await coll.upsert({
        ids: ids,
        documents: chunks,
        metadatas: metadatas
      });
      console.log(`[ChromaDB] Successfully indexed ${chunks.length} chunks for ${fileName}`);
      return { indexed: chunks.length, status: 'indexed_chroma' };
    } catch (err) {
      console.error(`[ChromaDB Error] Indexing failed: ${err.message}`);
      return { indexed: chunks.length, status: 'indexed_local_only', error: err.message };
    }
  }

  return { indexed: chunks.length, status: 'indexed_local_vector_store' };
}

/**
 * Calculates cosine similarity between two normalized vectors
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

/**
 * Queries ChromaDB vector store or local vector cosine similarity index
 */
async function queryVectorStore(queryText, nResults = 5) {
  // 1. Try ChromaDB first
  const coll = await getCollection();
  if (coll) {
    try {
      const results = await coll.query({
        queryTexts: [queryText],
        nResults: nResults
      });
      if (results && results.documents && results.documents[0] && results.documents[0].length > 0) {
        return results;
      }
    } catch (chromaErr) {
      console.warn(`[ChromaDB Query Warning] ${chromaErr.message}. Using local vector fallback.`);
    }
  }

  // 2. Robust Local Vector Cosine Similarity Search Fallback
  if (localStore.length === 0) {
    return { documents: [[]], metadatas: [[]], distances: [[]] };
  }

  const queryEmbeddings = await embeddingFunction.generate([queryText]);
  const queryVec = queryEmbeddings[0];

  const docEmbeddings = await embeddingFunction.generate(localStore.map(item => item.text));

  const scored = localStore.map((item, index) => ({
    item: item,
    score: cosineSimilarity(queryVec, docEmbeddings[index])
  }));

  // Sort by highest cosine similarity
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, nResults);

  return {
    documents: [topMatches.map(m => m.item.text)],
    metadatas: [topMatches.map(m => m.item.metadata || {})],
    distances: [topMatches.map(m => 1 - m.score)]
  };
}

/**
 * Deletes document chunks from ChromaDB & Local Vector Store
 */
async function deleteDocVectors(docId) {
  localStore = localStore.filter(item => item.metadata && item.metadata.docId !== docId);
  saveLocalStore(localStore);

  const coll = await getCollection();
  if (coll) {
    try {
      await coll.delete({
        where: { "docId": docId }
      });
      console.log(`[ChromaDB] Deleted vector entries for docId: ${docId}`);
    } catch (err) {
      console.error(`[ChromaDB Error] Delete failed for docId ${docId}:`, err.message);
    }
  }
}

module.exports = {
  getCollection,
  indexChunks,
  queryVectorStore,
  deleteDocVectors
};

