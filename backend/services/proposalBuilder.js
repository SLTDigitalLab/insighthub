const fs = require('fs');
// Reads the template, product catalogue and diagram images from disk
const path = require('path');
// Builds file paths that work on Windows and Linux
const PizZip = require('pizzip');
// Opens the .docx (a zip of XML files) so we can add diagram images into it
const Docxtemplater = require('docxtemplater');
// Replaces {placeholders} in the template and repeats table rows
const os = require('os');
// Gives a temp folder for the Word -> PDF conversion
const { execFile } = require('child_process');
// Runs LibreOffice to convert the .docx to PDF
const pdfParse = require('pdf-parse');
// Reads the rendered PDF's page text to find which page each Contents heading landed on
const axios = require('axios');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'proposal_template.docx');
// SLT proposal template (built by scripts/make_template.py + fix_template_layout.py) with every variable part as a {placeholder}
const DIAGRAM_DIR = path.join(__dirname, '..', 'templates', 'diagrams');
// Network diagrams: one PNG per product id (e.g. bil.png). A product without one shows its requirement text only.
const PRODUCTS = require('../data/products.json');
// 70 products parsed from "SLTMobitel Product & Solution Portfolio - Knowledge Base v1.1" (the same PDF that is in the vector DB)
const ID_ALIASES = {
  'bil': 'bil-business-internet-line',
  'ssl-vpn': 'ssl-vpn-remote-vpn',
  'apn': 'apn-access-point-name',
  'edl': 'edl-ethernet-dedicated-line',
  'sd-wan': 'sd-wan-software-defined-wide-area-network',
  'mdr': 'mdr-managed-detection-and-response',
  'cloud-pos': 'cloud-pos-point-of-sale',
  'enterprise-premium-cloud': 'enterprise-premium-cloud-vmware',
  'surveillance-security-solutions': 'surveillance-and-security-solutions',
  'integrated-internet-service': 'broadband-internet',
};
const PRODUCT_BY_ID = Object.fromEntries([
  ...PRODUCTS.map(p => [p.id, p]),
  ...Object.entries(ID_ALIASES).map(([alias, targetId]) => {
    const target = PRODUCTS.find(p => p.id === targetId);
    return target ? [alias, target] : null;
  }).filter(Boolean)
]);
// Quick lookup: PRODUCT_BY_ID['bil'] -> the BIL product (supporting canonical IDs and short aliases)

const SOLUTION_SUMMARY = 'After careful study on your requirement, we have designed following solutions for your requirements. Total solution includes following components.';
// The template's own intro sentence above the Proposed Solution table
const ACK_DEFAULTS = { ackAddressee1: 'Regional Enterprise Business Manager', ackAddressee2: 'Sri Lanka Telecom PLC' };
// The template's own addressee lines on the Customer Acknowledgements page
const ACK_DOTS = `${'…'.repeat(25)}.`;
// The template's dotted line ("……….") printed when a Customer Acknowledgements line is left empty
const ACK_KEYS = ['ackCompanyName', 'ackAddress', 'ackSolution', 'ackInitialCharge', 'ackMonthlyCharge', 'ackCommitment'];
// The 6 Customer Acknowledgements lines the customer fills in (Company Name, Address, Solution, Initial Charge, Monthly Charge, Commitment Period)
const LETTER_WORD_LIMITS =[null, 25, 20, 16, 12, 9];
// Letter shortening steps tried after a render if the letter spills off page 3: level 0 = as written,
// then every paragraph cut to 1 sentence of at most N words (no product paragraph is ever left out)
const CELL_MAX_CHARS = { station: 30, accessMedia: 30, ntu: 60 };
// Proposed Solution cells longer than this would wrap past 2 lines in their column
const CONTENT_WIDTH_EMU = 9666 * 635;
// Text width of the body pages (page 11906 twips - 620 left / 900 right margin - 360 + 360 indent), in EMU
const ABOUT_HEADING = 'ABOUT YOU AND HOW WE CAN HELP YOU';
// Heading of the page between YOUR REQUIREMENTS and PROPOSED SOLUTION (as in the template)
const TOC_HEADINGS = ['COMPANY OVERVIEW', 'OUR STRENGTHS', 'WHY WITH US', 'YOUR REQUIREMENTS', ABOUT_HEADING, 'PROPOSED SOLUTION', 'NETWORK ARCHITECTURE', 'SOLUTION DIAGRAM', 'YOUR INVESTMENT', 'TERMS AND CONDITIONS', 'CUSTOMER ACKNOWLEDGEMENTS', 'SME SOLUTIONS', 'AWARDS AND ACCOLADES', 'CONTACT US'];
// Page heading for each Contents line {toc0}..{toc13}, in the template's order
const TOC_TEMPLATE_PAGES = [3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16];
const ABOUT_LIMITS = [null, { sentences: 3, descWords: 90, reasonWords: 16, max: 5 }, { sentences: 2, descWords: 60, reasonWords: 12, max: 5 }, { sentences: 2, descWords: 50, reasonWords: 10, max: 4 }, { sentences: 2, descWords: 40, reasonWords: 8, max: 3 }];
// "About you" shortening steps tried after a render if the section spills past one page: level 0 = as written,
// then fewer sentences / shorter reasons, and only in the last two steps fewer products (never below 3)
const MAX_RECOMMENDATIONS = 5;
const MIN_RECOMMENDATIONS = 3;
// The template's printed numbers, used only if the PDF can't be rendered to measure the real ones

const SUGGESTIONS = [
  { match: /hotel|resort|villa|guest ?house|inn|lodge|hostel|bungalow/i, ids: ['bil-business-internet-line', 'managed-wifi-solutions', 'enterprise-tv', 'managed-firewall', 'surveillance-and-security-solutions', 'univo'] },
  { match: /bank|finance|insurance|leasing|credit|microfinance/i, ids: ['premium-vpn', 'sd-wan-software-defined-wide-area-network', 'managed-firewall', 'mdr-managed-detection-and-response', 'ddos-protection-service', 'backup-services'] },
  { match: /hospital|clinic|medical|pharmacy|health|channel/i, ids: ['broadband-internet', 'enterprise-wifi', 'enterprise-premium-cloud-vmware', 'backup-services', 'queue-management-system', 'surveillance-and-security-solutions'] },
  { match: /school|college|university|institute|academy|tuition|campus|education/i, ids: ['data-one', 'enterprise-wifi', 'slt-esiphala', 'akaza-lms', 'google-workspace', 'surveillance-and-security-solutions'] },
  { match: /restaurant|cafe|café|bakery|food|bar|pub/i, ids: ['data-one', 'cloud-pos-point-of-sale', 'managed-wifi-solutions', 'surveillance-and-security-solutions', 'peotv-biz'] },
  { match: /shop|store|supermarket|retail|mall|boutique|pharma|hardware/i, ids: ['data-one', 'cloud-pos-point-of-sale', 'ssl-vpn-remote-vpn', 'apn-access-point-name', 'surveillance-and-security-solutions'] },
  { match: /factory|manufactur|industr|logistic|transport|warehouse|garment|apparel/i, ids: ['sd-wan-software-defined-wide-area-network', 'broadband-internet', 'fleet-management-service', 'akaza-erp', 'surveillance-and-security-solutions'] },
  { match: /software|it |technology|tech|digital|agency|consult|office|company|corporate/i, ids: ['bil-business-internet-line', 'enet', 'managed-firewall', 'microsoft-365-enterprise', 'univo', 'enterprise-premium-cloud-vmware'] },
];
// Google Maps category -> products to highlight as "Suggested" (the rep can still pick anything)
const DEFAULT_SUGGESTIONS = ['bil-business-internet-line', 'data-one', 'managed-firewall', 'univo', 'microsoft-365-enterprise'];
// Used when the category doesn't match any rule above

const SECTORS = [
  { match: SUGGESTIONS[0].match, words: /hotel|resort|guest|hospitality/i, sentence: 'Hospitality businesses typically depend on reliable connectivity for guests and staff, smooth bookings and payments, and well-managed on-site systems.' },
  { match: SUGGESTIONS[1].match, words: /bank|financ|branch|transaction/i, sentence: 'Financial services organisations typically need secure, always-available links between branches, strong cyber security and dependable data protection.' },
  { match: SUGGESTIONS[2].match, words: /hospital|health|patient|clinic|medical/i, sentence: 'Healthcare providers typically rely on dependable connectivity, secure access to their systems and well-protected data across their facilities.' },
  { match: SUGGESTIONS[3].match, words: /school|educat|student|learning|campus/i, sentence: 'Education institutions typically need reliable internet access for students and staff, campus-wide WiFi and tools for digital learning.' },
  { match: SUGGESTIONS[4].match, words: /restaurant|food|outlet|point-of-sale|guest/i, sentence: 'Food and beverage businesses typically rely on fast payment processing, dependable connectivity and guest-friendly WiFi.' },
  { match: SUGGESTIONS[5].match, words: /retail|store|outlet|shop|point-of-sale/i, sentence: 'Retail businesses typically need dependable connectivity for point-of-sale systems, secure payments and visibility across their outlets.' },
  { match: SUGGESTIONS[6].match, words: /manufactur|factory|plant|logistic|fleet|industr|warehouse/i, sentence: 'Manufacturing and logistics operations typically need reliable links between sites, secure networks and visibility over equipment and vehicles.' },
  { match: SUGGESTIONS[7].match, words: /enterprise|corporate|office|business productivity/i, sentence: 'Corporate offices and technology businesses typically rely on high-capacity internet, secure networks and modern collaboration tools.' },
];
// One general sentence per business type for "About you". It describes the SECTOR ("… businesses typically …"),
// never this company: no size, services, awards or years. `words` finds catalogue products that mention that sector.
const GENERIC_SECTOR_SENTENCE = 'Organisations of every size increasingly rely on dependable connectivity, secure networks and digital tools to serve their customers.';
// Used when the business type is unknown or matches no sector

