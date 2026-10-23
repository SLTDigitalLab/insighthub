const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROPOSALS_FILE = path.join(DATA_DIR, 'saved_proposals.json');
const TEMPLATE_META_FILE = path.join(DATA_DIR, 'template_meta.json');
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'proposal_template.docx');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(PROPOSALS_FILE)) {
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify([]), 'utf8');
}

if (!fs.existsSync(TEMPLATE_META_FILE)) {
  const initialMeta = {
    filename: 'proposal_template.docx',
    uploadedBy: 'System Default',
    updatedAt: new Date().toISOString(),
    sizeBytes: fs.existsSync(TEMPLATE_PATH) ? fs.statSync(TEMPLATE_PATH).size : 0,
    version: '1.0'
  };
  fs.writeFileSync(TEMPLATE_META_FILE, JSON.stringify(initialMeta, null, 2), 'utf8');
}

function readProposals() {
  try {
    return JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
  } catch (err) {
    console.error('[proposalStorage] Error reading saved proposals:', err.message);
    return [];
  }
}

function writeProposals(list) {
  try {
    fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[proposalStorage] Error writing saved proposals:', err.message);
  }
}

module.exports = {
  saveProposal: ({ refNo, companyName, business = {}, fields = {}, user = {}, products = [] }) => {
    const list = readProposals();
    const newProposal = {
      id: uuidv4(),
      refNo: refNo || fields.refNo || `SLT-${Math.floor(10000000 + Math.random() * 90000000)}`,
      companyName: companyName || fields.companyName || business.name || 'Untitled Enterprise Proposal',
      category: business.category || fields.category || 'Enterprise',
      address: business.address || fields.address || '',
      date: fields.proposalDate || new Date().toISOString(),
      generatedBy: user.email || 'dineshpi@slt.com.lk',
      generatorName: user.name || 'Account Manager',
      products: Array.isArray(products) ? products : (fields.products || []),
      fields: fields,
      createdAt: new Date().toISOString()
    };

    list.unshift(newProposal);
    writeProposals(list);
    return newProposal;
  },

  getAllProposals: () => {
    return readProposals();
  },

  getProposalById: (id) => {
    const list = readProposals();
    return list.find(p => p.id === id || p.refNo === id) || null;
  },

  deleteProposal: (id) => {
    const list = readProposals();
    const filtered = list.filter(p => p.id !== id && p.refNo !== id);
    writeProposals(filtered);
    return true;
  },

  saveLatestTemplate: (fileBuffer, originalName, adminEmail) => {
    // Replace current template directly with the latest template
    fs.writeFileSync(TEMPLATE_PATH, fileBuffer);

    const meta = {
      filename: originalName || 'proposal_template.docx',
      uploadedBy: adminEmail || 'Admin',
      updatedAt: new Date().toISOString(),
      sizeBytes: fileBuffer.length,
      version: `v${Date.now()}`
    };

    fs.writeFileSync(TEMPLATE_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  },

  getTemplateMeta: () => {
    try {
      if (fs.existsSync(TEMPLATE_META_FILE)) {
        return JSON.parse(fs.readFileSync(TEMPLATE_META_FILE, 'utf8'));
      }
    } catch (e) {}
    return {
      filename: 'proposal_template.docx',
      uploadedBy: 'System',
      updatedAt: new Date().toISOString(),
      sizeBytes: fs.existsSync(TEMPLATE_PATH) ? fs.statSync(TEMPLATE_PATH).size : 0
    };
  },

  TEMPLATE_PATH
};
