// Friendly labels for the solution proposal edit screen. Labels are derived from the template's own tag names by one generic
// rule (split camelCase / underscores, drop a trailing "Xml", sentence case); no tag is named here. The only per-word data is
// this small settings object, so a future template with other tag names still reads well.
export const LABEL_SETTINGS = {
  // lower-case word -> how it is written (abbreviations and short forms)
  words: {
    am: 'Account manager',
    ack: 'Acknowledgement',
    qty: 'Quantity',
    vat: 'VAT',
    sscl: 'SSCL',
    ref: 'Reference',
    no: 'number',
  },
  // whole names that read better as the heading they print under in the document (the Product flow's shared block names)
  names: {
    aboutXml: 'About you & how we can help you',
    requirementsXml: 'Proposed solution',
  },
  // a last word that only says how the template stores the value
  dropLastWord: ['xml'],
  // user field (account manager detail) -> how it is named in "Add your ... in your profile"
  userFields: {
    name: 'name',
    phone: 'phone number',
    email: 'email address',
    designation: 'designation',
    division: 'division',
  },
};

export function fieldLabel(name) {
  if (LABEL_SETTINGS.names[name]) return LABEL_SETTINGS.names[name];
  const words = String(name || '')
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
  if (words.length > 1 && LABEL_SETTINGS.dropLastWord.includes(words[words.length - 1])) words.pop();
  const text = words.map(w => LABEL_SETTINGS.words[w] || w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const userFieldPhrase = (field) => `Add your ${LABEL_SETTINGS.userFields[field] || field} in your profile`;