const DESIGNATIONS = [
  { match: /hotel|resort|villa|guest ?house|restaurant|cafe/i, value: 'General Manager' },
  { match: /bank|finance|insurance|software|technology|it /i, value: 'IT Manager' },
  { match: /hospital|clinic|school|college|university|institute/i, value: 'Administrative Manager' },
  { match: /factory|manufactur|logistic|warehouse|garment/i, value: 'Operations Manager' },
];
// Who the letter on page 3 is addressed to, based on the business type

function suggestFor(category = '') {
  const rule = SUGGESTIONS.find(r => r.match.test(` ${category} `));
  // First rule whose keywords appear in the category (spaces added so "it " matches at the end)
  const ids = rule ? rule.ids : DEFAULT_SUGGESTIONS;
  return ids.map(id => (PRODUCT_BY_ID[id] ? PRODUCT_BY_ID[id].id : id)).filter(id => PRODUCT_BY_ID[id]);
}

function designationFor(category = '') {
  return (DESIGNATIONS.find(r => r.match.test(` ${category} `)) || { value: 'General Manager' }).value;
  // Falls back to "General Manager"
}

function formatDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  // "01/10/2026" (DD/MM/YYYY, as in the SLT template)
}

function formatLKR(v) {
  if (v === null || v === undefined || String(v).trim() === '') return 'On request';
  // Blank price prints "On request" instead of an empty cell
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? String(v) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // 100000 -> "100,000.00"; non-numbers (e.g. "Waived") print as typed
}

function splitAddress(address) {
  const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
  // "No 12, Galle Road, Colombo 03, Sri Lanka" -> ["No 12", "Galle Road", "Colombo 03", "Sri Lanka"]
  if (parts.length === 0) return { addressLine1: '', addressLine2: '', city: '' };
  if (parts.length === 1) return { addressLine1: '', addressLine2: '', city: parts[0] };
  if (parts.length === 2) return { addressLine1: `${parts[0]},`, addressLine2: '', city: parts[1] };
  return { addressLine1: `${parts.slice(0, -2).join(', ')},`, addressLine2: `${parts[parts.length - 2]},`, city: parts[parts.length - 1] };
  // Whole address kept (incl. "Sri Lanka"), split only at commas: street part(s) / town / last part
}

function localityOf(address) {
  const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length && /sri lanka/i.test(parts[parts.length - 1])) parts.pop();
  return parts.length ? parts[parts.length - 1].replace(/\s*\d{5}$/, '') : '';
  // Town for the SLT station column: "Kandy 20000, Sri Lanka" -> "Kandy"
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  // ["BIL","Managed WiFi","PeoTV Biz"] -> "BIL, Managed WiFi and PeoTV Biz"
}

function firstSentence(text) {
  const m = String(text).match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(text)).trim();
  // First sentence of the product description, used as the one-line requirement
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Escapes text before putting it into raw Word XML
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // PNG width/height are stored at bytes 16–23 of the file header
}

function getImageDimensions(buf) {
  if (!buf || buf.length < 24) return { w: 200, h: 80 };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16) || 200, h: buf.readUInt32BE(20) || 80 };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xFF) { offset++; continue; }
      const marker = buf[offset + 1];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        const h = buf.readUInt16BE(offset + 5);
        const w = buf.readUInt16BE(offset + 7);
        if (w && h) return { w, h };
      }
      const len = buf.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
  }
  // GIF (GIF87a or GIF89a)
  if (buf.length >= 10 && buf.slice(0, 4).toString('ascii') === 'GIF8') {
    return { w: buf.readUInt16LE(6) || 200, h: buf.readUInt16LE(8) || 80 };
  }
  // WebP
  if (buf.length >= 30 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) {
      const w = 1 + buf.readUIntLE(24, 3);
      const h = 1 + buf.readUIntLE(27, 3);
      if (w && h) return { w, h };
    } else if (chunk === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const w = 1 + (((b1 & 0x3F) << 8) | b0);
      const h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
      if (w && h) return { w, h };
    }
  }
  return { w: 200, h: 80 };
}

function textPara(runsXml, { before = 120, after = 60, keepNext = false } = {}) {
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/>${keepNext ? '<w:keepNext/>' : ''}<w:widowControl/><w:spacing w:before="${before}" w:after="${after}"/><w:ind w:left="360" w:right="360"/><w:jc w:val="both"/></w:pPr>${runsXml}</w:p>`;
  // widowControl: the template's Body Text style turns it off, and without it Word splits "keep with next" groups across pages
  // One body-text paragraph, lined up with the section heading bar above it
}

function run(text, { bold = false, color = null } = {}) {
  return `<w:r><w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  // One piece of text, optionally bold/coloured
}

function getDiagramPath(productId) {
  if (!productId) return null;
  const candidates = [
    path.join(DIAGRAM_DIR, `${productId}.png`),
    PRODUCT_BY_ID[productId] ? path.join(DIAGRAM_DIR, `${PRODUCT_BY_ID[productId].id}.png`) : null,
    ID_ALIASES[productId] ? path.join(DIAGRAM_DIR, `${ID_ALIASES[productId]}.png`) : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const cleanId = String(productId).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const fallback = path.join(DIAGRAM_DIR, `${cleanId}.png`);
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

function imagePara(rId, docPrId, name, size, isFirstProduct = false) {
  const maxCx = 5100000;
  const maxCy = isFirstProduct ? 2400000 : 2800000;

  let cx = maxCx;
  let cy = Math.round(cx * size.h / size.w);
  if (cy > maxCy) {
    cy = maxCy;
    cx = Math.round(cy * size.w / size.h);
  }

  return `<w:p><w:pPr><w:keepLines/><w:spacing w:before="60" w:after="${isFirstProduct ? 60 : 80}"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${esc(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${esc(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function customerBenefitsXml(product) {
  const benefits = product ? (product.customerBenefits || []).map(b => String(b || '').trim()).filter(Boolean) : [];
  if (!benefits.length) return '';
  return textPara(run('Customer Benefits', { bold: true, color: '0B2A6F' }), { before: 80, after: 20, keepNext: true })
    + benefits.map((b) => `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:widowControl/><w:spacing w:before="15" w:after="15"/><w:ind w:left="720" w:right="360" w:hanging="300"/></w:pPr><w:r><w:t>•</w:t></w:r><w:r><w:tab/></w:r>${run(b)}</w:p>`).join('');
}

function termsAndConditionsXml(products) {
  let xml = '';

  const GENERAL_TERMS = [
    'All prices are valid for 30 days period from the date of submission of the proposal.',
    'The quoted prices shall be subjected to prevailing applicable taxes at the time of invoicing.',
    'Since this is a budgetary quotation, do not make any payment against this quotation please.',
    'SLT has all the rights to revise the proposal.',
    'Information in this proposal shall not be disclosed to any third party by the customer.',
    'Customer shall not use the service for any unlawful act and be solely responsible for all information retrieved, stored and transmitted through the Service by the Company and comply with all regulatory conditions-imposed from time to time by TRCSL.',
    'Customer shall bear the cost of any transfer or change of the Service at the customer’s request.',
  ];

  xml += textPara(run('General Terms & Conditions', { bold: true, color: '0B2A6F' }), { before: 140, after: 60, keepNext: true });
  GENERAL_TERMS.forEach((term) => {
    xml += `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:widowControl/><w:spacing w:before="25" w:after="25"/><w:ind w:left="720" w:right="360" w:hanging="360"/></w:pPr><w:r><w:rPr><w:color w:val="231F20"/></w:rPr><w:t>•</w:t></w:r><w:r><w:tab/></w:r>${run(term)}</w:p>`;
  });

  const productsWithTerms = (products || []).filter(p => p && String(p.termsAndConditions || '').trim());
  if (productsWithTerms.length) {
    xml += textPara(run('Product-Specific Terms & Conditions', { bold: true, color: '0B2A6F' }), { before: 160, after: 60, keepNext: true });
    productsWithTerms.forEach((p, idx) => {
      xml += textPara(run(`${idx + 1}.  ${p.name}`, { bold: true, color: '0B2A6F' }), { before: idx === 0 ? 60 : 100, after: 20, keepNext: true });
      xml += textPara(run(String(p.termsAndConditions).trim()), { before: 15, after: 50 });
    });
  }

  return xml || '<w:p/>';
}

function buildRequirementsXml(zip, requirements) {
  if (!requirements || !requirements.length) return '';
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = zip && zip.file(relsPath) ? zip.file(relsPath).asText() : '';
  let xml = '';
  requirements.forEach((r, i) => {
    // Flow products naturally with clean spacing (no forced blank page breaks between every product)
    if (i > 0) {
      xml += '<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr></w:p>';
    }
    xml += textPara(run(`${i + 1}.  ${r.title}`, { bold: true, color: '0B2A6F' }), { before: i === 0 ? 60 : 100, keepNext: true });
    if (String(r.text || '').trim()) xml += textPara(run(r.text), { before: 20, after: 30 });
    const product = PRODUCT_BY_ID[r.id];
    const diagPath = getDiagramPath(r.id || (product && product.id));
    const hasDiagram = Boolean(diagPath && fs.existsSync(diagPath));

    if (product) {
      xml += customerBenefitsXml(product);
    }

    if (hasDiagram && zip) {
      const buf = fs.readFileSync(diagPath);
      const mediaName = `ih_diagram_${i + 1}.png`;
      zip.file(`word/media/${mediaName}`, buf);
      const rId = `rIdIH${i + 1}`;
      if (!rels.includes(`Id="${rId}"`)) {
        rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`);
      }
      xml += imagePara(rId, 9000 + i, `${r.title || (product && product.name)} diagram`, pngSize(buf), i === 0);
    }
  });
  if (rels && zip) {
    zip.file(relsPath, rels);
  }
  return xml || '';
}

