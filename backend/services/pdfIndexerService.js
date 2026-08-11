const fs = require('fs');
const path = require('path');
const { extractText } = require('./documentProcessor');
const chromaService = require('./chromaService');

const PDF_FILE_NAME = 'SLTMobitel Product & Solution Portfolio - Knowledge Base v1 (1).pdf';
const PDF_PATH = path.resolve(__dirname, '..', '..', PDF_FILE_NAME);

/**
 * Extracts and parses all 70 SLTMobitel products from the PDF knowledge base
 */
async function parsePdfProducts() {
  let targetPath = PDF_PATH;
  if (!fs.existsSync(targetPath)) {
    targetPath = path.resolve(__dirname, '..', PDF_FILE_NAME);
  }

  if (!fs.existsSync(targetPath)) {
    console.warn(`[PDF Indexer] PDF portfolio file not found at ${targetPath}`);
    return [];
  }

  console.log(`[PDF Indexer] Reading text from ${targetPath}...`);
  const rawText = await extractText(targetPath, 'application/pdf');
  
  if (!rawText || rawText.trim().length === 0) {
    console.warn(`[PDF Indexer] Could not extract text from PDF.`);
    return [];
  }

  // Split by "PRODUCT NAME:"
  const productBlocks = rawText.split(/PRODUCT NAME:\s*/i);
  const products = [];
  let currentPillar = 'General Solutions';

  for (let i = 0; i < productBlocks.length; i++) {
    const block = productBlocks[i].trim();
    if (!block) continue;

    // Check if block contains a PILLAR header
    const pillarMatch = block.match(/PILLAR:\s*([^\r\n]+)/i);
    if (pillarMatch) {
      currentPillar = pillarMatch[1].trim();
    }

    if (i === 0) continue; // First split is header before first product

    // Extract product name (first line)
    const lines = block.split(/\r?\n/);
    const productName = lines[0].trim();
    const bodyText = lines.slice(1).join('\n').trim();

    if (productName.length > 0 && bodyText.length > 0) {
      // Create clean search text chunk
      const fullChunkText = `SLT-MOBITEL ENTERPRISE PRODUCT\nPillar: ${currentPillar}\nProduct Name: ${productName}\n${bodyText}`;
      
      products.push({
        id: `sltmobitel_pdf_prod_${i}_${productName.replace(/[^a-zA-Z0-9]/g, '_')}`,
        productName: productName,
        pillar: currentPillar,
        text: fullChunkText,
        metadata: {
          fileName: PDF_FILE_NAME,
          source: 'Official SLTMobitel Portfolio PDF',
          pillar: currentPillar,
          product: productName
        }
      });
    }
  }

  console.log(`[PDF Indexer] Parsed ${products.length} SLTMobitel products from PDF.`);
  return products;
}

/**
 * Indexes PDF products into ChromaDB
 */
async function indexPdfPortfolioToChroma() {
  try {
    const products = await parsePdfProducts();
    if (!products || products.length === 0) return { indexed: 0, status: 'no_pdf_found' };

    const coll = await chromaService.getCollection();
    if (!coll) {
      console.warn(`[PDF Indexer Warning] ChromaDB not available. Storing PDF products locally.`);
      return { indexed: products.length, status: 'chroma_offline' };
    }

    // Upsert products in batches of 20
    const batchSize = 20;
    let indexedCount = 0;

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      await coll.upsert({
        ids: batch.map(p => p.id),
        documents: batch.map(p => p.text),
        metadatas: batch.map(p => p.metadata)
      });
      indexedCount += batch.length;
    }

    console.log(`[PDF Indexer] Successfully indexed ${indexedCount} official SLTMobitel PDF products into ChromaDB!`);
    return { indexed: indexedCount, status: 'indexed_chroma' };
  } catch (err) {
    console.error(`[PDF Indexer Error] ${err.message}`);
    return { indexed: 0, status: 'error', error: err.message };
  }
}

module.exports = {
  parsePdfProducts,
  indexPdfPortfolioToChroma
};
