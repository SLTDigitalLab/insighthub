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
// SLT proposal template with every red field turned into a {placeholder}
const DIAGRAM_DIR = path.join(__dirname, '..', 'templates', 'diagrams');
// Network diagrams: one PNG per product id (e.g. bil.png). A product without one shows its requirement text only.
const PRODUCTS = require('../data/products.json');
// 70 products parsed from "SLTMobitel Product & Solution Portfolio - Knowledge Base v1.1" (the same PDF that is in the vector DB)
const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
// Quick lookup: PRODUCT_BY_ID['bil'] -> the BIL product

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// So the date prints like the sample: "08 AUG 2025"
const SOLUTION_SUMMARY = 'After careful study on your requirement, we have designed following solutions for your requirements. Total solution includes following components.';
// The template's own intro sentence above the Proposed Solution table
const ACK_DEFAULTS = { ackAddressee1: 'Regional Enterprise Business Manager', ackAddressee2: 'Sri Lanka Telecom PLC' };
// The template's own addressee lines on the Customer Acknowledgements page
const ACK_DOTS = `${'…'.repeat(25)}.`;
// The template's dotted line ("……….") printed when a Customer Acknowledgements line is left empty
const ACK_ROWS = [['Company Name', 'ackCompanyName'], ['Address', 'ackAddress'], ['Solution', 'ackSolution'], ['Initial &amp; Monthly Charges', 'ackCharges'], ['Commitment Period', 'ackCommitment']];
// Label (as in the template XML) -> field, for the 5 lines the customer fills in
const LETTER_WORD_LIMITS =[null, 25, 20, 16, 12, 9];
// Letter shortening steps tried after a render if the letter spills off page 3: level 0 = as written,
// then every paragraph cut to 1 sentence of at most N words (no product paragraph is ever left out)
const CELL_MAX_CHARS = { station: 30, accessMedia: 30, ntu: 60 };
// Proposed Solution cells longer than this would wrap past 2 lines in their column
const CONTENT_WIDTH_EMU = 10408 * 635;
// Text width of the body pages (page 11910 twips - 540 right margin - 720 left indent - 242 right indent), in EMU
const TOC_HEADINGS = ['COMPANY OVERVIEW', 'OUR STRENGTHS', 'WHY WITH US', 'YOUR REQUIREMENTS', 'PROPOSED SOLUTION', 'NETWORK ARCHITECTURE', 'SOLUTION DIAGRAM', 'YOUR INVESTMENT', 'YOUR INVESTMENT', 'YOUR INVESTMENT', 'YOUR INVESTMENT', 'TERMS & CONDITIONS', 'CUSTOMER ACKNOWLEDGEMENTS', 'SME SOLUTIONS', 'AWARDS AND ACCOLADES', 'CONTACT US'];
// Page heading for each Contents line {toc0}..{toc15} (the three OPTION lines sit on the investment page)
const TOC_TEMPLATE_PAGES = [3, 5, 6, 7, 8, 8, 9, 10, 10, 10, 10, 11, 12, 13, 14, 15];
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
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  // "01 OCT 2026"
}