function sectorFor(category = '') {
  return SECTORS.find(s => s.match.test(` ${category} `)) || null;
  // Same keyword rules as the "Suggested" products, so both agree on the business type
}

function businessType(category) {
  const c = String(category || '').split(/[,;/]/)[0].trim();
  if (!c) return '';
  const words = c.split(/\s+/).map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');
  return `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;
  // Google Maps category "Hotel" -> "a hotel", "IT company" -> "an IT company"; only the first category if several
}

function describeBusiness(business = {}) {
  const name = String(business.name || '').trim();
  if (business.overview && String(business.overview).trim().length > 20) {
    return firstSentences(business.overview, 3);
  }
  if (business.description && String(business.description).trim().length > 20) {
    return firstSentences(business.description, 3);
  }
  const town = String(business.city || '').trim() || localityOf(business.address);
  const inSriLanka = /sri lanka/i.test(String(business.address || ''));
  const type = businessType(business.category) || 'an enterprise';
  const where = town ? ` based in ${town}${inSriLanka && !/sri lanka/i.test(town) ? ', Sri Lanka' : ''}` : '';
  const sentences = [`${name} is ${type}${where}.`];
  // 1: what and where — only from the business type and address the rep already has
  const rating = Number(business.rating);
  const reviews = Number(business.reviews);
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(reviews) && reviews > 0) {
    sentences.push(`On Google Maps it has a rating of ${rating} from ${reviews.toLocaleString('en-US')} reviews.`);
  }
  // 2: only when the business search returned a rating and review count
  sentences.push((sectorFor(business.category) || {}).sentence || GENERIC_SECTOR_SENTENCE);
  // 3: one general sentence about this TYPE of business (never a claim about this company)
  return sentences.join(' ');
  // 2–3 sentences; crisp corporate description designed to fit neatly on page 7
}

function reasonFor(product, sector) {
  if (!product) return '';
  const sentence = firstSentences(product.description, 1);
  if (sector && sector.words && sector.words.test(sentence) && sentence.split(' ').length <= 20) return sentence;
  // The catalogue's own first sentence when it names this kind of business ("… for hotels, resorts …") and is short
  const feature = String((product.features && product.features[0]) || '').trim().replace(/\.$/, '');
  return feature ? `${feature}.` : shortProductSentence(product.description, product, 18);
  // Otherwise its first key feature from the catalogue
}

function recommendFor(business = {}, productIds = []) {
  const sector = sectorFor(business.category);
  const rule = SUGGESTIONS.find(r => r.match.test(` ${business.category || ''} `));
  const mentions = sector
    ? PRODUCTS.map(p => ({ id: p.id, n: (`${p.name} ${p.description} ${(p.features || []).join(' ')}`.match(new RegExp(sector.words.source, 'gi')) || []).length }))
      .filter(m => m.n > 0).sort((a, b) => b.n - a.n).map(m => m.id)
    : [];
  // Catalogue products whose own text mentions this sector, most mentions first
  const typed = [...new Set([...(rule ? rule.ids : []), ...mentions])].filter(id => PRODUCT_BY_ID[id]);
  const ticked = productIds.filter(id => PRODUCT_BY_ID[id]);
  const pick = [];
  const add = (ids, upTo) => ids.forEach(id => {
    const canonical = PRODUCT_BY_ID[id] ? PRODUCT_BY_ID[id].id : id;
    if (PRODUCT_BY_ID[canonical] && pick.length < upTo && !pick.includes(canonical)) {
      pick.push(canonical);
    }
  });
  add(typed, 3);
  // 1. Up to 3 products for this business type
  add(ticked, 4);
  // 2. Then the products the rep ticked for this proposal
  add(typed, 4);
  add(DEFAULT_SUGGESTIONS, 3);
  // 3. Keep exactly 3–4 recommendations so they fit comfortably on one single page
  const valid = pick.filter(id => PRODUCT_BY_ID[id]);
  return valid.slice(0, 4).map((id, i) => ({
    id: PRODUCT_BY_ID[id].id,
    name: PRODUCT_BY_ID[id].name,
    reason: reasonFor(PRODUCT_BY_ID[id], sector),
    highPriority: true // High priority recommendations from knowledge base
  }));
}

function generateFields({ business, productIds = [], user = {}, refNo, defaults = {} }) {
  const products = productIds.map(id => PRODUCT_BY_ID[id]).filter(Boolean);
  // Turns the ticked ids into full product objects (unknown ids are ignored)
  if (!products.length) throw Object.assign(new Error('Select at least one product'), { status: 400 });
  if (!business || !String(business.name || '').trim()) throw Object.assign(new Error('business.name is required'), { status: 400 });

  const addr = splitAddress(business.address);
  const station = business.city || localityOf(business.address);
  const introParagraphs = products.map(p => String(p.proposalDescription || p.description || '').trim()).filter(Boolean);
  const solutionIntro1 = introParagraphs[0] || '';
  const solutionIntro2 = introParagraphs.slice(1).join('\n\n');

  let leadLogo = business.leadLogo || business.logo || business.logoUrl || '';
  if (!leadLogo && business.website) {
    const d = business.website.replace(/https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').trim();
    if (d && d.includes('.')) {
      leadLogo = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=128`;
    }
  }

  return {
    companyName: business.name,
    leadLogo: leadLogo,
    // Business name (cover, letter, T&C)
    refNo: refNo || '',
    // Unique reference issued on the server by /generate (services/refService.js); read-only in the editor
    proposalDate: formatDate(),
    recipientDesignation: designationFor(business.category),
    addressLine1: addr.addressLine1,
    addressLine2: addr.addressLine2,
    city: addr.city,
    // Letter header on page 3
    solutionName: joinNames(products.map(p => p.name)),
    // "We are pleased to submit the attached proposal for BIL, Managed WiFi and Enterprise TV"
    solutionIntro1,
    // First letter paragraph = proposal description of first product from knowledge base
    solutionIntro2,
    // Subsequent letter paragraphs = proposal descriptions of other products from knowledge base
    requirements: products.map(p => ({
      id: p.id,
      title: p.name,
      text: p.proposalDescription || p.description,
      showFeatures: false,
    })),
    // Page 6: one requirement per product; id links it to its network diagram
    aboutDescription: describeBusiness(business),
    recommendations: recommendFor(business, productIds),
    // Page 7 "About you and how we can help you": facts-only description + 3–5 catalogue products (2 high priority)
    solutionSummary: SOLUTION_SUMMARY,
    components: products.map(p => ({
      service: p.name,
      station: business.address ? localityOf(business.address) : 'Colombo',
      media: 'Optical Fibre',
      ntu: 'Standard NTU',
    })),
    // Page 8 table: one row per product
    investment: products.map(p => ({ description: p.name, bandwidth: '', qosTemplate: '', oneTimeCharge: '', monthlyRental: '' })),
    // Investment table: the rep types the prices on the edit screen; an empty QoS Template prints "N/A"
    amName: user.name || '',
    amPhone: user.phone || '',
    amEmail: user.email || '',
    amDesignation: user.designation || '',
    amDivision: user.division || '',
    // Page 3 "reach out to ..." + Contact Us primary contact = the logged-in user; a missing value stays empty
    rebmName: defaults.rebmName || '',
    rebmDesignation: defaults.rebmDesignation || 'Regional Enterprise Business Manager',
    rebmPhone: defaults.rebmPhone || '',
    rebmEmail: defaults.rebmEmail || '',
    rebmDivision: defaults.rebmDivision || '',
    // Secondary contact, from backend/.env
    ackAddressee1: ACK_DEFAULTS.ackAddressee1,
    ackAddressee2: ACK_DEFAULTS.ackAddressee2,
    ackDate: formatDate(),
    // Customer Acknowledgements page: addressee lines and "proposal submitted on <date>"
    ackPrefill: true,
    ackCompanyName: business.name,
    ackAddress: String(business.address || '').trim(),
    ackSolution: joinNames(products.map(p => p.name)),
    ackInitialCharge: '',
    ackMonthlyCharge: '',
    ackCommitment: '',
    // The 6 lines the customer fills in; Company / Address / Solution pre-filled while ackPrefill is on, the rest empty
    // (an empty one prints the template's dotted line)
  };
  // These are ALL the variable parts of the template — sent to the edit screen, then back to renderDocx
}

