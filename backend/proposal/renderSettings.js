const path = require('path');

// Every fixed choice of the proposal generator that is not a field of the schema (proposal/fieldSchema.js) lives here:
// locations, locale, file naming, the wording the generator adds itself, and the layout of the content it generates
// (numbered item titles, diagrams, logo). Nothing in these values belongs to one template: a template's own layout,
// tables, headings and text are never defined in code; they come from the uploaded .docx and its tags.
// Locale and file name can be changed with environment variables; the rest by editing this file.

const BACKEND = path.join(__dirname, '..');

module.exports = {
  paths: {
    // imported as version 1 on first run; "Restore Default" goes back to the first version
    defaultTemplate: path.join(BACKEND, 'templates', 'default_proposal_template.docx'),
    // product diagrams (file names come from each product's `diagram` field in data/products.json)
    diagramDir: path.join(BACKEND, 'templates', 'diagrams'),
  },

  locale: {
    timeZone: process.env.PROPOSAL_TIMEZONE || 'Asia/Colombo', // the proposal date
    country: process.env.PROPOSAL_COUNTRY || 'Sri Lanka', // dropped from an address when the station (town) is taken from it
  },

  files: {
    namePrefix: process.env.PROPOSAL_FILE_PREFIX || 'SLT_Proposal_', // exported file name: <prefix><company>.docx
  },

  // text the generator adds around the values it fills in
  wording: {
    prioritySuffix: ' — High priority', // after the title of a recommended product marked high priority
    itemTitle: (n, name) => `${n}. ${name}`, // numbered item titles in the requirements and about blocks
    // the lines the upload writes into a template's requirements loop (the tags are columns of the loop)
    itemLines: { title: '{number}. {title}', description: '{description}' },
  },

  // layout of the generated paragraphs (twips for indents and spacing, EMU for pictures)
  layout: {
    itemTitleAlign: 'left', // alignment of the loop's title line and of its description (when the sample gives only one paragraph)
    itemDescriptionAlign: 'both',
    bodyStyle: 'BodyText', // paragraph style of diagram captions (Word falls back to Normal if the template has no such style)
    captionIndentLeft: 796,
    captionIndentRight: 780,
    captionColor: '0B2A6F',
    captionSpacing: { first: 60, next: 120, after: 60 },
    titleSpacing: { before: 120, after: 20 },
    bullet: { symbol: '•', indentLeft: 720, hanging: 360, spacing: 25 },
    // how a heading that must keep starting its page is forced onto a new page after its spacer rows were removed
    // ('sectionBreak', or 'none' for no break)
    sectionPageBreak: 'sectionBreak',
    // spacer cleanup beyond rows in front of a heading: empty rows at the end of a table, and long runs of empty paragraphs
    // between blocks (all but the first `emptyRunMax` are deleted; null = leave them)
    spacers: { trailingRows: true, trailingParagraphs: true, emptyRunMax: 1, emptyRunScope: 'afterGenerated', pageAdvanceRatio: 0.4 },
    breakParagraph: { line: 20, size: 2 }, // the tiny paragraph that holds that section break (twips, half-points)
    diagram: { maxWidth: 5100000, maxHeightFirst: 2400000, maxHeight: 2800000, spacingFirstAfter: 60, spacingAfter: 80 },
  },

  // what counts as the author's red marking, and Word's outline level for body text (levels below it are headings)
  outline: { bodyTextLevel: 9, redMin: 0xb0, redMaxOther: 0x60 },

  // limits for the upload's field matching
  mapping: {
    maxBlockParagraphs: 40,
    maxLocations: 20,
    a4AreaEmu: 7560000 * 10692000, // a picture bigger than this share of an A4 page is a layout graphic, not a placeholder
    maxPlaceholderPictureShare: 0.05,
  },

  // sample values from a template's old Word merge fields that may stay in the tagged copy without failing the upload
  // (compared ignoring case, spacing and punctuation)
  sampleValuesIgnored: [
    'No 125, Lotus Road, Colombo 01, Colombo, Western, Sri Lanka, 00100',
  ],

  // loop column names that mean the same thing in different templates (either spelling fills the same field column)
  columnSynonyms: [
    ['media', 'accessMedia'],
    ['description', 'name'],
    ['bandwidth', 'speed'],
    ['qosTemplate', 'qos'],
    ['oneTimeCharge', 'oneTime'],
    ['monthlyRental', 'monthly'],
    ['title', 'name'],
    ['text', 'description'],
  ],

  // product terms printed above the template's own generic Terms and Conditions bullets (services/termsService.js)
  //   headingPattern  the template heading whose first paragraph gives the bullet format (read when a template is uploaded)
  //   sentenceSplit   where one product's terms text is cut into bullet items
  //   bulletPrefix    a bullet / number a line may already start with (removed)
  //   nearDuplicate   two items whose words overlap by at least this share count as the same item (1 = exact only)
  terms: {
    headingPattern: 'terms\\s+(?:and|&)\\s+conditions',
    sentenceSplit: '(?<=[.!?])\\s+(?=[A-Z0-9("])',
    bulletPrefix: '^\\s*(?:[-\\u2022*\\u00b7]|\\d+[.)])\\s+',
    nearDuplicate: 0.85,
    // the per-product loop ({#productTerms}): a heading style on its lines is removed when a template is uploaded (a heading would
    // become a contents entry), and the title line is kept on the same page as its terms
    keepTitleWithText: true,
  },

  // Product diagrams uploaded by the rep (services/diagramService.js)
  //   maxUploadBytes   larger files are refused
  //   textWidthShare   an uploaded diagram is scaled to this share of the usable text width (aspect ratio kept) ...
  //   maxHeight        ... and never taller than this (EMU)
  //   dirName          folder (inside the data folder) of the per-product defaults
  diagrams: {
    maxUploadBytes: 10 * 1024 * 1024,
    textWidthShare: 1,
    maxHeight: 4000000,
    dirName: 'product_diagrams',
  },

  logo: {
    // Text tag that marks where the client logo goes (docxtemplater's single-brace image form). Its box, as shares of the usable
    // text width of its table cell or page: the logo is scaled up or down to fit inside it
    textTag: '{%client_logo}',
    textBoxWidthShare: 0.5,
    textBoxHeightShare: 0.25,
    // Alt Text of a picture in the template that marks the same (the picture's own size and position are the box)
    placeholderAlts: ['{%client_logo}', '{{client_logo}}'],
    // the editor's Small / Medium / Large = a share of that box; never above 1
    scale: { small: 0.6, medium: 0.8, large: 1.0 },
    defaultSize: 'medium',
    maxBytes: 2 * 1024 * 1024,
  },
};
