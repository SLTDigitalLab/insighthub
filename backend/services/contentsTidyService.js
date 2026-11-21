const PizZip = require('pizzip');
const { buildOutline } = require('./templateOutlineService');
const { planCleanup, applyEdits } = require('./templateTagWriter');
const { outline: outlineSettings } = require('../proposal/renderSettings');

// Table of contents tidy-up, applied to every generated proposal (Product, Solution, Product + Solution) AFTER it is filled.
//
// The upload step (templateTagWriter.writeTags) already reduces a template's table of contents to one field and keeps headings with no text
// out of it, but only for a template it tagged itself: a template that arrives already tagged (the author wrote the tags) is stored as it
// is, so it can still hold a nested / duplicate TOC field (Word then prints two lists) and headings that are empty (a picture on a
// Heading 1 line, or a heading whose placeholder came out empty) that show up as blank entries "........ 14".
//
// This runs the SAME rules on the generated document, so nothing depends on one template:
//   - more than one TOC field: the complete one is kept, the others are unwrapped (when nested) or removed; one TOC stays one, none stays none
//   - a heading paragraph with no text gets outline level 9 (body text): it keeps its look and its page break but is not a contents entry
// Page numbers are not touched here: the PDF conversion updates them (scripts/convert_docx_to_pdf_word.ps1).
// It never stops a proposal: any problem leaves the document as it was.

const BODY_TEXT_LEVEL = outlineSettings.bodyTextLevel;

function tidyContents(buffer) {
  try {
    const outline = buildOutline(buffer);
    const plan = planCleanup(outline, new Set());
    const emptyHeadings = plan.emptyHeadings;
    if (!(plan.toc.keep) && !emptyHeadings.length) return { buffer, changed: false };

    const zip = new PizZip(buffer);
    const partOf = ref => ref.split('.')[0];
    const xml = Object.fromEntries(Object.entries(outline.files).map(([part, file]) => [part, zip.file(file).asText()]));
    const edits = Object.fromEntries(Object.keys(xml).map(p => [p, []]));
    const deleted = Object.fromEntries(Object.keys(xml).map(p => [p, []]));
    const para = ref => outline.paragraphs.find(p => p.ref === ref);
    const byRef = Object.fromEntries(outline.fields.map(f => [f.ref, f]));
    const blocked = new Set();
    const delNode = (part, n) => { edits[part].push({ start: n.start, end: n.end, text: '' }); deleted[part].push(n); };
    const touched = new Set();

    // 1. one TOC field
    if (plan.toc.keep) {
      plan.toc.unwrap.forEach(ref => { const f = byRef[ref]; f.controls.forEach(n => delNode(partOf(f.paragraph), n)); touched.add(f.paragraph); touched.add(f.endParagraph); });
      plan.toc.remove.forEach(ref => {
        const f = byRef[ref];
        const part = partOf(f.paragraph);
        f.all.forEach(n => delNode(part, n));
        const a = para(f.paragraph).index;
        const b = para(f.endParagraph).index;
        outline.paragraphs.filter(p => partOf(p.ref) === part && p.index > a && p.index < b).forEach(p => { edits[part].push({ start: p.start, end: p.end, text: '' }); blocked.add(p.ref); });
        touched.add(f.paragraph); touched.add(f.endParagraph);
      });
      // a contents paragraph left with nothing but removed field codes is deleted
      touched.forEach(ref => {
        const p = para(ref);
        if (!p || blocked.has(ref)) return;
        const part = partOf(ref);
        const inDeleted = n => deleted[part].some(d => d.start <= n.start && n.end <= d.end);
        const empty = !p.runs.some(r => r.nodes.some(n => !inDeleted(n))) && !outline.bookmarks.some(b => b.start > p.start && b.end < p.end && !inDeleted(b));
        if (empty && /^TOC/i.test(p.style)) { edits[part].push({ start: p.start, end: p.end, text: '' }); blocked.add(ref); }
      });
    }

    // 2. headings with no text are body text for the contents
    emptyHeadings.forEach(ref => {
      const p = para(ref);
      if (!p || blocked.has(ref)) return;
      const part = partOf(ref);
      const lvl = `<w:outlineLvl w:val="${BODY_TEXT_LEVEL}"/>`;
      const info = p.pPrInfo;
      const insert = (at, text) => edits[part].push({ start: at, end: at, text });
      if (!info) insert(p.openEnd, `<w:pPr>${lvl}</w:pPr>`);
      else if (info.outlineLvl) edits[part].push({ start: info.outlineLvl.start, end: info.outlineLvl.end, text: lvl });
      else if (info.selfClosing) edits[part].push({ start: info.start, end: info.end, text: `<w:pPr>${lvl}</w:pPr>` });
      else insert(info.before !== undefined ? info.before : info.closeStart, lvl);
    });

    Object.keys(edits).forEach(part => { if (edits[part].length) zip.file(outline.files[part], applyEdits(xml[part], edits[part])); });
    return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), changed: true, toc: plan.toc, emptyHeadings: emptyHeadings.length };
  } catch (err) {
    console.warn(`[contentsTidy] left the document as it is (${err && err.message})`); // cosmetic: never stop a proposal
    return { buffer, changed: false };
  }
}

module.exports = { tidyContents };