const FIXED_LETTER_TEXT = [/^dear\b/i, /^business proposal for\b/i, /^we understand that every organisation/i, /^as we combine the strength/i, /^moreover, we have dedicated account managers/i, /^we are pleased to submit/i, /^our proposal briefs/i, /^we look forward to/i, /^do not hesitate/i, /^we are committed to partnering/i, /^thank you\b/i, /^yours sincerely/i];
// Sentences the template letter already prints around {solutionIntro1}/{solutionIntro2}, so they aren't repeated

function dropFixedLetterText(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).filter(s => !FIXED_LETTER_TEXT.some(re => re.test(s.trim()))).join(' ').trim();
  // Removes any of those sentences from the n8n letter text
}

function blankIfTbc(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return /^to be confirmed\.?$/i.test(s) ? '' : s;
  // "To be confirmed" -> '' so the edit screen shows an empty box and prices print "On request"
}

function firstSentences(text, n) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, n).join(' ');
  // At most n sentences, on one line (no manual line breaks)
}

const CLAUSE_START = /^(which|while|backed|so|giving|helping|enabling|ensuring|offering|allowing|providing|delivering|supporting|making|reducing|letting)$/i;
// A comma followed by one of these words ends a complete clause: "…foundation for its operations, backed by…"
const INTRO_WORD = /^(as|with|for|in|by|while|although|though|because|since|when|if|through|from|to|being|having|after|before|given|across|at|on|unlike|like)$/i;
// A sentence opening with one of these starts with an introductory phrase, so the part before a comma isn't a sentence on its own
const WEAK_LAST_WORD = /^(and|or|with|for|to|of|the|a|an|in|on|at|by|from|across|including|that|which|while|as|its|their|your|our)$/i;

function shortSentence(text, maxWords) {
  const s = firstSentences(String(text || '').replace(/\s*\(\d+\s*[–-]\s*\d+\s*words?\)/gi, ''), 1);
  // Also drops "(50–150 words)" editing notes left in the catalogue text
  const words = s.split(' ').filter(Boolean);
  if (words.length <= maxWords) return s;
  if (INTRO_WORD.test(words[0].replace(/[^a-z]/gi, ''))) return '';
  for (let i = Math.min(maxWords, words.length - 1) - 1; i >= 5; i -= 1) {
    if (/,$/.test(words[i]) && CLAUSE_START.test(words[i + 1].replace(/[^a-z]/gi, ''))) return `${words.slice(0, i + 1).join(' ').replace(/,$/, '')}.`;
  }
  return '';
  // First sentence if it has at most maxWords words, else that sentence ended at a clause boundary; '' if neither works
}

function clippedSentence(text, maxWords) {
  const cut = firstSentences(String(text || '').replace(/\s*\(\d+\s*[–-]\s*\d+\s*words?\)/gi, ''), 1).split(' ').filter(Boolean).slice(0, maxWords);
  while (cut.length > 1 && WEAK_LAST_WORD.test(cut[cut.length - 1].replace(/[^a-z]/gi, ''))) cut.pop();
  return `${cut.join(' ').replace(/[,;:.!?]+$/, '')}…`;
  // Last resort: the first maxWords words with "…", so a cut is visible instead of a made-up full stop
}

function shortProductSentence(text, product, maxWords) {
  return shortSentence(text, maxWords) || (product && shortSentence(product.description, maxWords)) || clippedSentence(text || (product && product.description), maxWords);
  // n8n's sentence -> the catalogue description's first sentence -> a visible cut. Never empty when there is any text.
}

