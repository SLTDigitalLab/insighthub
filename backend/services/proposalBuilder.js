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

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'proposal_template.docx');
// SLT proposal template (built by scripts/make_template.py + fix_template_layout.py) with every variable part as a {placeholder}
const DIAGRAM_DIR = path.join(__dirname, '..', 'templates', 'diagrams');
// Network diagrams: one PNG per product id (e.g. bil.png). A product without one shows its requirement text only.
const PRODUCTS = require('../data/products.json');
// 70 products parsed from "SLTMobitel Product & Solution Portfolio - Knowledge Base v1.1" (the same PDF that is in the vector DB)
const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
// Quick lookup: PRODUCT_BY_ID['bil'] -> the BIL product

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
  { match: /hotel|resort|villa|guest ?house|inn|lodge|hostel|bungalow/i, ids: ['bil', 'managed-wifi-solutions', 'enterprise-tv', 'managed-firewall', 'surveillance-security-solutions', 'univo'] },
  { match: /bank|finance|insurance|leasing|credit|microfinance/i, ids: ['premium-vpn', 'sd-wan', 'managed-firewall', 'mdr', 'ddos-protection-service', 'backup-services'] },
  { match: /hospital|clinic|medical|pharmacy|health|channel/i, ids: ['integrated-internet-service', 'enterprise-wifi', 'enterprise-premium-cloud', 'backup-services', 'queue-management-system', 'surveillance-security-solutions'] },
  { match: /school|college|university|institute|academy|tuition|campus|education/i, ids: ['data-one', 'enterprise-wifi', 'slt-esiphala', 'akaza-lms', 'google-workspace', 'surveillance-security-solutions'] },
  { match: /restaurant|cafe|café|bakery|food|bar|pub/i, ids: ['data-one', 'cloud-pos', 'managed-wifi-solutions', 'surveillance-security-solutions', 'peotv-biz'] },
  { match: /shop|store|supermarket|retail|mall|boutique|pharma|hardware/i, ids: ['data-one', 'cloud-pos', 'ssl-vpn', 'apn', 'surveillance-security-solutions'] },
  { match: /factory|manufactur|industr|logistic|transport|warehouse|garment|apparel/i, ids: ['sd-wan', 'integrated-internet-service', 'fleet-management-service', 'akaza-erp', 'surveillance-security-solutions'] },
  { match: /software|it |technology|tech|digital|agency|consult|office|company|corporate/i, ids: ['bil', 'enet', 'managed-firewall', 'microsoft-365-enterprise', 'univo', 'enterprise-premium-cloud'] },
];
// Google Maps category -> products to highlight as "Suggested" (the rep can still pick anything)
const DEFAULT_SUGGESTIONS = ['bil', 'data-one', 'managed-firewall', 'univo', 'microsoft-365-enterprise'];
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
  return rule ? rule.ids : DEFAULT_SUGGESTIONS;
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

function textPara(runsXml, { before = 120, after = 60, keepNext = false } = {}) {
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/>${keepNext ? '<w:keepNext/>' : ''}<w:widowControl/><w:spacing w:before="${before}" w:after="${after}"/><w:ind w:left="360" w:right="360"/><w:jc w:val="both"/></w:pPr>${runsXml}</w:p>`;
  // widowControl: the template's Body Text style turns it off, and without it Word splits "keep with next" groups across pages
  // One body-text paragraph, lined up with the section heading bar above it
}

function run(text, { bold = false, color = null } = {}) {
  return `<w:r><w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  // One piece of text, optionally bold/coloured
}

