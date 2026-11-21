const fs = require('fs');
const path = require('path');
const { diagrams } = require('../proposal/renderSettings');
const { imageInfo, toPng } = require('./logoService');
const { PRODUCT_BY_ID } = require('./productCatalog');

// Product network diagrams that the rep uploads.
//   per proposal   fields.diagramOverrides[productId] = a PNG / JPEG data URL (set from the editor, saved with the proposal)
//   per product    DATA_DIR/product_diagrams/<productId>.png|.jpg  (the "use as default for this product" choice)
// The diagram of a product in a proposal = its override, else its stored default, else the shared catalogue diagram
// (products.json -> templates/diagrams, handled in ooxml.js). Anything that is not PNG / JPEG is converted to PNG with sharp.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIR = path.join(DATA_DIR, diagrams.dirName);
fs.mkdirSync(DIR, { recursive: true });

const fail = (status, message) => Object.assign(new Error(message), { status });
const mbText = `${Math.round(diagrams.maxUploadBytes / (1024 * 1024))} MB`;

function parseDataUrl(value) {
  const v = String(value || '');
  const comma = v.indexOf(',');
  if (!v.startsWith('data:') || comma < 0 || !/;base64$/i.test(v.slice(0, comma))) throw fail(400, 'The file could not be read as an image.');
  return { mime: v.slice(5, comma).split(';')[0], buf: Buffer.from(v.slice(comma + 1), 'base64') };
}

// buf -> { buf, ext: 'png' | 'jpeg', w, h, converted? }; throws a 4xx with a message fit for the card
async function normalize(buf, mime) {
  if (!buf.length) throw fail(400, 'The file is empty.');
  if (buf.length > diagrams.maxUploadBytes) throw fail(413, `The file is larger than ${mbText}.`);
  let info = imageInfo(buf);
  if (info) return { buf, ...info };
  try {
    const png = await toPng(buf, mime);
    info = imageInfo(png);
    if (info) return { buf: png, ...info, converted: true };
  } catch { /* not an image sharp can read */ }
  throw fail(400, 'This file is not an image. Use a PNG, JPG, SVG or WebP file.');
}

const known = productId => {
  if (!PRODUCT_BY_ID[productId]) throw fail(400, 'Unknown product.');
  return path.basename(String(productId));
};

const defaultFile = productId => {
  const id = path.basename(String(productId || ''));
  return ['png', 'jpg'].map(ext => path.join(DIR, `${id}.${ext}`)).find(f => fs.existsSync(f)) || null;
};

// The rep's upload (a data URL): checked, converted if needed, optionally kept as the product's default. Returns what the
// editor stores for this proposal.
async function processUpload({ productId, image, setDefault }) {
  const id = known(productId);
  const { mime, buf } = parseDataUrl(image);
  const norm = await normalize(buf, mime);
  if (setDefault) {
    ['png', 'jpg'].forEach(ext => { try { fs.unlinkSync(path.join(DIR, `${id}.${ext}`)); } catch { /* none */ } });
    fs.writeFileSync(path.join(DIR, `${id}.${norm.ext === 'jpeg' ? 'jpg' : 'png'}`), norm.buf);
  }
  const mimeOut = norm.ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return { image: `data:${mimeOut};base64,${norm.buf.toString('base64')}`, width: norm.w, height: norm.h, converted: !!norm.converted, savedAsDefault: !!setDefault };
}

// product id -> { buf, ext, w, h } for the products of this proposal that have an override or a stored default
async function resolveForRender(fields) {
  const out = {};
  const rows = Array.isArray(fields.requirements) ? fields.requirements : [];
  const overrides = fields.diagramOverrides && typeof fields.diagramOverrides === 'object' ? fields.diagramOverrides : {};
  for (const id of new Set(rows.map(r => r && r.id).filter(Boolean))) {
    let norm = null;
    if (typeof overrides[id] === 'string' && overrides[id]) {
      try { const { mime, buf } = parseDataUrl(overrides[id]); norm = await normalize(buf, mime); } catch (e) { console.warn(`[diagram] override of ${id} ignored: ${e.message}`); }
    }
    if (!norm) {
      const file = defaultFile(id);
      if (file) { const buf = fs.readFileSync(file); const info = imageInfo(buf); if (info) norm = { buf, ...info }; }
    }
    if (norm) out[id] = norm;
  }
  return out;
}

module.exports = { processUpload, resolveForRender, defaultFile };
