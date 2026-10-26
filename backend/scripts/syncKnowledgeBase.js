const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unescapeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractKbData() {
  const docxPath = path.join(__dirname, '..', 'uploads', '1792938500505-691236016-SLT_Mobitel_Solutions_Portfolio_Knowledge_Base_Proposal_v2__1_.docx');
  const diagramsDir = path.join(__dirname, '..', 'templates', 'diagrams');
  if (!fs.existsSync(diagramsDir)) {
    fs.mkdirSync(diagramsDir, { recursive: true });
  }

  const buf = fs.readFileSync(docxPath);
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  const relsXml = zip.file('word/_rels/document.xml.rels')?.asText() || '';

  // Map rId -> target media path in zip
  const relsMap = {};
  for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relsMap[m[1]] = m[2].startsWith('media/') ? `word/${m[2]}` : `word/${m[2].replace(/^\/?/, '')}`;
  }

  const paras = xml.match(/<w:p\b[^>]*>.*?<\/w:p>/gs) || [];
  const products = [];
  let currentProduct = null;
  let currentField = null;
  let currentPillar = 'General';

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const text = unescapeHtml(
      (p.match(/<w:t\b[^>]*>(.*?)<\/w:t>/g) || [])
        .map(m => m.replace(/<[^>]+>/g, ''))
        .join('')
        .trim()
    );

    if (text.startsWith('PILLAR:')) {
      currentPillar = text.replace(/^PILLAR:\s*\d*\.?\s*/i, '').trim();
      continue;
    }

    if (text.startsWith('PRODUCT NAME:')) {
      const name = text.replace(/^PRODUCT NAME:\s*/i, '').trim();
      const id = slugify(name);
      currentProduct = {
        id,
        name,
        pillar: currentPillar,
        description: '',
        proposalDescription: '',
        customerBenefits: [],
        termsAndConditions: '',
        diagramMedia: null,
        diagramFileName: `${id}.png`
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
        const items = text
          .split(/;|\u2022|\n/)
          .map(s => s.trim().replace(/^[•\-\*]\s*/, ''))
          .filter(Boolean);
        currentProduct.customerBenefits.push(...items);
      }
    } else if (currentField === 'termsAndConditions') {
      if (text) currentProduct.termsAndConditions = (currentProduct.termsAndConditions ? currentProduct.termsAndConditions + ' ' : '') + text;
    }
  }

  // Extract all diagram images into backend/templates/diagrams/<id>.png
  let extractedCount = 0;
  for (const prod of products) {
    if (prod.diagramMedia && zip.file(prod.diagramMedia)) {
      const imgBuffer = zip.file(prod.diagramMedia).asNodeBuffer();
      const destPath = path.join(diagramsDir, `${prod.id}.png`);
      fs.writeFileSync(destPath, imgBuffer);
      extractedCount++;
    }
  }

  console.log(`Extracted ${extractedCount} diagrams to ${diagramsDir}`);

  // Load existing products.json to preserve technical service/accessMedia/ntu specs if available
  const existingPath = path.join(__dirname, '..', 'data', 'products.json');
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  } catch (e) {}

  const existingMap = {};
  for (const p of existing) {
    existingMap[p.id] = p;
    existingMap[slugify(p.name)] = p;
  }

  // Merge full knowledge base
  const finalProducts = products.map(kbProd => {
    const prev = existingMap[kbProd.id] || {};
    return {
      id: kbProd.id,
      name: kbProd.name,
      pillar: kbProd.pillar || prev.pillar || 'Enterprise Solutions',
      description: kbProd.description || prev.description || '',
      proposalDescription: kbProd.proposalDescription || kbProd.description || prev.description || '',
      customerBenefits: kbProd.customerBenefits.length ? kbProd.customerBenefits : (prev.features || []),
      features: prev.features || kbProd.customerBenefits,
      termsAndConditions: kbProd.termsAndConditions || 'Subject to technical feasibility and standard SLT-Mobitel enterprise terms and conditions.',
      diagram: `${kbProd.id}.png`,
      service: prev.service || kbProd.name,
      accessMedia: prev.accessMedia || 'Fibre / Dedicated',
      ntu: prev.ntu || 'Standard NTU / Router'
    };
  });

  fs.writeFileSync(existingPath, JSON.stringify(finalProducts, null, 2), 'utf8');
  console.log(`Saved ${finalProducts.length} enriched products to ${existingPath}`);
  return finalProducts;
}

if (require.main === module) {
  extractKbData();
}

module.exports = { extractKbData };
