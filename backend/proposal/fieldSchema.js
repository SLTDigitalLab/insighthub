// The stable contract of the proposal generator: the fields the edit screen binds to.
// This is the ONLY place field names live. Templates are adapted to this list (see autoBind.js), not the other way round.
//
//   key      name used by the edit screen, the saved proposal and the render step
//   label    shown to people and used as the AI instruction heading
//   type     text | longText | table | image
//   owner    ai     - written by the AI (n8n workflow); the rep reviews it
//            system - filled in code from `source`; the rep can still edit it
//            rep    - left empty for the rep to type (prices and the customer's own lines)
//   section  cover | letter | requirements | about | solution | investment | contact | acknowledgement
//            (sections drive the preview chips; `contact` and `acknowledgement` have no chip)
//   source   (system fields) where the value comes from, see draftService.resolveSource
//   columns  (table fields) [{ key, label, source?, format?, computed? }]  (computed = made by the renderer: 'index' or 'diagram')
//              (format 'money' = 100000 -> 100,000.00); `rowsFrom: 'products'` = one row per selected product;
//              `required: true` = a row without a value in that column is not printed
//   hint     (ai fields) extra instruction for the AI that writes the value
//   mapHint  what to look for when mapping an uploaded template (see slots() below)
const FIELDS = [
  { key: 'companyName', mapHint: "The customer business name wherever it is printed as a sample: cover, letter heading, letter wording. NOT the 'Company Name :' line on the acknowledgement page (that is ackCompanyName).", label: 'Business name', type: 'text', owner: 'system', section: 'cover', source: 'company.name' },
  // mappable: false = never offered to the template mapper: the logo is placed only by the template's own {%client_logo} tag or
  // picture placeholder (services/logoService.js); the mapper used to turn that tag into a plain {leadLogo} text tag, which prints nothing
  { key: 'leadLogo', mappable: false, label: 'Client logo', type: 'image', owner: 'system', section: 'cover', source: 'company.logo' },
  { key: 'leadLogoSize', mappable: false, label: 'Client logo size', type: 'text', owner: 'rep', section: 'cover' },
  { key: 'refNo', mapHint: "The proposal reference number, in every place it is printed as a sample: cover, letter sentence, acknowledgement sentence ('...under Proposal reference number <ref>') and the page header.", label: 'Reference number', type: 'text', owner: 'system', section: 'cover', source: 'refNo' },
  { key: 'proposalDate', mapHint: "The date the proposal was submitted, in every place it is printed as a sample: cover, letter date, and the acknowledgement sentence ('...submitted on <date>').", label: 'Proposal date', type: 'text', owner: 'system', section: 'cover', source: 'today' },

  { key: 'recipientDesignation', mapHint: 'The job title of the person the letter is addressed to (a red sample or a Word field value in the letter heading).', label: 'Addressed to (job title)', type: 'text', owner: 'ai', section: 'letter', hint: 'The job title of the person at the business who would receive this proposal.' },
  { key: 'addressLine1', label: 'Address line 1', type: 'text', owner: 'system', section: 'letter', source: 'company.addressLine1' },
  { key: 'addressLine2', label: 'Address line 2', type: 'text', owner: 'system', section: 'letter', source: 'company.addressLine2' },
  { key: 'city', label: 'City', type: 'text', owner: 'system', section: 'letter', source: 'company.city' },
  { key: 'solutionName', mapHint: 'The names of the proposed solutions joined into a phrase (for example inside a sentence). Only if a red sample shows it. It is a short phrase and never a whole paragraph; if unsure answer not_found.', label: 'Solution name', type: 'text', owner: 'system', section: 'letter', source: 'products.names' },
  { key: 'solutionIntro1', label: 'Letter paragraph 1', type: 'longText', owner: 'system', section: 'letter', source: 'catalog.intro1' },
  { key: 'solutionIntro2', label: 'Letter paragraph 2', type: 'longText', owner: 'system', section: 'letter', source: 'catalog.intro2' },

  { key: 'requirements', label: 'Requirements', type: 'table', owner: 'system', section: 'requirements', rowsFrom: 'products',
    columns: [{ key: 'id', label: 'Product id', source: 'product.id' }, { key: 'title', label: 'Title', source: 'product.name' }, { key: 'text', label: 'Description', source: 'product.description' }, { key: 'showFeatures', label: 'Show features' },
      // computed when the document is filled (never stored in the edit screen's rows): the item number and the product's own diagram
      { key: 'number', label: 'Number', computed: 'index' }, { key: 'diagram', label: 'Diagram', computed: 'diagram' }] },

  { key: 'aboutDescription', label: 'About the business', type: 'longText', owner: 'ai', section: 'about', hint: 'Facts-only description of the business and what it needs. Do not invent facts; use only the company details given.' },
  { key: 'recommendations', label: 'Recommended products', type: 'table', owner: 'ai', section: 'about', hint: 'Choose 3 to 5 products from the catalogue that would help this business. Use catalogue ids only. Mark at most two as high priority.',
    columns: [{ key: 'id', label: 'Product id' }, { key: 'reason', label: 'Reason' }, { key: 'highPriority', label: 'High priority' }] },

  { key: 'solutionSummary', mapHint: 'A one or two sentence introduction to the solution components table. Only if a red sample paragraph is there; never a list or a heading; if unsure answer not_found.', label: 'Solution summary', type: 'longText', owner: 'ai', section: 'solution', hint: 'One or two sentences introducing the components table.' },
  { key: 'components', mapHint: 'The sample row of the solution components table (service, station, access media, NTU). The row must contain red sample text.', label: 'Solution components', type: 'table', owner: 'system', section: 'solution', rowsFrom: 'products',
    columns: [{ key: 'service', label: 'Service', source: 'product.service' }, { key: 'station', label: 'Station', source: 'company.locality' }, { key: 'media', label: 'Access media', source: 'product.accessMedia' }, { key: 'ntu', label: 'NTU', source: 'product.ntu' }] },

  { key: 'investment', mapHint: 'The sample row of the investment table (description, bandwidth, QoS template, one-time charge, monthly rental). The row must contain red sample text.', label: 'Investment', type: 'table', owner: 'rep', section: 'investment', rowsFrom: 'products',
    columns: [{ key: 'description', label: 'Description', source: 'product.name' }, { key: 'bandwidth', label: 'Bandwidth' }, { key: 'qosTemplate', label: 'QoS template' }, { key: 'oneTimeCharge', label: 'One-time charge', format: 'money' }, { key: 'monthlyRental', label: 'Monthly rental', format: 'money' }] },

  { key: 'amName', mapHint: "The sales account manager's name wherever it is a red sample or a Word field value (letter closing, signature, contact box).", label: 'Account manager name', type: 'text', owner: 'system', section: 'contact', source: 'rep.name' },
  { key: 'amDesignation', mapHint: "The sales account manager's job title, only if shown as a red sample or a Word field value.", label: 'Account manager designation', type: 'text', owner: 'system', section: 'contact', source: 'rep.designation' },
  { key: 'amPhone', mapHint: "The sales account manager's phone number, in every place it is a red sample or a Word field value.", label: 'Account manager phone', type: 'text', owner: 'system', section: 'contact', source: 'rep.phone' },
  { key: 'amEmail', mapHint: "The sales account manager's email address, as a red sample or a Word field value.", label: 'Account manager email', type: 'text', owner: 'system', section: 'contact', source: 'rep.email' },
  { key: 'amDivision', mapHint: "The sales account manager's office or division, only as a red sample or a Word field value.", label: 'Account manager division', type: 'text', owner: 'system', section: 'contact', source: 'rep.division' },
  { key: 'rebmName', mapHint: 'The name of the second contact (the sales or regional manager), as a red sample or a Word field value.', label: 'Secondary contact name', type: 'text', owner: 'rep', section: 'contact' },
  { key: 'rebmDesignation', mapHint: 'The job title of the second contact, only as a red sample or a Word field value. Fixed black wording is not a location.', label: 'Secondary contact designation', type: 'text', owner: 'rep', section: 'contact' },
  { key: 'rebmPhone', mapHint: 'The phone number of the second contact, as a red sample or a Word field value (the field may show an empty value).', label: 'Secondary contact phone', type: 'text', owner: 'rep', section: 'contact' },
  { key: 'rebmEmail', mapHint: 'The email address of the second contact, as a red sample or a Word field value.', label: 'Secondary contact email', type: 'text', owner: 'rep', section: 'contact' },
  { key: 'rebmDivision', mapHint: 'The office or division of the second contact, as a red sample or a Word field value.', label: 'Secondary contact division', type: 'text', owner: 'rep', section: 'contact' },

  { key: 'ackAddressee1', mapHint: 'First addressee line of the acknowledgement page. Normally fixed black wording: answer not_found unless a red sample is there.', label: 'Acknowledgement addressee line 1', type: 'text', owner: 'rep', section: 'acknowledgement' },
  { key: 'ackAddressee2', mapHint: 'Second addressee line of the acknowledgement page. Normally fixed black wording: answer not_found unless a red sample is there.', label: 'Acknowledgement addressee line 2', type: 'text', owner: 'rep', section: 'acknowledgement' },
  { key: 'ackDate', mapHint: 'The date the CUSTOMER signs the acknowledgement. NOT the proposal submission date. If the template shows dotted lines, answer not_found.', label: 'Acknowledgement date', type: 'text', owner: 'system', section: 'acknowledgement', source: 'today' },
  { key: 'ackPrefill', mappable: false, label: 'Pre-fill acknowledgement lines', type: 'text', owner: 'system', section: 'acknowledgement', source: 'true' },
  { key: 'ackCompanyName', mapHint: "The company name on the acknowledgement page ('Company Name : ...' line). Takes priority over companyName at that line.", label: 'Acknowledgement company', type: 'text', owner: 'system', section: 'acknowledgement', source: 'company.name' },
  { key: 'ackAddress', mapHint: "The address on the acknowledgement page ('Address : ...' line).", label: 'Acknowledgement address', type: 'text', owner: 'system', section: 'acknowledgement', source: 'company.address' },
  { key: 'ackSolution', mapHint: 'The solution name on the acknowledgement page. If the template shows dotted lines for the customer to fill in, answer not_found.', label: 'Acknowledgement solution', type: 'text', owner: 'system', section: 'acknowledgement', source: 'products.names' },
  { key: 'ackInitialCharge', mapHint: 'Initial charge on the acknowledgement page. Dotted lines for the customer to fill in mean not_found.', label: 'Acknowledgement initial charge', type: 'text', owner: 'rep', section: 'acknowledgement' },
  { key: 'ackMonthlyCharge', mapHint: 'Monthly charge on the acknowledgement page. Dotted lines for the customer to fill in mean not_found.', label: 'Acknowledgement monthly charge', type: 'text', owner: 'rep', section: 'acknowledgement' },
  { key: 'ackCommitment', mapHint: 'Commitment period on the acknowledgement page. Dotted lines for the customer to fill in mean not_found.', label: 'Acknowledgement commitment period', type: 'text', owner: 'rep', section: 'acknowledgement' },

  // One row per selected product: its own terms text as ONE paragraph (no splitting, no merging between products). A template
  // that has a {#productTerms} loop shows a numbered title and the terms for every product that has terms; a product whose
  // terms are empty (in the catalogue, or cleared by the rep) is skipped. Never offered to the template mapper: the loop is
  // written by the template author. role marks it for the writer (templateTagWriter) and the editor.
  { key: 'productTerms', role: 'productTerms', mappable: false, label: 'Product terms and conditions', type: 'table', owner: 'system', section: 'terms', rowsFrom: 'products',
    columns: [{ key: 'id', label: 'Product id', source: 'product.id' }, { key: 'name', label: 'Product', source: 'product.name' }, { key: 'terms', label: 'Terms and conditions', source: 'product.terms', required: true },
      { key: 'number', label: 'Number', computed: 'index' }] },

  { key: 'diagrams', label: 'Network diagrams', type: 'image', owner: 'system', section: 'solution', source: 'diagrams' },
];

const BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

// Sections that get a quick-jump chip in the preview, in the order the chips are shown
const CHIP_SECTIONS = ['cover', 'letter', 'requirements', 'about', 'solution', 'investment'];

// ---- Slots: the places a template can show data (what the AI mapper looks for, what tags are written for) ------------------
// A slot is a single field (span / table) or a composed block that stands for several fields (letter, requirements, about).
// A slot's key is also the name of the {tag} written for it. kind: span | block | table | image
//   span   a piece of text inside a paragraph        block  one or more whole paragraphs
//   table  rows of a table                            image  a picture
const BLOCK_SLOTS = [
  { key: 'letterXml', label: 'Letter body', kind: 'block', section: 'letter', how: 'paragraphs', fields: ['solutionIntro1', 'solutionIntro2'],
    hint: 'ONLY the red sample paragraph(s) inside the letter, never the fixed black letter wording around them. Give the first and last paragraph of that red block. If there is no red paragraph answer not_found.' },
  { key: 'requirementsXml', label: 'Requirements list', kind: 'block', section: 'requirements', how: 'requirements', fields: ['requirements'],
    hint: 'The red sample text listing the customer requirements. Fixed black wording is never part of it.' },
  { key: 'aboutXml', label: 'About the business and recommendations', kind: 'block', section: 'about', how: 'about', fields: ['aboutDescription', 'recommendations'],
    hint: 'The red sample text describing the customer business and the recommended products. If the template has no red sample for it, answer not_found.' },
  { key: 'address', label: 'Customer address (one line)', kind: 'span', section: 'letter', how: 'join', fields: ['addressLine1', 'addressLine2', 'city'],
    hint: 'The customer address printed on one line (a red sample or a Word field value), usually under the letter date.' },
  { key: 'diagramsXml', binding: 'diagrams', label: 'Product diagrams', kind: 'image', section: 'solution', fields: ['diagrams'],
    hint: 'A red note or placeholder paragraph where the product diagrams go. Existing fixed pictures are not placeholders; if there is no red placeholder answer not_found.' },
  // Older form of the product terms: one merged list of bullets (sentences of every product, duplicates removed).
  // mappable: false = never offered to the template mapper. The tag is only used when the template author wrote it
  // ({@productTermsXml} alone in its own paragraph, above the generic terms); an upload never invents a place for it.
  { key: 'productTermsXml', label: 'Product terms and conditions', kind: 'block', section: 'terms', how: 'terms', fields: ['productTerms'], mappable: false,
    hint: 'Written by the template author only.' },
];