function imagePara(rId, docPrId, name, size) {
  const cx = CONTENT_WIDTH_EMU;
  // Image width: the full text width of the page
  const cy = Math.round(cx * size.h / size.w);
  // Height keeps the diagram's aspect ratio
  return `<w:p><w:pPr><w:keepLines/><w:spacing w:before="60" w:after="240"/><w:ind w:left="360"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${esc(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  // Standard Word inline picture XML pointing at the image relationship rId
}

function keyFeaturesXml(product, beforeDiagram) {
  const features = product ? product.features.map(f => String(f || '').trim()).filter(Boolean) : [];
  if (!features.length) return '';
  // No features (or a requirement the rep added by hand) = no "Key Features" label at all
  return textPara(run('Key Features', { bold: true }), { before: 100, after: 20, keepNext: true })
    + features.map((f, j) => `<w:p><w:pPr><w:pStyle w:val="BodyText"/>${j < features.length - 1 || beforeDiagram ? '<w:keepNext/>' : ''}<w:widowControl/><w:spacing w:before="20" w:after="20"/><w:ind w:left="720" w:right="360" w:hanging="300"/></w:pPr><w:r><w:t>•</w:t></w:r><w:r><w:tab/></w:r>${run(f)}</w:p>`).join('');
  // "Key Features" label + one "•" bullet per feature, word for word from the knowledge base (products.json, parsed from the
  // Portfolio PDF); a long feature wraps under its own text. keepNext keeps the list with the diagram that follows it.
}

function addDiagramsAndBuildRequirements(zip, requirements) {
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = zip.file(relsPath).asText();
  // List of files (images etc.) the document links to
  let xml = '';
  requirements.forEach((r, i) => {
    xml += textPara(run(`${i + 1}.  ${r.title}`, { bold: true, color: '0B2A6F' }), { before: i === 0 ? 120 : 280, keepNext: true });
    // Numbered requirement title in SLT navy (editable by the rep)
    if (String(r.text || '').trim()) xml += textPara(run(r.text), { before: 40, keepNext: true });
    // Requirement description (editable by the rep)
    const product = PRODUCT_BY_ID[r.id];
    const own = product && path.join(DIAGRAM_DIR, `${product.id}.png`);
    const hasDiagram = !!own && fs.existsSync(own);
    if (r.showFeatures !== false) xml += keyFeaturesXml(product, hasDiagram);
    // The product's Key Features from the knowledge base, between its description and its diagram,
    // unless the rep unticked "Show Key Features" (missing = shown, so older saved proposals still get them)
    if (!hasDiagram) return;
    // A requirement the rep added by hand, or a product without its own diagram, shows its text only
    const buf = fs.readFileSync(own);
    const mediaName = `ih_diagram_${i + 1}.png`;
    zip.file(`word/media/${mediaName}`, buf);
    // Copies the image into the .docx
    const rId = `rIdIH${i + 1}`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`);
    // Registers the image so the document can reference it
    xml += imagePara(rId, 9000 + i, `${product.name} diagram`, pngSize(buf));
    // The diagram goes under the requirement
  });
  zip.file(relsPath, rels);
  // Saves the updated relationships
  return xml || textPara(run(''));
  // Raw XML that replaces {@requirementsXml} on the "Your Requirements" page
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
  const town = String(business.city || '').trim() || localityOf(business.address);
  const inSriLanka = /sri lanka/i.test(String(business.address || ''));
  const type = businessType(business.category) || 'a business';
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
  // 2–3 sentences; nothing about size, services, awards or years, because none of that is known
}

function reasonFor(product, sector) {
  const sentence = firstSentences(product.description, 1);
  if (sector && sector.words.test(sentence) && sentence.split(' ').length <= 20) return sentence;
  // The catalogue's own first sentence when it names this kind of business ("… for hotels, resorts …") and is short
  const feature = String(product.features[0] || '').trim().replace(/\.$/, '');
  return feature ? `${feature}.` : shortProductSentence(product.description, product, 18);
  // Otherwise its first key feature from the catalogue
}

function recommendFor(business = {}, productIds = []) {
  const sector = sectorFor(business.category);
  const rule = SUGGESTIONS.find(r => r.match.test(` ${business.category || ''} `));
  const mentions = sector
    ? PRODUCTS.map(p => ({ id: p.id, n: (`${p.name} ${p.description} ${p.features.join(' ')}`.match(new RegExp(sector.words.source, 'gi')) || []).length }))
      .filter(m => m.n > 0).sort((a, b) => b.n - a.n).map(m => m.id)
    : [];
  // Catalogue products whose own text mentions this sector, most mentions first
  const typed = [...new Set([...(rule ? rule.ids : []), ...mentions])].filter(id => PRODUCT_BY_ID[id]);
  const ticked = productIds.filter(id => PRODUCT_BY_ID[id]);
  const pick = [];
  const add = (ids, upTo) => ids.forEach(id => { if (pick.length < upTo && !pick.includes(id)) pick.push(id); });
  add(typed, 3);
  // 1. Up to 3 products for this business type
  add(ticked, MAX_RECOMMENDATIONS);
  // 2. Then the products the rep ticked for this proposal
  add(typed, MAX_RECOMMENDATIONS);
  add(DEFAULT_SUGGESTIONS, MIN_RECOMMENDATIONS);
  // 3. Fill with more business-type products; the general list only if fewer than 3 were found
  return pick.map((id, i) => ({ id, name: PRODUCT_BY_ID[id].name, reason: reasonFor(PRODUCT_BY_ID[id], sector), highPriority: i < 2 }));
  // Exact catalogue names; the first two (the best business-type matches) are marked high priority
}

