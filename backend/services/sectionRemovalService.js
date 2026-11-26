// Removes one whole section (its heading, the logo / text / tables that belong to it and the page break that opens it) from a template's
// word/document.xml, BEFORE the template is filled. Used when the rep presses "Remove section" on the edit screen (the "About you and how we
// can help you" block of the Product and Product + Solution proposals).
//
// The section is found from the template's own tag (e.g. {@aboutXml}), not from its heading text, and its extent comes from the template's
// layout: from the Heading 1 above the tag to the next Heading 1 / page-break paragraph below it. Two layouts exist among our templates and
// both are handled:
//   - the section's parts are body-level paragraphs / tables of their own (the Product + Solution template): the body-level elements go
//   - the section is some rows of a big layout table that also holds the next section (the Product template): those table rows go
// Nothing is written about a template here, only about the shapes above. When the tag or a heading cannot be found the XML is returned
// untouched, so a proposal is never stopped by this.

const textOf = s => s.replace(/<[^>]+>/g, '');
const HEADING = /<w:pStyle w:val="Heading1"/i;
const hasHeading = s => HEADING.test(s) && textOf(s).trim().length > 0;
const startsPage = s => /<w:pageBreakBefore\b/.test(s) || /<w:br w:type="page"/.test(s);

// Splits `xml` (a run of sibling elements) into top-level elements named in `names`, by depth counting
function topLevel(xml, from, to, names) {
  const alt = names.join('|');
  const re = new RegExp(`<(/?)(${alt})(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  const out = [];
  let depth = 0; let start = -1; let nameAtStart = '';
  re.lastIndex = from;
  let m;
  while ((m = re.exec(xml)) && m.index < to) {
    const [whole, close, name, , selfClose] = m;
    if (selfClose) { if (depth === 0) out.push({ start: m.index, end: m.index + whole.length, name }); continue; }
    if (!close) { if (depth === 0) { start = m.index; nameAtStart = name; } depth += 1; } else {
      depth -= 1;
      if (depth === 0) out.push({ start, end: m.index + whole.length, name: nameAtStart });
      if (depth < 0) break;
    }
  }
  return out;
}

function bodyChildren(xml) {
  const open = xml.indexOf('<w:body>');
  const close = xml.lastIndexOf('</w:body>');
  if (open === -1 || close === -1) return [];
  return topLevel(xml, open + 8, close, ['w:p', 'w:tbl', 'w:sdt']);
}

const emptyBreak = s => !textOf(s).trim() && startsPage(s) && !s.includes('<w:drawing') && !s.includes('<w:sectPr');

// tag: the template tag of the section, without braces ('aboutXml'). Returns the new XML (the same string when nothing was removed).
function removeSectionByTag(xml, tag) {
  const marker = `@${tag}}`;
  const kids = bodyChildren(xml).map(k => ({ ...k, text: textOf(xml.slice(k.start, k.end)) }));
  const a = kids.findIndex(k => k.text.includes(marker));
  if (a === -1) return xml;
  const xmlOf = k => xml.slice(k.start, k.end);

  // Layout 1: the tag sits in a layout table that holds the heading (and possibly the next section): cut rows
  // (a table that holds only this section is removed as a whole body element below, together with the page break that opens it,
  // otherwise that empty page-break paragraph and the next section's own one leave a blank page)
  if (kids[a].name === 'w:tbl' && hasHeading(xmlOf(kids[a]))) {
    const t = kids[a];
    const rows = topLevel(xml, t.start + 1, t.end, ['w:tr']).map(r => ({ ...r, text: textOf(xml.slice(r.start, r.end)), heading: hasHeading(xml.slice(r.start, r.end)) }));
    const r = rows.findIndex(x => x.text.includes(marker));
    if (r === -1) return xml;
    let h = r; while (h >= 0 && !rows[h].heading) h -= 1;
    if (h < 0) return xml;
    let n = r + 1; while (n < rows.length && !rows[n].heading) n += 1;
    // the empty spacer row just above a heading belongs to that heading's section: the one above the NEXT heading stays with the next section
    const spacer = i => i >= 0 && i < rows.length && !rows[i].text.trim() && !rows[i].heading;
    let from = h; if (spacer(h - 1)) from = h - 1;
    let to = n; if (n < rows.length && spacer(n - 1)) to = n - 1;
    if (!(from === 0 && n === rows.length)) return xml.slice(0, rows[from].start) + xml.slice(to < rows.length ? rows[to].start : rows[rows.length - 1].end);
  }

  // Layout 2 (also a table that is the whole section): body-level elements of their own: from the heading above (plus the page break that opens it) to the next break / heading
  let h = a; while (h >= 0 && !hasHeading(xmlOf(kids[h]))) h -= 1;
  if (h < 0) return xml;
  let from = h;
  if (h > 0 && emptyBreak(xmlOf(kids[h - 1]))) from = h - 1;
  let to = a + 1;
  while (to < kids.length) {
    const s = xmlOf(kids[to]);
    if (s.includes('<w:sectPr') || hasHeading(s) || startsPage(s)) break;
    to += 1;
  }
  return xml.slice(0, kids[from].start) + xml.slice(to < kids.length ? kids[to].start : kids[kids.length - 1].end);
}

module.exports = { removeSectionByTag };
