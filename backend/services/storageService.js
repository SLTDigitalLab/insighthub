const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DATA_DIR = path.join(__dirname, '..', 'data');
const METADATA_FILE = path.join(DATA_DIR, 'documents.json');

// Ensure required directories exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([]), 'utf8');
}

const readMetadata = () => {
  try {
    const data = fs.readFileSync(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading metadata file:', err);
    return [];
  }
};

const writeMetadata = (documents) => {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(documents, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing metadata file:', err);
  }
};

module.exports = {
  UPLOADS_DIR,

  getAllDocuments: () => {
    return readMetadata();
  },

  getDocumentById: (id) => {
    const docs = readMetadata();
    return docs.find(doc => doc.id === id);
  },

  addDocument: (doc) => {
    const docs = readMetadata();
    docs.unshift(doc); // place latest at top
    writeMetadata(docs);
    return doc;
  },

  deleteDocument: (id) => {
    const docs = readMetadata();
    const target = docs.find(doc => doc.id === id);
    if (!target) return null;

    // Delete file from disk if it exists
    if (target.filePath && fs.existsSync(target.filePath)) {
      try {
        fs.unlinkSync(target.filePath);
      } catch (e) {
        console.error(`Error deleting file ${target.filePath}:`, e);
      }
    }

    const filtered = docs.filter(doc => doc.id !== id);
    writeMetadata(filtered);
    return target;
  }
};