function shortCell(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const head = s.split(/\s*[(,;]\s*|\s+-\s+|\s+(?:with|via|and)\s+/i)[0];
  if (head && head.length <= max) return head;
  return s.slice(0, max + 1).replace(/\s+\S*$/, '');
  // Keeps a table cell to about 2 lines: text before the first "(", ",", " with "… or a word-boundary cut
}

function stationCell(text) {
  const s = String(text || '').trim();
  return s.includes(',') ? localityOf(s) : s;
  // A full address in the Station column becomes just its town ("117 Sir…, Colombo 02, Sri Lanka" -> "Colombo 02")
}

function useCatalogueName(text, agentName, product) {
  const s = String(text || '');
  if (!product || !agentName || agentName === product.name || s.includes(product.name)) return s;
  return s.split(agentName).join(product.name);
  // n8n may call a product something else ("Business Internet Line"); the proposal uses the catalogue name everywhere
}

function applyAgentProposal(fields, proposal = {}) {
  const letter = proposal.letter || {};
  const reqs = Array.isArray(proposal.requirements) ? proposal.requirements : [];
  const table = Array.isArray(proposal.solutionTable) ? proposal.solutionTable : [];
  const invest = Array.isArray(proposal.investment) ? proposal.investment : [];
  const agentNames = Object.fromEntries((Array.isArray(proposal.products) ? proposal.products : []).map(p => [p.id, String(p.name || '').trim()]));
  // n8n arrays are one entry per selected product, in the same order as fields.requirements
  const products = fields.requirements.map(r => PRODUCT_BY_ID[r.id]);
  const named = (text, i) => useCatalogueName(text, agentNames[fields.requirements[i].id], products[i]);
  const allNamed = text => fields.requirements.reduce((t, r, i) => named(t, i), String(text || ''));

  // "No need to generate product description. Add only the description in the proposal description part"
  const introParagraphs = products.map(p => String((p && p.proposalDescription) || (p && p.description) || '').trim()).filter(Boolean);
  const solutionIntro1 = introParagraphs[0] || fields.solutionIntro1;
  const solutionIntro2 = introParagraphs.slice(1).join('\n\n');

  return {
    ...fields,
    // Company, ref, date, address, solutionName, solutionSummary, contacts and commitment stay as the builder computed them
    solutionIntro1,
    // First letter paragraph = proposal description of first product from knowledge base
    solutionIntro2,
    // Then one paragraph per product from the knowledge base
    requirements: fields.requirements.map((r, i) => {
      const p = PRODUCT_BY_ID[r.id];
      const desc = (p && p.proposalDescription) ? p.proposalDescription : r.text;
      return { id: r.id, title: r.title, text: desc, showFeatures: false };
    }),
    components: (proposal.components && proposal.components.length > 0)
      ? proposal.components
      : (fields.components && fields.components.length > 0)
        ? fields.components
        : products.map(p => ({
            service: p.name,
            station: fields.address ? localityOf(fields.address) : 'Colombo',
            media: 'Optical Fibre',
            ntu: 'Standard NTU',
          })),
    investment: fields.investment.map((row, i) => (invest[i] ? {
      description: row.description,
      // Catalogue name
      bandwidth: blankIfTbc(invest[i].speed),
      qosTemplate: blankIfTbc(invest[i].qosTemplate ?? row.qosTemplate),
      // n8n doesn't send a QoS template yet; whatever it sends later is used, otherwise it stays blank ("N/A")
      oneTimeCharge: blankIfTbc(invest[i].oneTimeCharge),
      monthlyRental: blankIfTbc(invest[i].monthlyRental),
    } : row)),
    // Prices only ever come from n8n; anything unconfirmed stays blank
  };
}


function linesOf(...texts) {
  return texts.flatMap(t => String(t || '').split(/\n+/)).map(s => s.trim()).filter(Boolean);
  // Each line / blank-line-separated block of an edit box becomes its own paragraph
}

function letterXml(fields) {
  return linesOf(fields.solutionIntro1, fields.solutionIntro2)
    .map(t => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`)
    .join('') || '<w:p/>';
  // Letter body paragraphs between "We are pleased to submit…" and "We look forward…", formatted like the template's own letter paragraphs
}

function capWords(text, maxWords) {
  const out = [];
  for (const s of String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    if (out.length && [...out, s].join(' ').split(' ').length > maxWords) break;
    out.push(s);
  }
  return out.join(' ');
  // Whole sentences while they fit in maxWords (the first one is always kept)
}

function shortenAbout(fields, level) {
  const recs = (Array.isArray(fields.recommendations) ? fields.recommendations : []).filter(r => PRODUCT_BY_ID[r.id]);
  // Only products that exist in the catalogue are ever printed
  const limit = ABOUT_LIMITS[level];
  if (!limit) return { description: String(fields.aboutDescription || '').trim(), recs };
  const description = linesOf(fields.aboutDescription).map(t => firstSentences(t, limit.sentences)).join('\n\n');
  return {
    description: capWords(description, limit.descWords) || shortProductSentence(description, null, limit.descWords),
    recs: [...recs.filter(r => r.highPriority), ...recs.filter(r => !r.highPriority)].slice(0, Math.max(limit.max, MIN_RECOMMENDATIONS))
      .map(r => ({ ...r, reason: String(r.reason || '').trim() && (shortSentence(r.reason, limit.reasonWords) || clippedSentence(r.reason, limit.reasonWords)) })),
    // Always the rep's own reason, cut at a clause or with "…" (never swapped for other text)
  };
  // Copy used only for this render: fewer sentences and shorter reasons; from level 3 the lowest-priority products go (never below 3)
}

const PRIORITY_TAG = '<w:r><w:t xml:space="preserve">  </w:t></w:r><w:r><w:rPr><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:shd w:val="clear" w:color="auto" w:fill="1E8E3E"/></w:rPr><w:t xml:space="preserve"> HIGH PRIORITY </w:t></w:r>';
// White on green label after a high-priority product name (character shading works in Word and LibreOffice)

function aboutXml(fields, level = 0) {
  const { description, recs } = shortenAbout(fields, level);
  let xml = linesOf(description).map(t => textPara(run(t), { before: 100, after: 60 })).join('');
  // The description, one paragraph per typed paragraph
  if (recs.length) {
    xml += textPara(run('How we can help you', { bold: true, color: '0B2A6F' }), { before: 180, after: 40, keepNext: true });
    recs.slice(0, 4).forEach((r, i) => {
      const prod = PRODUCT_BY_ID[r.id];
      const rName = prod ? prod.name : (r.name || r.id);
      xml += textPara(run(`${i + 1}.  ${rName}`, { bold: true, color: '0B2A6F' }) + (r.highPriority ? PRIORITY_TAG : ''), { before: i ? 120 : 60, after: 0, keepNext: true });
      // Product name exactly as in the catalogue, plus the HIGH PRIORITY label when ticked
      if (String(r.reason || '').trim()) xml += textPara(run(String(r.reason).trim()), { before: 30, after: 0 });
      // The one-line reason under it
    });
  }
  return xml || '<w:p/>';
  // Raw XML that replaces {@aboutXml}
}

function addressLine(fields) {
  return [fields.addressLine1, fields.addressLine2, fields.city].map(s => String(s || '').trim().replace(/,+$/, '')).filter(Boolean).join(', ');
  // The SLT letter prints the address on one line: "No 12, Galle Road, Colombo 03"; empty lines are left out
}

function shortenLetter(fields, level) {
  const limit = LETTER_WORD_LIMITS[level];
  if (!limit) return fields;
  const reqs = fields.requirements || [];
  const blocks = linesOf(fields.solutionIntro2);
  const aligned = blocks.length === reqs.length;
  // One block per selected product, in order (as applyAgentProposal writes it)
  const products = blocks.map((t, i) => shortProductSentence(t, aligned ? PRODUCT_BY_ID[reqs[i].id] : null, limit));
  const tailoredOnly = blocks.length >= reqs.length;
  // solutionIntro1 is the extra tailored paragraph when solutionIntro2 already has one paragraph per product
  return {
    ...fields,
    solutionIntro1: tailoredOnly
      ? (level >= 2 ? '' : linesOf(fields.solutionIntro1).map(t => shortSentence(t, limit)).filter(Boolean).join('\n\n'))
      : linesOf(fields.solutionIntro1).map(t => shortProductSentence(t, null, limit)).join('\n\n'),
    solutionIntro2: products.join('\n\n'),
  };
  // Copy used only for this render: 1 sentence of at most `limit` words per paragraph (from level 2 the tailored paragraph goes);
  // every product paragraph stays
}

function findLastTag(text, tagName, beforeIndex) {
  let p = beforeIndex;
  while (p > 0) {
    const cand = text.lastIndexOf('<' + tagName, p);
    if (cand === -1) return -1;
    const nextChar = text[cand + tagName.length + 1];
    if (nextChar === ' ' || nextChar === '>') return cand;
    p = cand - 1;
  }
  return -1;
}

function renderDocx(fields, tocPages = TOC_TEMPLATE_PAGES) {
  return buildDocx(fields, tocPages, {});
}

function buildDocx(fields, tocPages = TOC_TEMPLATE_PAGES, { letterLevel = 0, aboutLevel = 0, networkBreak = false } = {}) {
  if (!fields || !String(fields.companyName || '').trim()) throw Object.assign(new Error('companyName is required'), { status: 400 });
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  // Fresh copy of the template for every request

  // Pre-process word/document.xml to clean field codes, Lotus Road address, and Terms & Conditions
  let xml = zip.file('word/document.xml').asText();

  // Ensure no red text remains anywhere in the template or generated XML, and rejoin split tags in headers/footers
  xml = xml.replace(/<w:color\s+w:val="FF0000"\/>/gi, '<w:color w:val="0B2A6F"/>');
  zip.file(/word\/(header\d+|footer\d+)\.xml/).forEach(f => {
    let content = f.asText();
    content = content.replace(/<w:proofErr\b[^>]*\/>/gis, '');
    content = content.replace(/<w:gramErr\b[^>]*\/>/gis, '');
    content = content.replace(/\{([^{}]*)\}/gs, (match, c) => {
      if (c.includes('<')) {
        return `{${c.replace(/<[^>]+>/g, '').trim()}}`;
      }
      return match;
    });
    content = content.replace(/\{\{([a-zA-Z0-9_#/@]+)\}\}/g, '{$1}');
    if (/FF0000/i.test(content)) {
      content = content.replace(/<w:color\s+w:val="FF0000"\/>/gi, '<w:color w:val="002060"/>');
    }
    zip.file(f.name, content);
  });

  // Ensure Heading1 in styles.xml has center alignment for section title banners
  if (zip.file('word/styles.xml')) {
    let stylesXml = zip.file('word/styles.xml').asText();
    stylesXml = stylesXml.replace(
      /(<w:style[^>]*w:styleId="Heading1"[^>]*>.*?<w:pPr>)(.*?)(<\/w:pPr>)/s,
      (match, pPrOpen, pPrContent, pPrClose) => {
        if (/<w:jc\b/i.test(pPrContent)) {
          return `${pPrOpen}${pPrContent.replace(/<w:jc\b[^>]*\/>/gi, '<w:jc w:val="center"/>')}${pPrClose}`;
        }
        return `${pPrOpen}<w:jc w:val="center"/>${pPrContent}${pPrClose}`;
      }
    );
    zip.file('word/styles.xml', stylesXml);
  }

  // 1. Cover page: cleanly replace field codes so {companyName} displays directly
  const pStart = xml.indexOf('SET CustomerName4');
  if (pStart !== -1) {
    const paraStart = xml.lastIndexOf('<w:p ', pStart);
    const paraEnd = xml.indexOf('</w:p>', pStart) + 6;
    const cleanCoverPara = '<w:p w:rsidR="00F86C5E" w:rsidRPr="0073313B" w:rsidRDefault="00F86C5E" w:rsidP="004C153B"><w:pPr><w:pStyle w:val="Title"/><w:rPr><w:color w:val="74B5E3"/><w:spacing w:val="6"/><w:w w:val="75"/></w:rPr></w:pPr><w:r><w:rPr><w:color w:val="124162"/><w:w w:val="90"/></w:rPr><w:t>{companyName}</w:t></w:r><w:r w:rsidRPr="0073313B"><w:rPr><w:color w:val="124162"/><w:w w:val="90"/></w:rPr><w:br/></w:r><w:r w:rsidRPr="0073313B"><w:rPr><w:color w:val="74B5E3"/><w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr><w:br/><w:t xml:space="preserve">Proposal Ref. No. </w:t></w:r><w:r w:rsidR="008B026C"><w:rPr><w:color w:val="124162"/><w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr><w:t>{refNo}</w:t></w:r></w:p>';
    xml = xml.substring(0, paraStart) + cleanCoverPara + xml.substring(paraEnd);
  }

  // 1b. Cover page logo table: populate Cell 2 (right side of Mobitel logo) with client logo or styled company name
  const col2Idx = xml.indexOf('<w:gridCol w:w="5255"/>');
  if (col2Idx !== -1) {
    const trStart = xml.indexOf('<w:tr', col2Idx);
    const cell1Start = trStart !== -1 ? xml.indexOf('<w:tc>', trStart) : -1;
    const cell1End = cell1Start !== -1 ? xml.indexOf('</w:tc>', cell1Start) + 7 : -1;
    const cell2Start = cell1End !== -1 ? xml.indexOf('<w:tc>', cell1End) : -1;
    const cell2End = cell2Start !== -1 ? xml.indexOf('</w:tc>', cell2Start) + 7 : -1;

    if (cell2Start !== -1 && cell2End !== -1) {
      let clientLogoXml = '';
      let logoBuf = null;

      if (fields.leadLogo) {
        if (Buffer.isBuffer(fields.leadLogo)) {
          logoBuf = fields.leadLogo;
        } else if (typeof fields.leadLogo === 'string') {
          if (fields.leadLogo.startsWith('data:image/')) {
            try {
              const base64Data = fields.leadLogo.split(',')[1];
              logoBuf = Buffer.from(base64Data, 'base64');
            } catch (e) {}
          } else if (/^[A-Za-z0-9+/=]+$/.test(fields.leadLogo.trim()) && fields.leadLogo.trim().length > 100) {
            try {
              logoBuf = Buffer.from(fields.leadLogo.trim(), 'base64');
            } catch (e) {}
          }
        }
      }

      // Detect format from binary header and embed logo, or fall back to company name text
      let ext = 'jpg';
      let logoValid = false;
      if (logoBuf && logoBuf.length > 0) {
        if (logoBuf[0] === 0x89 && logoBuf[1] === 0x50 && logoBuf[2] === 0x4E && logoBuf[3] === 0x47) {
          ext = 'png'; logoValid = true; // PNG
        } else if (logoBuf[0] === 0xFF && logoBuf[1] === 0xD8) {
          ext = 'jpg'; logoValid = true; // JPEG
        } else if (logoBuf.length >= 12 && logoBuf.slice(0, 4).toString('ascii') === 'RIFF' && logoBuf.slice(8, 12).toString('ascii') === 'WEBP') {
          ext = 'webp'; logoValid = true; // WebP
        } else if (logoBuf.length >= 4 && logoBuf.slice(0, 4).toString('ascii') === 'GIF8') {
          ext = 'png'; logoValid = true; // GIF (treat as PNG)
        }
      }

      if (logoValid && logoBuf) {
        const mediaName = `ih_client_logo.${ext}`;
        zip.file(`word/media/${mediaName}`, logoBuf);

        const relsPath = 'word/_rels/document.xml.rels';
        let rels = zip.file(relsPath).asText();
        const rId = 'rIdClientLogo';
        if (!rels.includes(`Id="${rId}"`)) {
          rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`);
          zip.file(relsPath, rels);
        }

        const sizePref = String(fields.leadLogoSize || 'medium').toLowerCase();
        let maxCx = 2350000;
        let maxCy = 980000;
        if (sizePref === 'large') {
          maxCx = 2950000;
          maxCy = 1250000;
        } else if (sizePref === 'small') {
          maxCx = 1600000;
          maxCy = 750000;
        }

        const dims = getImageDimensions(logoBuf);
        let w = dims.w || 200;
        let h = dims.h || 80;

        let cx = maxCx;
        let cy = Math.round(cx * h / w);
        if (cy > maxCy) {
          cy = maxCy;
          cx = Math.round(cy * w / h);
        }

        clientLogoXml = 
          `<w:tc><w:tcPr><w:tcW w:w="5255" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
          `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="60" w:after="60"/></w:pPr>` +
          `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
          `<wp:extent cx="${cx}" cy="${cy}"/>` +
          `<wp:docPr id="9988" name="Client Logo"/>` +
          `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9988" name="Client Logo"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
          `</wp:inline></w:drawing></w:r></w:p></w:tc>`;
      } else {
        clientLogoXml = 
          `<w:tc><w:tcPr><w:tcW w:w="5255" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
          `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="80" w:after="60"/></w:pPr>` +
          `<w:r><w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="0B2A6F"/></w:rPr><w:t>{companyName}</w:t></w:r>` +
          `</w:p></w:tc>`;
      }
      xml = xml.substring(0, cell2Start) + clientLogoXml + xml.substring(cell2End);
    }
  }

  // 2. Remove floating table positioning ONLY in document body (after first sectPr)
  const idxSect = xml.indexOf('<w:sectPr');
  if (idxSect !== -1) {
    let cover = xml.substring(0, idxSect);
    let body = xml.substring(idxSect);
    // Remove large 48pt spacer paragraphs on cover so it fits strictly on 1 page
    cover = cover.replace(/<w:p\b[^>]*><w:pPr><w:pStyle w:val="BodyText"\/>(?:(?!<\/w:p>).)*?w:val="48"(?:(?!<\/w:p>).)*?<\/w:p>/gis, '');
    body = body.replace(/<w:tblpPr\b[^>]*\/>/gis, '');
    xml = cover + body;
  } else {
    xml = xml.replace(/<w:tblpPr\b[^>]*\/>/gis, '');
  }

  // 3. Remove proofErr and gramErr tags that break Word spellchecked placeholders
  xml = xml.replace(/<w:proofErr\b[^>]*\/>/gis, '');
  xml = xml.replace(/<w:gramErr\b[^>]*\/>/gis, '');

  // 4. Robustly rejoin ANY split tag across runs: { ... }
  // Strips any internal XML tags inside { ... } so {</w:t></w:r>...<w:t>tagName</w:t>...} becomes {tagName}
  xml = xml.replace(/\{([^{}]*)\}/gs, (match, content) => {
    if (content.includes('<')) {
      const tagText = content.replace(/<[^>]+>/g, '').trim();
      return `{${tagText}}`;
    }
    return match;
  });

  // Normalize double curly braces {{tag}} -> {tag}
  xml = xml.replace(/\{\{([a-zA-Z0-9_#/@]+)\}\}/g, '{$1}');

  // 5. Clean sample data and field codes from designer template
  xml = xml.replace(/Enterprise_STest\s*1\s*\{companyName\}/g, '{companyName}');
  xml = xml.replace(/1-WF8VSRZ\s*\{refNo\}/g, '{refNo}');
  xml = xml.replace(/(?:23\/09\/2025\s*){1,2}\{proposalDate\}/g, '{proposalDate}');
  xml = xml.replace(/0701314128\s*\{amPhone\}/g, '{amPhone}');
  xml = xml.replace(/Hasanthi\s+Lanka\s*\{amName\}/g, '{amName}');
  xml = xml.replace(/lankahasanthi@gmail\.com\s*\{amEmail\}/g, '{amEmail}');

  // 6. Normalize tags: trim whitespace
  xml = xml.replace(/\{\s*#\s*components\s*\}/gi, '{#components}');
  xml = xml.replace(/\{\s*\/\s*components\s*\}/gi, '{/components}');
  xml = xml.replace(/\{\s*#\s*investment\s*\}/gi, '{#investment}');
  xml = xml.replace(/\{\s*\/\s*investment\s*\}/gi, '{/investment}');
  xml = xml.replace(/\{\s*name\s*\}/gi, '{name}');
  xml = xml.replace(/\{\s*description\s*\}/gi, '{description}');
  xml = xml.replace(/\{\s*speed\s*\}/gi, '{speed}');
  xml = xml.replace(/\{\s*bandwidth\s*\}/gi, '{bandwidth}');
  xml = xml.replace(/\{\s*qos\s*\}/gi, '{qos}');
  xml = xml.replace(/\{\s*qosTemplate\s*\}/gi, '{qosTemplate}');
  xml = xml.replace(/\{\s*oneTime\s*\}/gi, '{oneTime}');
  xml = xml.replace(/\{\s*oneTimeCharge\s*\}/gi, '{oneTimeCharge}');
  xml = xml.replace(/\{\s*monthly\s*\}/gi, '{monthly}');
  xml = xml.replace(/\{\s*monthlyRental\s*\}/gi, '{monthlyRental}');

  xml = xml.replace(/\{\s*companyName\s*\}/gi, '{companyName}');
  xml = xml.replace(/\{\s*refNo\s*\}/gi, '{refNo}');
  xml = xml.replace(/\{\s*proposalDate\s*\}/gi, '{proposalDate}');
  xml = xml.replace(/\{\s*recipientDesignation\s*\}/gi, '{recipientDesignation}');
  xml = xml.replace(/\{\s*address\s*\}/gi, '{address}');
  xml = xml.replace(/\{\s*amName\s*\}/gi, '{amName}');
  xml = xml.replace(/\{\s*amPhone\s*\}/gi, '{amPhone}');
  xml = xml.replace(/\{\s*amEmail\s*\}/gi, '{amEmail}');
  xml = xml.replace(/\{\s*ackCompanyName\s*\}/gi, '{ackCompanyName}');
  xml = xml.replace(/\{\s*ackAddress\s*\}/gi, '{ackAddress}');


  // 7. Inject {@aboutXml} into About You section body if missing
  if (!xml.includes('aboutXml') && xml.includes('26E68EBD')) {
    xml = xml.replace(/<w:p w14:paraId="26E68EBD"[^>]*>.*?<\/w:p>/s, '<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:jc w:val="both"/></w:pPr><w:r><w:t>{@aboutXml}</w:t></w:r></w:p>');
  }

  // 8. Letter page: remove duplicate Lotus Road address paragraph completely
  xml = xml.replace(/<w:p\b[^>]*>(?:(?!<\/w:p>).)*?SET Address "No 125, Lotus Road[^"]*"(?:(?!<\/w:p>).)*?<\/w:p>/s, '');
  xml = xml.replace(/<w:fldSimple w:instr="\s*REF\s+Address\b[^"]*">(?:(?!<\/w:fldSimple>).)*?<\/w:fldSimple>/gs, '');
  xml = xml.replace(/No 125, Lotus Road, Colombo 01, Colombo, Western, Sri Lanka, 00100/g, '');
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET Designation ""\s*<\/w:instrText>/g, '');
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*REF\s+Designation\b[^<]*<\/w:instrText>/g, '');

  const amNameVal = String(fields.amName || '').trim();
  const amPhoneVal = String(fields.amPhone || '').trim();
  const amEmailVal = String(fields.amEmail || '').trim();
  const dateVal = String(fields.proposalDate || new Date().toLocaleDateString('en-GB')).trim();

  // Replace template sample bookmark field values with actual fields
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET InvoiceDate\s+"[^"]*"\s*<\/w:instrText>/g, `<w:instrText xml:space="preserve"> SET InvoiceDate "${dateVal}" </w:instrText>`);
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET AccountManagerNumber\s+"[^"]*"\s*<\/w:instrText>/g, `<w:instrText xml:space="preserve"> SET AccountManagerNumber "${amPhoneVal}" </w:instrText>`);
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET AccountManagerNumber1\s+"[^"]*"\s*<\/w:instrText>/g, `<w:instrText xml:space="preserve"> SET AccountManagerNumber1 "${amPhoneVal}" </w:instrText>`);
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET AccountManagerName3\s+"[^"]*"\s*<\/w:instrText>/g, `<w:instrText xml:space="preserve"> SET AccountManagerName3 "${amNameVal}" </w:instrText>`);
  xml = xml.replace(/<w:instrText xml:space="preserve">\s*SET AccountManagerEmail\s+"[^"]*"\s*<\/w:instrText>/g, `<w:instrText xml:space="preserve"> SET AccountManagerEmail "${amEmailVal}" </w:instrText>`);

  xml = xml.replace(/(<w:bookmarkStart\b[^>]*\bname="AccountManagerName3"[^>]*>.*?<w:t>)[^<]*(<\/w:t>.*?<w:bookmarkEnd)/gs, '$1{amName}$2');
  xml = xml.replace(/(<w:bookmarkStart\b[^>]*\bname="AccountManagerNumber"[^>]*>.*?<w:t>)[^<]*(<\/w:t>.*?<w:bookmarkEnd)/gs, '$1{amPhone}$2');
  xml = xml.replace(/(<w:bookmarkStart\b[^>]*\bname="AccountManagerNumber1"[^>]*>.*?<w:t>)[^<]*(<\/w:t>.*?<w:bookmarkEnd)/gs, '$1{amPhone}$2');
  xml = xml.replace(/(<w:bookmarkStart\b[^>]*\bname="AccountManagerEmail"[^>]*>.*?<w:t>)[^<]*(<\/w:t>.*?<w:bookmarkEnd)/gs, '$1{amEmail}$2');
  xml = xml.replace(/(<w:bookmarkStart\b[^>]*\bname="InvoiceDate"[^>]*>.*?<w:t>)[^<]*(<\/w:t>.*?<w:bookmarkEnd)/gs, '$1{proposalDate}$2');

  zip.file('word/document.xml', xml);

  const reqList = Array.isArray(fields.requirements) ? fields.requirements.filter(r => String(r.title || '').trim()) : [];
  const selectedProducts = reqList.map(r => PRODUCT_BY_ID[r.id]).filter(Boolean);
  const requirementsXml = buildRequirementsXml(zip, reqList);

  // Components dynamic table rows for {#components}...{/components}
  let componentsData = [];
  if (Array.isArray(fields.components) && fields.components.length > 0) {
    componentsData = fields.components.filter(c => c && (c.service || c.name || c.description)).map(c => ({
      service: c.service || c.name || c.description || '',
      station: c.station || c.location || (fields.address ? localityOf(fields.address) : '') || 'Head Office',
      media: c.media || 'Optical Fibre',
      ntu: c.ntu || 'Managed NTU',
      name: c.service || c.name || c.description || '',
      description: c.service || c.name || c.description || '',
    }));
  }
  if (componentsData.length === 0) {
    if (selectedProducts.length > 0) {
      componentsData = selectedProducts.map(p => ({
        service: p.name,
        station: fields.address ? localityOf(fields.address) : 'Colombo',
        media: 'Optical Fibre',
        ntu: 'Standard NTU',
        name: p.name,
        description: p.name,
      }));
    } else if (reqList.length > 0) {
      componentsData = reqList.map(r => ({
        service: r.title,
        station: fields.address ? localityOf(fields.address) : 'Colombo',
        media: 'Optical Fibre',
        ntu: 'Standard NTU',
        name: r.title,
        description: r.title,
      }));
    } else {
      componentsData = [{
        service: 'Enterprise Connectivity',
        station: fields.address ? localityOf(fields.address) : 'Colombo',
        media: 'Optical Fibre',
        ntu: 'Standard NTU',
        name: 'Enterprise Connectivity',
        description: 'Enterprise Connectivity',
      }];
    }
  }

  const todayFormatted = new Date().toLocaleDateString('en-GB');
  const data = {
    ...fields,
    companyName: String(fields.companyName || '').trim(),
    refNo: String(fields.refNo || '').trim(),
    proposalDate: fields.proposalDate || todayFormatted,
    recipientDesignation: String(fields.recipientDesignation || fields.designation || 'General Manager').trim(),
    address: addressLine(fields),
    amName: String(fields.amName || '').trim(),
    amPhone: String(fields.amPhone || '').trim(),
    amEmail: String(fields.amEmail || '').trim(),
    ackAddressee1: fields.ackAddressee1 ?? ACK_DEFAULTS.ackAddressee1,
    ackAddressee2: fields.ackAddressee2 ?? ACK_DEFAULTS.ackAddressee2,
    ackDate: fields.ackDate ?? (fields.proposalDate || todayFormatted),
    ...Object.fromEntries(ACK_KEYS.map(key => [key, String(fields[key] || '').trim() || ACK_DOTS])),
    ackCompanyName: String(fields.ackCompanyName || fields.companyName || '').trim(),
    ackAddress: String(fields.ackAddress || addressLine(fields) || '').trim(),
    letterXml: letterXml(shortenLetter(fields, letterLevel)),
    aboutXml: aboutXml(fields, aboutLevel),
    amPhoneClause: String(fields.amPhone || '').trim() ? `on ${String(fields.amPhone).trim()} ` : '',
    components: componentsData,
    investment: (fields.investment || []).filter(r => String(r.description || r.name || '').trim()).map(r => ({
      description: r.description || r.name,
      name: r.description || r.name,
      bandwidth: r.bandwidth || r.speed || '—',
      speed: r.bandwidth || r.speed || '—',
      qosTemplate: String(r.qosTemplate || r.qos || '').trim() || 'N/A',
      qos: String(r.qosTemplate || r.qos || '').trim() || 'N/A',
      oneTimeCharge: formatLKR(r.oneTimeCharge ?? r.oneTime),
      oneTime: formatLKR(r.oneTimeCharge ?? r.oneTime),
      monthlyRental: formatLKR(r.monthlyRental ?? r.monthly),
      monthly: formatLKR(r.monthlyRental ?? r.monthly),
    })),
    requirementsXml,
    termsAndConditionsXml: termsAndConditionsXml(selectedProducts),
    ...Object.fromEntries(tocPages.map((n, i) => [`toc${i}`, String(n)])),
  };

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  // linebreaks: Enter typed in an edit box becomes a real line break; missing values print empty
  doc.render(data);
  // Fills every placeholder and table row
  if (networkBreak) {
    const out = doc.getZip();
    const docXml = out.file('word/document.xml').asText();
    const heading = '<w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="240"/>';
    // The NETWORK ARCHITECTURE heading's properties, as set by scripts/fix_template_layout.py
    if (docXml.includes(heading)) out.file('word/document.xml', docXml.replace(heading, '<w:pStyle w:val="Heading2"/><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0"/>'));
    // NETWORK ARCHITECTURE heading starts a new page, so it and its map stay together
  }
  return {
    buffer: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    baseName: `SLT_Proposal_${String(fields.companyName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`,
    // e.g. SLT_Proposal_John_Keells_Holdings_PLC (extension added by the route)
  };
}

async function pdfPageTexts(pdf) {
  const texts = [];
  await pdfParse(pdf, {
    pagerender: page => page.getTextContent().then(tc => {
      const t = tc.items.map(it => it.str).join('').replace(/\s+/g, '');
      texts.push(t);
      return t;
    }),
  });
  return texts;
  // Text of every PDF page, in order, with spaces removed (headings are letter-spaced in the PDF)
}

function pageOf(texts, text, from = 2) {
  const t = text.replace(/\s+/g, '');
  return texts.findIndex((p, k) => k >= from && p.includes(t));
  // PDF page index of the first page (after cover + Contents) containing `text`, or -1
}

function letterFits(texts) {
  const letter = pageOf(texts, 'Dear Sir/ Madam');
  return letter !== -1 && pageOf(texts, 'Yours sincerely') === letter && pageOf(texts, 'COMPANY OVERVIEW') === letter + 1;
  // "Yours sincerely" on the same page as "Dear Sir/ Madam", and nothing (signature line, empty lines) spilled onto an extra page
}

function aboutFits(texts) {
  const heading = pageOf(texts, ABOUT_HEADING);
  return heading === -1 || pageOf(texts, 'PROPOSED SOLUTION', heading) === heading + 1;
  // The section is one page when PROPOSED SOLUTION starts on the very next page
}

function networkFits(texts) {
  const heading = pageOf(texts, 'NETWORK ARCHITECTURE');
  return heading === -1 || pageOf(texts, 'SOLUTION DIAGRAM', heading) === heading + 1;
  // The map sits between the heading and the SOLUTION DIAGRAM page; if the map was pushed to its own page, SOLUTION DIAGRAM is 2 pages on
}

async function tocPagesFromPdf(pdf) {
  const texts = await pdfPageTexts(pdf);
  const norm = s => s.replace(/\s+/g, '');
  let from = 2;
  // Headings come after the cover (page index 0) and the Contents page (index 1)
  return TOC_HEADINGS.map((h, i) => {
    const idx = texts.findIndex((t, k) => k >= from && norm(t).includes(norm(h)));
    if (idx === -1) return TOC_TEMPLATE_PAGES[i];
    from = idx;
    return idx;
    // The cover has no number, so the printed page number = PDF page index
  });
}

async function resolveLeadLogo(fields) {
  if (!fields) return fields;
  let logoUrl = fields.leadLogo || fields.logo || fields.logoUrl || '';
  if (typeof logoUrl !== 'string') return fields;
  logoUrl = logoUrl.trim();

  // Extract domain from website or fields if available
  const rawDomain = (fields.website || fields.domain || '')
    .replace(/https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').trim();

  // Already base64 data URI or raw base64 string
  if (logoUrl.startsWith('data:image/') || (/^[A-Za-z0-9+/=]+$/.test(logoUrl) && logoUrl.length > 100)) {
    // Skip SVG data URIs — Word cannot display SVG inline images
    if (logoUrl.includes('data:image/svg')) return { ...fields, leadLogo: '' };
    return { ...fields, leadLogo: logoUrl };
  }

  // Extract domain candidate
  let logoDomain = rawDomain;
  if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
    try {
      const u = new URL(logoUrl);
      if (u.hostname.includes('unavatar.io')) {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0]) logoDomain = parts[0].replace(/^www\./i, '');
      } else if (!logoDomain) {
        logoDomain = u.hostname.replace(/^www\./i, '');
      }
    } catch (e) {}
  }

  // Candidate URLs in priority order:
  // 1. Google gstatic high-res favicon API (returns crisp 128px PNG for businesses and banks)
  // 2. Google s2 favicon API
  // 3. User-provided logoUrl (if not unavatar without fallback=false)
  // 4. unavatar with fallback=false (so it never returns the unavatar robot smiley SVG placeholder)
  const candidateUrls = [];
  if (logoDomain && logoDomain.includes('.')) {
    candidateUrls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${logoDomain}&size=128`);
    candidateUrls.push(`https://www.google.com/s2/favicons?domain=${logoDomain}&sz=128`);
  }
  if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
    if (logoUrl.includes('unavatar.io')) {
      const cleanUnavatar = logoUrl.includes('fallback=false') ? logoUrl : `${logoUrl.split('?')[0]}?fallback=false`;
      candidateUrls.push(cleanUnavatar);
    } else {
      candidateUrls.push(logoUrl);
    }
  }

  for (const url of candidateUrls) {
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
      if (resp && resp.status === 200 && resp.data && resp.data.length > 100) {
        const ct = (resp.headers['content-type'] || 'image/png').split(';')[0].trim().toLowerCase();
        // Skip SVG, HTML, XML, text — Word cannot display SVG inline images
        if (ct.includes('svg') || ct.includes('html') || ct.includes('text') || ct.includes('xml')) {
          continue;
        }
        const buf = resp.data;
        if (buf.slice(0, 5).toString('ascii').toLowerCase() === '<?xml' || buf.slice(0, 4).toString('ascii').toLowerCase() === '<svg') {
          continue;
        }
        // Verify raster image magic bytes
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
        const isWebp = buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
        const isGif = buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'GIF8';
        if (isPng || isJpg || isWebp || isGif) {
          const b64 = Buffer.from(buf).toString('base64');
          return { ...fields, leadLogo: `data:${ct};base64,${b64}` };
        }
      }
    } catch (err) {
      // Continue to next candidate
    }
  }

  // No valid raster logo found — clear field so styled company name text fallback is used
  return { ...fields, leadLogo: '' };
}