function slots() {
  const covered = new Set(BLOCK_SLOTS.flatMap(b => b.fields));
  const own = FIELDS.filter(f => f.mappable !== false && !covered.has(f.key)).map(f => ({
    key: f.key,
    label: f.label,
    kind: f.type === 'table' ? 'table' : 'span',
    section: f.section,
    ...(f.type === 'table' ? { columns: f.columns.map(c => ({ key: c.key, label: c.label })) } : {}),
    ...(f.mapHint ? { hint: f.mapHint } : {}),
  }));
  return [...own, ...BLOCK_SLOTS.filter(b => b.mappable !== false).map(b => ({ key: b.key, label: b.label, kind: b.kind, section: b.section, hint: b.hint }))];
}

// The product list that becomes a loop of paragraphs in a template (title, description, the product's own picture).
// Derived from the schema above, so no other file has to name these fields.
const ITEM_LOOP = (() => {
  const field = FIELDS.find(f => f.type === 'table' && (f.columns || []).some(c => c.computed === 'diagram'));
  return {
    loop: field.key, // the loop's tag name
    blockSlot: BLOCK_SLOTS.find(b => b.kind === 'block' && b.fields.includes(field.key)).key, // the single block tag it replaces
    pictureSlot: BLOCK_SLOTS.find(b => b.binding === 'diagrams').key, // the separate diagrams placeholder it replaces
    pictureColumn: field.columns.find(c => c.computed === 'diagram').key,
  };
})();

// When two fields claim the same place in a template, fields of these sections win (the acknowledgement page's lines are
// more specific than the general company name / address)
const CLAIM_FIRST_SECTIONS = ['acknowledgement'];

// The per-product terms loop of the template (tag name, and the column tags the author writes in it)
const TERMS_LOOP = FIELDS.find(f => f.role === 'productTerms').key;

module.exports = { FIELDS, BY_KEY, CHIP_SECTIONS, BLOCK_SLOTS, slots, ITEM_LOOP, TERMS_LOOP, CLAIM_FIRST_SECTIONS };
