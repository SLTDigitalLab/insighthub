const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

function parseKnowledgeBaseDocx(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }
  const buf = fs.readFileSync(docxPath);
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  const relsXml = zip.file('word/_rels/document.xml.rels')?.asText() || '';

  // Map rId -> target media path in zip
  const relsMap = {};
  const relMatches = relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g);
  for (const m of relMatches) {
    relsMap[m[1]] = m[2].startsWith('media/') ? `word/${m[2]}` : `word/${m[2].replace(/^\/?/, '')}`;
  }

  const paras = xml.match(/<w:p\b[^>]*>.*?<\/w:p>/gs) || [];
  const products = [];
  let currentProduct = null;
  let currentField = null;

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const text = (p.match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || [])
      .map(m => m.replace(/<[^>]+>/g, ''))
      .join('')
      .trim();

    if (text.startsWith('PRODUCT NAME:')) {
      const name = text.replace(/^PRODUCT NAME:\s*/i, '').trim();
      currentProduct = {
        name,
        description: '',
        proposalDescription: '',
        customerBenefits: [],
        termsAndConditions: '',
        diagramMedia: null
      };
      products.push(currentProduct);
      currentField = null;
      continue;
    }

    if (!currentProduct) continue;

    if (/^(Product Description|Business Description)$/i.test(text)) {
      currentField = 'description';
      continue;
    }
    if (/^Proposal Description$/i.test(text)) {
      currentField = 'proposalDescription';
      continue;
    }
    if (/^Customer Benefits$/i.test(text)) {
      currentField = 'customerBenefits';
      continue;
    }
    if (/^T&(?:amp;)?C$/i.test(text)) {
      currentField = 'termsAndConditions';
      continue;
    }
    if (/^Diagram$/i.test(text)) {
      currentField = 'diagram';
      // Look for drawing in this or next paragraph
      const embedMatch = p.match(/r:embed="([^"]+)"/);
      if (embedMatch && relsMap[embedMatch[1]]) {
        currentProduct.diagramMedia = relsMap[embedMatch[1]];
      }
      continue;
    }

    if (currentField === 'diagram') {
      const embedMatch = p.match(/r:embed="([^"]+)"/);
      if (embedMatch && relsMap[embedMatch[1]]) {
        currentProduct.diagramMedia = relsMap[embedMatch[1]];
      }
    } else if (currentField === 'description') {
      if (text) currentProduct.description = (currentProduct.description ? currentProduct.description + ' ' : '') + text;
    } else if (currentField === 'proposalDescription') {
      if (text) currentProduct.proposalDescription = (currentProduct.proposalDescription ? currentProduct.proposalDescription + ' ' : '') + text;
    } else if (currentField === 'customerBenefits') {
      if (text) {
        // Customer benefits may be semi-colon separated or bullet points
        const items = text.split(/;|\u2022|\n/).map(s => s.trim().replace(/^•\s*/, '')).filter(Boolean);
        currentProduct.customerBenefits.push(...items);
      }
    } else if (currentField === 'termsAndConditions') {
      if (text) currentProduct.termsAndConditions = (currentProduct.termsAndConditions ? currentProduct.termsAndConditions + ' ' : '') + text;
    }
  }

  return { products, zip };
}

if (require.main === module) {
  const filePath = path.join(__dirname, '..', 'uploads', '1792938500505-691236016-SLT_Mobitel_Solutions_Portfolio_Knowledge_Base_Proposal_v2__1_.docx');
  const { products } = parseKnowledgeBaseDocx(filePath);
  console.log(`Parsed ${products.length} products.`);
  console.log('Sample 1:', JSON.stringify(products[0], null, 2));
  console.log('Sample 2:', JSON.stringify(products[1], null, 2));
}

module.exports = { parseKnowledgeBaseDocx };