async function renderProposal(rawFields, format = 'docx') {
  const fields = await resolveLeadLogo(rawFields);
  if (format === 'docx') {
    return renderDocx(fields);
  }

  const layout = { letterLevel: 0, aboutLevel: 0, networkBreak: false };
  const first = buildDocx(fields, TOC_TEMPLATE_PAGES, layout);
  let pdf;
  try {
    pdf = await docxToPdf(first.buffer);
    const zip = new PizZip(first.buffer);
    const docXml = zip.file('word/document.xml') ? zip.file('word/document.xml').asText() : '';
    const hasManualTocTags = /\{toc\d+\}/.test(docXml);

    if (hasManualTocTags) {
      try {
        const realToc = await tocPagesFromPdf(pdf);
        const finalDoc = buildDocx(fields, realToc, layout);
        pdf = await docxToPdf(finalDoc.buffer);
        return { buffer: pdf, baseName: finalDoc.baseName };
      } catch (tocErr) {
        return { buffer: pdf, baseName: first.baseName };
      }
    }
    return { buffer: pdf, baseName: first.baseName };
  } catch (err) {
    if (format === 'pdf') throw err;
    console.warn('[proposal] PDF conversion failed:', err.message);
    return first;
    // Word export still works, with the template's page numbers
  }
}

function findLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    // Optional override in backend/.env
    'C:\\Program Files\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    // Default install locations on Windows
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    // Linux (Docker) and macOS
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
  // First one that exists, or null if LibreOffice isn't installed
}

let pdfQueue = Promise.resolve();
// LibreOffice can't run two conversions at once with the same profile, so conversions wait their turn

function docxToPdf(docxBuffer) {
  const job = pdfQueue.then(() => convertDocxToPdf(docxBuffer));
  pdfQueue = job.catch(() => {});
  return job;
}

const WORD_PDF_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'convert_docx_to_pdf_word.ps1');

function convertWithWordComToPdf(docxPath, pdfPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32' || !fs.existsSync(WORD_PDF_SCRIPT)) {
      return reject(new Error('Word COM PDF script unavailable'));
    }
    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', WORD_PDF_SCRIPT, docxPath, pdfPath], { timeout: 60000 }, (err) => {
      if (err) return reject(err);
      if (!fs.existsSync(pdfPath)) return reject(new Error('PDF output not generated by Word COM'));
      resolve();
    });
  });
}

function convertDocxToPdf(docxBuffer) {
  return new Promise(async (resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-proposal-'));
    const docxPath = path.join(dir, 'proposal.docx');
    const pdfPath = path.join(dir, 'proposal.pdf');
    fs.writeFileSync(docxPath, docxBuffer);

    // 1. Try native Microsoft Word COM direct conversion first (100% pixel-perfect layout preservation)
    try {
      await convertWithWordComToPdf(docxPath, pdfPath);
      const pdfBytes = fs.readFileSync(pdfPath);
      fs.rmSync(dir, { recursive: true, force: true });
      return resolve(pdfBytes);
    } catch (wordErr) {
      console.warn('[proposal/pdf] Native Word COM PDF conversion skipped, trying LibreOffice:', wordErr.message);
    }

    // 2. Fallback to LibreOffice if Word COM is unavailable
    const soffice = findLibreOffice();
    if (!soffice) {
      fs.rmSync(dir, { recursive: true, force: true });
      return reject(Object.assign(new Error('PDF export needs Microsoft Word or LibreOffice on the server.'), { status: 501 }));
    }

    const profileUri = 'file:///' + path.join(dir, 'profile').replace(/\\/g, '/');
    execFile(soffice, ['--headless', `-env:UserInstallation=${profileUri}`, '--convert-to', 'pdf', '--outdir', dir, docxPath], { timeout: 90000 }, (err) => {
      try {
        if (err) throw err;
        resolve(fs.readFileSync(pdfPath));
      } catch (e) {
        reject(Object.assign(new Error(`PDF conversion failed: ${e.message}`), { status: 500 }));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { PRODUCTS, PRODUCT_BY_ID, suggestFor, recommendFor, generateFields, applyAgentProposal, renderDocx, renderProposal, docxToPdf };
// Used by routes/proposals.js
