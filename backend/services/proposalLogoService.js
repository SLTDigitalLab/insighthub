const { imageInfo } = require('./logoService');
const { logo } = require('../proposal/renderSettings');

// The customer logo the user uploads on the Solution / Product + Solution edit screen. It is stored with the proposal (in the fields'
// __meta, next to the picture settings, so every later version and the archive have it) and printed by the template's own {%client_logo}
// tag (logoService.js, which reads the box from the template). This file only checks what is uploaded and applies the change.

const META_KEY = '__meta';
const MAX_MB = logo.maxBytes / (1024 * 1024);
const fail = message => Object.assign(new Error(message), { status: 400 });

// A PNG / JPG data URL no bigger than the limit; anything else is a clear error the edit screen shows as it is.
function checkUpload(dataUrl) {
  const v = String(dataUrl == null ? '' : dataUrl).trim();
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(v);
  if (!m) throw fail('The customer logo must be a PNG or JPG image.');
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (buf.length > logo.maxBytes) throw fail(`The customer logo is larger than ${MAX_MB} MB. Please use a smaller image.`);
  const info = imageInfo(buf);
  if (!info || !['png', 'jpeg'].includes(info.ext)) throw fail('The customer logo must be a PNG or JPG image.');
  return v;
}

// meta after a logo change: undefined = no change, '' / null = the logo is removed, a data URL = the new logo.
// Returns a new object; the picture settings that are not the logo (diagram tags ...) are kept.
function withLogo(meta, change) {
  const next = { ...(meta && typeof meta === 'object' ? meta : {}) };
  if (change === undefined) return next;
  if (change === null || change === '') { delete next.leadLogo; delete next.leadLogoSize; return next; }
  next.leadLogo = checkUpload(change);
  return next;
}

// The tag of the edit screen whose section the logo place belongs to, so the upload sits in that section: the tag nearest to the template's
// {%client_logo} (read from the template when it was stored: logoService.detectPlaceholders), when the template has it in the schema; else the
// "about" block (where the logo goes by default); else the first block with the structured editor; '' = no such section (the field stands alone).
function logoFieldOf(entry, schema) {
  const tags = Array.isArray(schema) ? schema : [];
  const has = name => !!name && tags.some(t => t.name === name);
  const place = entry && Array.isArray(entry.logoPlaceholders) ? entry.logoPlaceholders.find(p => has(p.nearField)) : null;
  if (place) return place.nearField;
  const structuredTags = tags.filter(t => t.editor === 'structured');
  const about = structuredTags.find(t => require('./structuredTextService').roleOf(t.name) === 'about');
  return (about || structuredTags[0] || {}).name || '';
}

const hasKeys = o => !!o && typeof o === 'object' && Object.keys(o).length > 0;

module.exports = { META_KEY, MAX_MB, checkUpload, withLogo, hasKeys, logoFieldOf };