function makeRefNo(d = new Date()) {
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `IH-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  // "IH-20261001-4F7K" — date + 4 random characters so refs don't clash
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
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="${before}" w:after="${after}"/><w:ind w:left="720" w:right="242"/><w:jc w:val="both"/></w:pPr>${runsXml}</w:p>`;
  // One paragraph in the same style/indent as the original "Your Requirements" text
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
  return `<w:p><w:pPr><w:keepLines/><w:spacing w:before="60" w:after="240"/><w:ind w:left="720"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${esc(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  // Standard Word inline picture XML pointing at the image relationship rId
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
    if (!own || !fs.existsSync(own)) return;
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
    // Typed by the rep on the edit screen; never generated
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
    requirements: products.map(p => ({ id: p.id, title: p.name, text: firstSentence(p.description) })),
    // Page 7: one requirement per product; id links it to its network diagram
    solutionSummary: SOLUTION_SUMMARY,
    components: products.map(p => ({ service: p.name, station, accessMedia: p.accessMedia, ntu: p.ntu })),
    // Page 8 table: one row per product
    investment: products.map(p => ({ description: p.name, bandwidth: '', oneTimeCharge: '', monthlyRental: '' })),
    // Investment table: the rep types the prices on the edit screen
    commitmentPeriod: defaults.commitmentPeriod || '1 Year',
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
    rebmArea: defaults.rebmArea || '',
    // Secondary contact + acknowledgement page, from backend/.env
    ackAddressee1: ACK_DEFAULTS.ackAddressee1,
    ackAddressee2: ACK_DEFAULTS.ackAddressee2,
    ackDate: formatDate(),
    // Customer Acknowledgements page: addressee lines and "proposal submitted on <date>"
    ackPrefill: true,
    ackCompanyName: business.name,
    ackAddress: String(business.address || '').trim(),
    ackSolution: joinNames(products.map(p => p.name)),
    ackCharges: '',
    ackCommitment: '',
    // The 5 lines the customer fills in; Company / Address / Solution pre-filled while ackPrefill is on, the rest empty
    // (an empty one prints the template's dotted line)
  };
  // These are ALL the red parts of the template — sent to the edit screen, then back to renderDocx
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
    requirements: fields.requirements.map((r, i) => ({ id: r.id, title: r.title, text: reqs[i] != null ? named(blankIfTbc(reqs[i]), i) : r.text })),
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
      oneTimeCharge: blankIfTbc(invest[i].oneTimeCharge),
      monthlyRental: blankIfTbc(invest[i].monthlyRental),
    } : row)),
    // Prices only ever come from n8n; anything unconfirmed stays blank
  };
}

const LETTER_RPR = '<w:rPr><w:rFonts w:ascii="Verdana" w:eastAsia="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/><w:color w:val="000000"/><w:w w:val="100"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>';
// Verdana 10.5pt, 100% scale, black, no character spacing

function linesOf(...texts) {
  return texts.flatMap(t => String(t || '').split(/\n+/)).map(s => s.trim()).filter(Boolean);
  // Each line / blank-line-separated block of an edit box becomes its own paragraph
}

function letterXml(fields) {
  return linesOf(fields.solutionIntro1, fields.solutionIntro2)
    .map(t => `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="159"/><w:ind w:left="720"/><w:jc w:val="both"/>${LETTER_RPR}</w:pPr><w:r>${LETTER_RPR}<w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`)
    .join('') || '<w:p/>';
  // Letter body paragraphs between "We are pleased to submit…" and "We look forward…"
}

function addressXml(fields) {
  return linesOf(fields.addressLine1, fields.addressLine2, fields.city)
    .map(t => `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="0"/><w:ind w:left="720"/>${LETTER_RPR}</w:pPr><w:r>${LETTER_RPR}<w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`)
    .join('') || '<w:p/>';
  // One paragraph per address line, all with the same spacing; empty lines are left out
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

function prepareAckPage(xml) {
  let out = xml
    .replace('<w:t>Regional Enterprise Business Manager</w:t>', '<w:t xml:space="preserve">{ackAddressee1}</w:t>')
    .replace('<w:t xml:space="preserve">Sri Lanka Telecom PLC </w:t>', '<w:t xml:space="preserve">{ackAddressee2}</w:t>')
    .replace('<w:t xml:space="preserve">{proposalDate} </w:t>', '<w:t xml:space="preserve">{ackDate} </w:t>');
  // Addressee lines and "the proposal submitted on <date>" become editable (the letter keeps its own {proposalDate})
  const start = out.indexOf('Dear Sir/Madam, ');
  if (start === -1) return out;
  ACK_ROWS.forEach(([label, key]) => {
    const i = out.indexOf(`<w:t>${label}</w:t>`, start);
    if (i === -1) return;
    const p0 = Math.max(out.lastIndexOf('<w:p>', i), out.lastIndexOf('<w:p ', i));
    const p1 = out.indexOf('</w:p>', i) + '</w:p>'.length;
    const spacing = (out.slice(p0, p1).match(/<w:spacing [^>]*\/>/) || [''])[0];
    out = `${out.slice(0, p0)}<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="4320"/></w:tabs>${spacing}<w:ind w:left="4500" w:hanging="3780"/></w:pPr><w:r><w:t xml:space="preserve">${label}</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">: {${key}}</w:t></w:r></w:p>${out.slice(p1)}`;
    // Same label, same ":" position (tab stop at 4320 twips, where the template's tabs land), then the value or the dotted line;
    // a long value wraps under itself, not under the label
  });
  return out;
}

function renderDocx(fields, tocPages = TOC_TEMPLATE_PAGES) {
  return buildDocx(fields, tocPages, {});
}

