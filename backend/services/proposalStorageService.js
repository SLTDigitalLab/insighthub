const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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

const { execFile } = require('child_process');
const os = require('os');

const WORD_COM_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'convert_doc_word.ps1');

function convertDocWithWordCom(docBuffer) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32' || !fs.existsSync(WORD_COM_SCRIPT)) {
      return reject(new Error('Native Microsoft Word COM script unavailable'));
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-word-conv-'));
    const tempDoc = path.join(tempDir, 'input.doc');
    const tempDocx = path.join(tempDir, 'output.docx');
    fs.writeFileSync(tempDoc, docBuffer);

    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', WORD_COM_SCRIPT, tempDoc, tempDocx], { timeout: 60000 }, (err) => {
      try {
        if (err) throw err;
        if (!fs.existsSync(tempDocx)) {
          throw new Error('Converted .docx was not created by Microsoft Word COM.');
        }
        const docxBuffer = fs.readFileSync(tempDocx);
        resolve(docxBuffer);
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
}

/**
 * Converts legacy .doc to .docx without layout corruption.
 * If native Microsoft Word COM is available, it uses Word's native engine (100% fidelity).
 * Otherwise, it avoids running lossy LibreOffice conversion and instructs the user to upload .docx directly.
 */
async function convertDocToDocx(docBuffer) {
  // 1. Try native Microsoft Word COM automation first (preserves 100% of formatting, tables, fonts, and DrawingML)
  try {
    const wordBuffer = await convertDocWithWordCom(docBuffer);
    console.log('[proposalStorage] Converted .doc to .docx using native Microsoft Word COM (100% layout and formatting preserved).');
    return { buffer: wordBuffer, method: 'msword_native_com' };
  } catch (wordErr) {
    console.warn('[proposalStorage] Native Microsoft Word COM conversion unavailable:', wordErr.message);
  }

  // 2. Avoid lossy headless LibreOffice conversion which destroys tables, margins, and styles.
  throw new Error(
    'Automated server conversion of legacy .doc files alters formatting and tables. ' +
    'To avoid any layout distortion, please open your file in Microsoft Word, click "File > Save As > Word Document (.docx)", ' +
    'and upload the .docx file directly. Native .docx templates maintain 100% exact formatting with zero layout changes.'
  );
}

function safelyWriteTemplate(filePath, buffer) {
  // Try direct write first
  try {
    fs.writeFileSync(filePath, buffer);
    return;
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') {
      throw err;
    }
  }

  // If locked by Word or another process, write to temp and attempt retry
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.docx`);
  fs.writeFileSync(tempPath, buffer);

  let replaced = false;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (unErr) {}

      fs.copyFileSync(tempPath, filePath);
      replaced = true;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      } else {
        break;
      }
    }
  }

  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch (e) {}

  if (!replaced) {
    throw new Error(
      'The proposal template file (proposal_template.docx) is currently open or locked by Microsoft Word on your computer. ' +
      'Please save and close Microsoft Word, then click "Set as Latest Template" again.'
    );
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

  saveLatestTemplate: async (fileBuffer, originalName, adminEmail) => {
    const isDocx = /\.docx$/i.test(originalName);
    if (!isDocx) {
      throw new Error('Converting legacy .doc files causes formatting errors. Please save your file as .docx in Microsoft Word and upload the .docx file directly.');
    }

    // Inspect tags in read-only mode without mutating the document
    let tagsCount = 0;
    let warnings = [];
    try {
      const PizZip = require('pizzip');
      const zip = new PizZip(fileBuffer);
      const docXml = zip.file('word/document.xml')?.asText() || '';
      const tags = [...new Set(docXml.match(/\{[a-zA-Z0-9_@#\/]+\}/g) || [])];
      tagsCount = tags.length;
      if (!docXml.includes('{companyName}')) {
        warnings.push('Template does not appear to contain the "{companyName}" placeholder.');
      }
    } catch (e) {
      console.warn('[proposalStorage] Could not inspect tags:', e.message);
    }

    // Save the uploaded .docx buffer directly to TEMPLATE_PATH - 100% exact layout preservation!
    safelyWriteTemplate(TEMPLATE_PATH, fileBuffer);
    console.log(`[proposalStorage] Latest template (.docx) saved directly without modification (${fileBuffer.length} bytes, ${tagsCount} tags detected)`);

    const meta = {
      filename: originalName || 'proposal_template.docx',
      savedFormat: 'docx',
      uploadedFormat: 'docx',
      convertedFromDoc: false,
      uploadedBy: adminEmail || 'Admin',
      updatedAt: new Date().toISOString(),
      sizeBytes: fileBuffer.length,
      originalSizeBytes: fileBuffer.length,
      tagsCount,
      warnings,
      version: `v${Date.now()}`
    };

    fs.writeFileSync(TEMPLATE_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  },

  resetToDefaultTemplate: () => {
    const DEFAULT_TEMPLATE = path.join(__dirname, '..', 'templates', 'default_proposal_template.docx');
    if (!fs.existsSync(DEFAULT_TEMPLATE)) {
      throw new Error('Default system template backup not found');
    }
    const defaultBuffer = fs.readFileSync(DEFAULT_TEMPLATE);
    safelyWriteTemplate(TEMPLATE_PATH, defaultBuffer);
    const meta = {
      filename: 'default_proposal_template.docx',
      savedFormat: 'docx',
      uploadedFormat: 'docx',
      convertedFromDoc: false,
      uploadedBy: 'System (Restored Default)',
      updatedAt: new Date().toISOString(),
      sizeBytes: fs.statSync(TEMPLATE_PATH).size,
      version: '1.0'
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