function generateFields({ business, productIds = [], user = {}, refNo, defaults = {} }) {
  const products = productIds.map(id => PRODUCT_BY_ID[id]).filter(Boolean);
  // Turns the ticked ids into full product objects (unknown ids are ignored)
  if (!products.length) throw Object.assign(new Error('Select at least one product'), { status: 400 });
  if (!business || !String(business.name || '').trim()) throw Object.assign(new Error('business.name is required'), { status: 400 });

  const addr = splitAddress(business.address);
  const station = business.city || localityOf(business.address);
  // SLT station column = the customer's city

  return {
    companyName: business.name,
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
    solutionIntro1: products[0].description,
    // First letter paragraph = description of the first product, from the knowledge base
    solutionIntro2: products.length > 1
      ? `In addition, the proposed solution includes ${joinNames(products.slice(1).map(p => p.name))}. Each requirement and its solution diagram is detailed in the following pages of this proposal.`
      : `Key features include ${products[0].features.slice(0, 3).map(f => f.replace(/\.$/, '')).join('; ')}.`,
    // Second paragraph: the other products, or the key features if only one was ticked
    requirements: products.map(p => ({ id: p.id, title: p.name, text: firstSentence(p.description), showFeatures: true })),
    // Page 6: one requirement per product; id links it to its network diagram
    aboutDescription: describeBusiness(business),
    recommendations: recommendFor(business, productIds),
    // Page 7 "About you and how we can help you": facts-only description + 3–5 catalogue products (2 high priority)
    solutionSummary: SOLUTION_SUMMARY,
    components: products.map(p => ({ service: p.name, station, accessMedia: p.accessMedia, ntu: p.ntu })),
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

  const agentParagraphs = Array.isArray(letter.productParagraphs) ? letter.productParagraphs : [];
  const many = products.length >= 4;
  // 4+ products: one short sentence (~20 words) each; 1-3 products: up to 2 sentences each
  const productParagraphs = products.map((p, i) => {
    const text = dropFixedLetterText(named(agentParagraphs[i], i)) || (p ? p.description : '');
    return many ? shortProductSentence(text, p, 20) : firstSentences(text, 2);
  }).filter(Boolean);
  // Every selected product gets its own paragraph, in order; if n8n sent none for a product, its catalogue description is used
  const tailoredText = dropFixedLetterText(allNamed(letter.tailored));
  const tailored = many ? shortSentence(tailoredText, 20) : firstSentences(tailoredText, 2);
  // The tailored paragraph is optional: with 4+ products it is dropped if it can't be said cleanly in ~20 words
  // Whether it all fits on page 3 is checked on the rendered PDF (see renderProposal)

  return {
    ...fields,
    // Company, ref, date, address, solutionName, solutionSummary, contacts and commitment stay as the builder computed them
    solutionIntro1: tailored,
    // First letter paragraph = the customer-tailored text
    solutionIntro2: productParagraphs.length ? productParagraphs.join('\n\n') : fields.solutionIntro2,
    // Then one paragraph per product (each blank-line-separated block prints as its own paragraph)
    requirements: fields.requirements.map((r, i) => ({ id: r.id, title: r.title, text: reqs[i] != null ? named(blankIfTbc(reqs[i]), i) : r.text, showFeatures: r.showFeatures !== false })),
    // id/title (catalogue name) kept so the per-product network diagram still matches
    components: fields.components.map((c, i) => (table[i] ? {
      service: c.service,
      // Catalogue name, not n8n's wording
      station: stationCell(blankIfTbc(table[i].station)),
      // Only the town, never the full address ('' prints "To be confirmed")
      accessMedia: shortCell(blankIfTbc(table[i].accessMedia), CELL_MAX_CHARS.accessMedia),
      ntu: shortCell(blankIfTbc(table[i].ntu), CELL_MAX_CHARS.ntu),
    } : c)),
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
  let xml = linesOf(description).map(t => textPara(run(t), { before: 160, after: 80 })).join('');
  // The description, one paragraph per typed paragraph
  if (recs.length) {
    xml += textPara(run('How we can help you', { bold: true, color: '0B2A6F' }), { before: 280, after: 40, keepNext: true });
    recs.forEach((r, i) => {
      xml += textPara(run(`${i + 1}.  ${PRODUCT_BY_ID[r.id].name}`, { bold: true, color: '0B2A6F' }) + (r.highPriority ? PRIORITY_TAG : ''), { before: i ? 200 : 120, after: 0, keepNext: true });
      // Product name exactly as in the catalogue, plus the HIGH PRIORITY label when ticked
      if (String(r.reason || '').trim()) xml += textPara(run(String(r.reason).trim()), { before: 40, after: 0 });
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

function renderDocx(fields, tocPages = TOC_TEMPLATE_PAGES) {
  return buildDocx(fields, tocPages, {});
}

function buildDocx(fields, tocPages = TOC_TEMPLATE_PAGES, { letterLevel = 0, aboutLevel = 0, networkBreak = false } = {}) {
  if (!fields || !String(fields.companyName || '').trim()) throw Object.assign(new Error('companyName is required'), { status: 400 });
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  // Fresh copy of the template for every request
  const requirementsXml = addDiagramsAndBuildRequirements(zip, Array.isArray(fields.requirements) ? fields.requirements.filter(r => String(r.title || '').trim()) : []);
  // Adds the diagram images and builds the requirements page
  const tbc = v => String(v || '').trim() || 'To be confirmed';

  const data = {
    ...fields,
    refNo: String(fields.refNo || '').trim(),
    // Whatever the rep typed prints on the cover, every "Proposal Ref. No." header line and the acknowledgement sentence; empty prints nothing
    ackAddressee1: fields.ackAddressee1 ?? ACK_DEFAULTS.ackAddressee1,
    ackAddressee2: fields.ackAddressee2 ?? ACK_DEFAULTS.ackAddressee2,
    ackDate: fields.ackDate ?? fields.proposalDate,
    // Older saved proposals without these keys print the template's text
    ...Object.fromEntries(ACK_KEYS.map(key => [key, String(fields[key] || '').trim() || ACK_DOTS])),
    // Value typed on the edit screen, or the template's dotted line for the customer to fill in by hand
    letterXml: letterXml(shortenLetter(fields, letterLevel)),
    aboutXml: aboutXml(fields, aboutLevel),
    // "About you and how we can help you" page, shortened only if it didn't fit on one page
    address: addressLine(fields),
    amPhoneClause: String(fields.amPhone || '').trim() ? `on ${String(fields.amPhone).trim()} ` : '',
    // "reach out to Nimal on 0771234567 should you…" or, with no phone, "reach out to Nimal should you…"
    components: (fields.components || []).filter(c => String(c.service || '').trim()).map(c => ({
      service: c.service,
      station: tbc(shortCell(stationCell(c.station), CELL_MAX_CHARS.station)),
      accessMedia: tbc(shortCell(c.accessMedia, CELL_MAX_CHARS.accessMedia)),
      media: tbc(shortCell(c.accessMedia, CELL_MAX_CHARS.accessMedia)), // alias for templates using {media}
      ntu: tbc(shortCell(c.ntu, CELL_MAX_CHARS.ntu)),
    })),
    // Station = town only; long cells cut to ~2 lines; empty Station / Access Media / NTU cells print "To be confirmed"
    investment: (fields.investment || []).filter(r => String(r.description || '').trim()).map(r => ({
      description: r.description,
      name: r.description, // alias for templates using {name}
      bandwidth: r.bandwidth || '—',
      speed: r.bandwidth || '—', // alias for templates using {speed}
      qosTemplate: String(r.qosTemplate || '').trim() || 'N/A',
      qos: String(r.qosTemplate || '').trim() || 'N/A', // alias for templates using {qos}
      oneTimeCharge: formatLKR(r.oneTimeCharge),
      oneTime: formatLKR(r.oneTimeCharge), // alias for templates using {oneTime}
      monthlyRental: formatLKR(r.monthlyRental),
      monthly: formatLKR(r.monthlyRental), // alias for templates using {monthly}
    })),
    // Prices formatted as 100,000.00; blank prints "On request"; blank QoS Template prints "N/A"
    requirementsXml,
    ...Object.fromEntries(tocPages.map((n, i) => [`toc${i}`, String(n)])),
    // Contents page numbers
  };

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  // linebreaks: Enter typed in an edit box becomes a real line break; missing values print empty
  doc.render(data);
  // Fills every placeholder and table row
  if (networkBreak) {
    const out = doc.getZip();
    const xml = out.file('word/document.xml').asText();
    const heading = '<w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="240"/>';
    // The NETWORK ARCHITECTURE heading's properties, as set by scripts/fix_template_layout.py
    if (xml.includes(heading)) out.file('word/document.xml', xml.replace(heading, '<w:pStyle w:val="Heading2"/><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0"/>'));
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

async function renderProposal(fields, format = 'docx') {
  if (format === 'docx') {
    return renderDocx(fields);
  }

  const layout = { letterLevel: 0, aboutLevel: 0, networkBreak: false };
  const first = buildDocx(fields, TOC_TEMPLATE_PAGES, layout);
  let pdf;
  try {
    pdf = await docxToPdf(first.buffer);
  } catch (err) {
    if (format === 'pdf') throw err;
    console.warn('[proposal] PDF conversion failed:', err.message);
    return first;
    // Word export still works, with the template's page numbers
  }

  return { buffer: pdf, baseName: first.baseName };
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

module.exports = { PRODUCTS, PRODUCT_BY_ID, suggestFor, generateFields, applyAgentProposal, renderDocx, renderProposal, docxToPdf };
// Used by routes/proposals.js