function buildDocx(fields, tocPages = TOC_TEMPLATE_PAGES, { letterLevel = 0, networkBreak = false } = {}) {
  if (!fields || !String(fields.companyName || '').trim()) throw Object.assign(new Error('companyName is required'), { status: 400 });
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  // Fresh copy of the template for every request
  zip.file('word/document.xml', prepareAckPage(zip.file('word/document.xml').asText()));
  // Customer Acknowledgements page: editable addressee, date and the 5 fill-in lines
  const requirementsXml = addDiagramsAndBuildRequirements(zip, Array.isArray(fields.requirements) ? fields.requirements.filter(r => String(r.title || '').trim()) : []);
  // Adds the diagram images and builds the requirements page
  const tbc = v => String(v || '').trim() || 'To be confirmed';

  const data = {
    ...fields,
    companyNameUpper: String(fields.companyName).toUpperCase(),
    // Cover page uses capitals
    refNo: String(fields.refNo || '').trim(),
    // Whatever the rep typed prints on the cover, every "Proposal Ref. No." header line and the acknowledgement sentence; empty prints nothing
    ackAddressee1: fields.ackAddressee1 ?? ACK_DEFAULTS.ackAddressee1,
    ackAddressee2: fields.ackAddressee2 ?? ACK_DEFAULTS.ackAddressee2,
    ackDate: fields.ackDate ?? fields.proposalDate,
    // Older saved proposals without these keys print the template's text
    ...Object.fromEntries(ACK_ROWS.map(([, key]) => [key, String(fields[key] || '').trim() || ACK_DOTS])),
    // Value typed on the edit screen, or the template's dotted line for the customer to fill in by hand
    letterXml: letterXml(shortenLetter(fields, letterLevel)),
    addressXml: addressXml(fields),
    amPhoneClause: String(fields.amPhone || '').trim() ? `on ${String(fields.amPhone).trim()} ` : '',
    // "reach out to Nimal on 0771234567 should you…" or, with no phone, "reach out to Nimal should you…"
    components: (fields.components || []).filter(c => String(c.service || '').trim()).map(c => ({
      service: c.service,
      station: tbc(shortCell(stationCell(c.station), CELL_MAX_CHARS.station)),
      accessMedia: tbc(shortCell(c.accessMedia, CELL_MAX_CHARS.accessMedia)),
      ntu: tbc(shortCell(c.ntu, CELL_MAX_CHARS.ntu)),
    })),
    // Station = town only; long cells cut to ~2 lines; empty Station / Access Media / NTU cells print "To be confirmed"
    investment: (fields.investment || []).filter(r => String(r.description || '').trim()).map(r => ({
      description: r.description,
      bandwidth: r.bandwidth || '—',
      oneTimeCharge: formatLKR(r.oneTimeCharge),
      monthlyRental: formatLKR(r.monthlyRental),
    })),
    // Prices formatted as 100,000.00; blank prints "On request"
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
  const layout = { letterLevel: 0, networkBreak: false };
  let first = buildDocx(fields, TOC_TEMPLATE_PAGES, layout);
  let pdf;
  try {
    pdf = await docxToPdf(first.buffer);
  } catch (err) {
    if (format === 'pdf') throw err;
    console.warn('[proposal] Layout not measured:', err.message);
    return first;
    // No LibreOffice: Word export still works, with the template's page numbers
  }
  let texts = await pdfPageTexts(pdf);
  const rerender = async () => {
    first = buildDocx(fields, TOC_TEMPLATE_PAGES, layout);
    pdf = await docxToPdf(first.buffer);
    texts = await pdfPageTexts(pdf);
  };

  while (!letterFits(texts) && layout.letterLevel < LETTER_WORD_LIMITS.length - 1) {
    layout.letterLevel += 1;
    await rerender();
  }
  // Letter spilled off page 3: shorten the letter paragraphs one step and render again
  if (!letterFits(texts)) console.warn('[proposal] Letter still longer than one page at the shortest setting');
  if (!networkFits(texts)) {
    layout.networkBreak = true;
    await rerender();
  }
  // NETWORK ARCHITECTURE and its map on different pages: move the heading to a new page

  const pages = await tocPagesFromPdf(pdf);
  if (pages.every((n, i) => n === TOC_TEMPLATE_PAGES[i])) return format === 'pdf' ? { buffer: pdf, baseName: first.baseName } : first;
  // Numbers already right: no second render needed
  const final = buildDocx(fields, pages, layout);
  // Second render with the measured page numbers in the Contents page
  return format === 'pdf' ? { buffer: await docxToPdf(final.buffer), baseName: final.baseName } : final;
}

function findLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    // Optional override in backend/.env
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
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

function convertDocxToPdf(docxBuffer) {
  return new Promise((resolve, reject) => {
    const soffice = findLibreOffice();
    if (!soffice) {
      return reject(Object.assign(new Error('PDF export needs LibreOffice on the backend machine. Install it (or set LIBREOFFICE_PATH in backend/.env), or export Word and use Save as PDF.'), { status: 501 }));
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-proposal-'));
    // Private temp folder for this one conversion
    const docxPath = path.join(dir, 'proposal.docx');
    fs.writeFileSync(docxPath, docxBuffer);
    execFile(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, docxPath], { timeout: 90000 }, (err) => {
      // LibreOffice opens the Word file without a window and saves proposal.pdf next to it
      try {
        if (err) throw err;
        resolve(fs.readFileSync(path.join(dir, 'proposal.pdf')));
      } catch (e) {
        reject(Object.assign(new Error(`PDF conversion failed: ${e.message}`), { status: 500 }));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        // Always clean up the temp files
      }
    });
  });
}

module.exports = { PRODUCTS, PRODUCT_BY_ID, suggestFor, makeRefNo, generateFields, applyAgentProposal, renderDocx, renderProposal, docxToPdf };
// Used by routes/proposals.js
