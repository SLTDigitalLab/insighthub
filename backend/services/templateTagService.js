const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { logo } = require('../proposal/renderSettings');

// Reads the tag structure of a .docx template.
// docxtemplater's bundled InspectModule needs `lodash` (not installed here), so this walks the same data it reads:
// doc.compiled[file].postparsed (placeholders, loops with `subparsed`, raw-XML tags).
// NOTE: this relies on docxtemplater internals (the shape of `compiled`/`postparsed` tokens: type, module, value, raw,
// subparsed), which are not a public API. Re-check this file (and run a template upload) whenever docxtemplater is upgraded.

const CONTEXT_CHARS = 200;

function newNode(name, type, where) {
  return { name, type, where, children: new Map() };
}

// Walks one file's tokens, adding tags under `parent`; `flat` collects the readable text so each tag can get context.
function walk(tokens, parent, flat) {
  for (const t of tokens || []) {
    if (t.type === 'content') {
      // `content` tokens can carry raw XML between tags; keep only readable text, with paragraph ends as separators
      const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(t.value);
      if (style) flat.paraStyle = style[1];
      const readable = String(t.value).replace(/<\/w:p>/g, ' | ').replace(/<[^>]*>/g, '');
      flat.text += readable;
      flat.paraText += readable;
    } else if (t.type === 'tag') {
      if (t.tag === 'w:p' && t.position === 'end') {
        // A Heading-styled paragraph names the section that the tags after it belong to
        if (/^Heading/i.test(flat.paraStyle) && flat.paraText.trim()) flat.section = flat.paraText.replace(/\s+/g, ' ').trim();
        flat.paraStyle = '';
        flat.paraText = '';
        flat.text += ' | ';
      } else if (t.tag === 'w:br' && t.position !== 'end') {
        flat.text += ' | ';
      }
    } else if (t.type === 'placeholder') {
      const where = { flat, pos: flat.text.length, section: flat.section };
      const isLoop = t.module === 'loop' || Array.isArray(t.subparsed);
      const type = isLoop ? 'loop' : (t.module === 'rawxml' ? 'rawXml' : 'text');
      let node = parent.children.get(t.value);
      if (!node) {
        node = newNode(t.value, type, where);
        parent.children.set(t.value, node);
      } else if (isLoop && node.type !== 'loop') {
        node.type = 'loop';
      }
      flat.text += `{${t.raw || t.value}}`;
      if (isLoop) {
        walk(t.subparsed, node, flat);
        flat.text += `{/${t.value}}`;
      }
    }
  }
}

function contextOf(where) {
  const text = where.flat.text;
  const half = Math.floor(CONTEXT_CHARS / 2);
  const slice = text.slice(Math.max(0, where.pos - half), where.pos + half);
  return slice.replace(/\s*\|\s*(\|\s*)*/g, ' | ').replace(/\s+/g, ' ').trim();
}

function describeError(err) {
  const p = err.properties || {};
  const id = p.id || err.name || 'error';
  const unbalanced = /loop|closing_tag|unclosed|unopened/i.test(id);
  return {
    kind: unbalanced ? 'unbalanced_tag' : 'parse_error',
    id,
    tag: p.xtag || p.tag || '',
    file: p.file || '',
    message: p.explanation || err.message,
  };
}

// A loop inside a loop also lists its own inner tags (`children`); other tags are unchanged
function childEntry(child) {
  return {
    name: child.name,
    type: child.type === 'loop' ? 'loop' : (child.type === 'rawXml' ? 'rawXml' : 'text'),
    context: contextOf(child.where),
    ...(child.type === 'loop' ? { children: [...child.children.values()].map(childEntry) } : {}),
  };
}

function toEntry(node) {
  if (node.type === 'loop') {
    return {
      name: node.name,
      type: 'loop',
      context: contextOf(node.where),
      section: node.where.section || '',
      children: [...node.children.values()].map(childEntry),
    };
  }
  return { name: node.name, type: node.type, context: contextOf(node.where), section: node.where.section || '' };
}

// Returns { tags, errors, warnings }. Parse errors (and an unreadable file) go to `errors`; the caller rejects the upload.
function extractTags(buffer) {
  const report = { tags: [], errors: [], warnings: [] };

  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (e) {
    report.errors.push({ kind: 'not_docx', id: 'not_a_zip', tag: '', file: '', message: 'The file is not a valid .docx (could not open it as a zip archive).' });
    return report;
  }
  if (!zip.file('word/document.xml')) {
    report.errors.push({ kind: 'not_docx', id: 'no_document_xml', tag: '', file: '', message: 'The file has no word/document.xml, so it is not a Word document.' });
    return report;
  }

  let doc;
  try {
    doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, errorLogging: false });
  } catch (e) {
    const errs = e.properties && Array.isArray(e.properties.errors) ? e.properties.errors : [e];
    report.errors = errs.map(describeError);
    return report;
  }

  const root = newNode('', 'loop', null);
  // Body first, so tags come out in the order they appear in the document; headers/footers after
  const files = Object.keys(doc.compiled).sort((a, b) => (b === 'word/document.xml') - (a === 'word/document.xml'));
  files.forEach(file => {
    const compiled = doc.compiled[file];
    if (!compiled || !Array.isArray(compiled.postparsed)) return;
    walk(compiled.postparsed, root, { text: '', file, section: '', paraStyle: '', paraText: '' });
  });

  // the client-logo tag is filled by services/logoService.js, so it is neither a field nor an unfilled text tag
  const logoTagName = logo.textTag.replace(/^\{|\}$/g, '');
  report.tags = [...root.children.values()].filter(n => n.name !== logoTagName).map(toEntry);

  return report;
}

module.exports = { extractTags };
