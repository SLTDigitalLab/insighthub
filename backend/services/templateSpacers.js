const PizZip = require('pizzip');
const { buildOutline } = require('./templateOutlineService');
const { extractTags } = require('./templateTagService');
const { autoBind } = require('../proposal/autoBind');
const { layout, outline: outlineSettings } = require('../proposal/renderSettings');

// Removes the blank space a template reserves for its SAMPLE text, on the tagged copy:
//   (a) a table row that holds generated content (a raw {@tag} or the opening tag of a paragraph loop) loses its fixed
//       minimum / exact height, so it grows to fit what is generated instead of reserving the sample's height;
//   (b) table rows that hold only empty paragraphs are deleted when they sit between a content row and the next heading
//       row of the same table;
//   (c) when rows were deleted in front of a heading that, in the original, started a page (Word's page-start mark inside
//       the heading), that heading is made to start a page again (see breakEdits), so removing the spacers does not pull it
//       up onto the previous section's page;
//   (d) empty rows at the very end of a table are deleted: nothing follows them, they only reserve room that generated content
//       pushes onto extra pages;
//   (e) in a run of empty paragraphs directly behind a table that holds generated content (including a table-row loop), all but
//       the first are deleted (the
//       first stays: a pinned table belongs to the paragraph after it). Runs elsewhere are left alone: the author uses them
//       to carry the following pinned sections to their own pages.
// It touches nothing else: never a row with text, tags, pictures, logos or fields, no header or footer, nothing before the
// first heading of the document (the cover and the letter), and no row whose generated content is only a picture (the logo,
// the diagrams). Where it cannot tell what a row is, the row is left alone, and any error skips the whole step (the upload
// goes on without it). Nothing here names a table, a row number, a height or a heading.

const TWIPS_PER_CM = 567;
const BODY_TEXT_LEVEL = outlineSettings.bodyTextLevel;
const TAG = /\{[#/@^!]?[A-Za-z_][\w.]*\}/;
const PAGE_START_MARK = /<w:lastRenderedPageBreak\/>/; // Word's own note that a paragraph started a page when the file was last saved
const LOOP_OPEN = /\{#[A-Za-z_][\w.]*\}/; // any loop's opening tag (a table-row loop has it inside a cell, next to the column tags)
const LOOP_OPEN_ALONE = /^\{#[A-Za-z_][\w.]*\}$/; // a paragraph loop's opening tag in a paragraph of its own

// Anything that makes a row more than empty paragraphs: text, a picture or shape, a text box, a field, a bookmark, a
// content control, a nested table, a page / column / section break
const NOT_EMPTY = [/<w:t[ >][^<]*[^\s<][^<]*<\/w:t>/, /<w:drawing/, /<w:pict/, /<w:object/, /<mc:AlternateContent/, /<w:txbxContent/, /<w:fldChar/, /<w:fldSimple/,
  /<w:instrText/, /<w:bookmarkStart/, /<w:sdt[ >]/, /<w:tbl>/, /<w:br [^>]*w:type="(page|column)"/, /<w:sectPr/, /<w:hyperlink/, /<w:footnoteReference/, /<w:endnoteReference/, /<w:pageBreakBefore/];

function planFor(outline, xmlOf, imageTags, opts) {
  const heightsCleared = [];
  const rowsDeleted = [];
  const pageBreaks = [];
  const runBreaks = []; // cut spacer runs that lead to a pinned table
  const trailing = []; // rows deleted at the end of a table
  const trimmed = []; // empty body paragraphs deleted from long runs
  const generatedTables = []; // tables that hold generated content
  const edits = {}; // part -> [{ start, end, text }]
  const push = (part, e) => { (edits[part] = edits[part] || []).push(e); };
  const partOf = ref => ref.split('.')[0];

  // tables that start before the first heading (the cover, the letter) are not touched
  const firstHeading = outline.paragraphs.findIndex(p => p.text.trim() && p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL);
  const startsBefore = t => { const first = outline.paragraphs.findIndex(p => p.cell && p.cell.table === t.ref); return firstHeading < 0 || first < 0 || first < firstHeading; };
  const rawTagNames = text => [...text.matchAll(/\{@([A-Za-z_][\w.]*)\}/g)].map(m => m[1]);

  outline.tables.forEach(t => {
    const part = partOf(t.ref);
    const xml = xmlOf(part);
    if (!xml || !t.rows.length || startsBefore(t)) return;
    const info = t.rows.map(row => {
      const src = xml.slice(row.start, row.end);
      const paras = outline.paragraphs.filter(p => p.cell && p.cell.table === t.ref && p.cell.r === row.index);
      const text = paras.map(p => p.text).join('');
      const empty = !text.trim() && !TAG.test(text) && !NOT_EMPTY.some(re => re.test(src)) && !row.header;
      const heading = paras.some(p => p.text.trim() && p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL);
      const generated = paras.some(p => rawTagNames(p.text).some(n => !imageTags.has(n)) || LOOP_OPEN_ALONE.test(p.text.trim()));
      const growing = generated || paras.some(p => LOOP_OPEN.test(p.text)); // the row's content grows with the data (row loops too)
      return { row, empty, heading, generated, growing, content: !empty };
    });

    if (info.some(i => i.growing)) generatedTables.push(t);

    // (a) fixed heights of rows that hold generated content
    info.forEach(i => {
      if (!i.generated || !i.row.trHeight) return;
      push(part, { start: i.row.trHeight.start, end: i.row.trHeight.end, text: '' });
      heightsCleared.push({ table: t.ref, row: i.row.index, twips: i.row.trHeight.twips, rule: i.row.trHeight.rule });
    });

    // (b) empty rows between a content row and the next heading row
    for (let n = 0; n < info.length; n += 1) {
      if (!info[n].empty) continue;
      let end = n;
      while (end + 1 < info.length && info[end + 1].empty) end += 1;
      const before = n > 0 && info[n - 1].content;
      const after = end + 1 < info.length && info[end + 1].heading;
      if (before && after) {
        for (let k = n; k <= end; k += 1) {
          const r = info[k].row;
          push(part, { start: r.start, end: r.end, text: '' });
          rowsDeleted.push({ table: t.ref, row: r.index, twips: r.trHeight ? r.trHeight.twips : 0, paragraphs: outline.paragraphs.filter(p => p.cell && p.cell.table === t.ref && p.cell.r === r.index).length });
        }
        // The spacers may be what put that heading at the top of a page. Word records, inside the heading's own paragraph,
        // that it started a page when the file was last saved (<w:lastRenderedPageBreak/>). If it did, the heading keeps
        // starting a page; if it did not, nothing is added.
        const heading = info[end + 1];
        const src = xml.slice(heading.row.start, heading.row.end);
        if (PAGE_START_MARK.test(src)) {
          const hp = outline.paragraphs.find(p => p.cell && p.cell.table === t.ref && p.cell.r === heading.row.index && p.text.trim() && p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL);
          if (hp) pageBreaks.push({ table: t.ref, row: heading.row.index, paragraph: hp.ref, tableTop: !t.parentCell, tableRef: t, headingRow: heading.row });
        }
      }
      n = end;
    }

    // (d) empty rows at the very end of a table (nothing follows them in it): they only reserve room that generated content
    //     pushes onto extra pages. Only when the table has a content row before them.
    if (opts.trailingRows) {
      let first = info.length;
      while (first > 0 && info[first - 1].empty) first -= 1;
      if (first > 0 && first < info.length && info.slice(0, first).some(i => i.content)) {
        for (let k = first; k < info.length; k += 1) {
          const r = info[k].row;
          push(part, { start: r.start, end: r.end, text: '' });
          trailing.push({ table: t.ref, row: r.index, twips: r.trHeight ? r.trHeight.twips : 0, paragraphs: outline.paragraphs.filter(p => p.cell && p.cell.table === t.ref && p.cell.r === r.index).length });
        }
      }
    }
  });

  // (e) a run of empty paragraphs between the document's blocks (outside tables) that the author used to carry the next block
  //     to a new page, behind content that grows with the data. Only a run tall enough to be a page advance counts (its estimated
  //     height is at least `pageAdvanceRatio` of the section's page body); shorter runs are ordinary spacing and stay as they are.
  //     A run is not simply shortened: the block after it (a table, pinned or not) must keep landing on the page the run carried
  //     it to, whatever the length of the content before it, so when a table follows, the run is replaced by a "next page"
  //     section break (see breakEdits); when text follows, the run is cut to `emptyRunMax` paragraphs.
  if (opts.emptyRunMax !== null && opts.emptyRunMax !== undefined && opts.metrics) {
    const xml = xmlOf('doc');
    const body = outline.paragraphs.filter(p => p.ref.startsWith('doc.') && !p.cell && !p.textBox && outline.paragraphs.indexOf(p) > firstHeading);
    const isEmpty = p => !p.text.trim() && !TAG.test(p.text) && !NOT_EMPTY.some(re => re.test(xml.slice(p.start, p.end)));
    let run = [];
    // 'afterGenerated': only a run that follows content that grows with the data (tables in between do not matter, text
    // paragraphs do); 'all': every run of empty paragraphs in the document body
    const follows = p => opts.emptyRunScope === 'all' || generatedTables.some(t => p.start >= t.end && !body.some(q => q.start >= t.end && q.end <= p.start && !isEmpty(q)));
    const advances = r => r.reduce((n, p) => n + opts.metrics.paraHeight(xml.slice(p.start, p.end)), 0) >= opts.pageAdvanceRatio * opts.metrics.bodyHeight(xml, r[0].start);
    const flush = () => {
      if (run.length && follows(run[0]) && advances(run)) {
        const last = run[run.length - 1];
        const next = /^\s*<w:tbl>/.exec(xml.slice(last.end));
        const nt = next ? outline.tables.find(t => !t.parentCell && partOf(t.ref) === 'doc' && t.start === last.end + next[0].length - '<w:tbl>'.length) : null;
        if (nt && nt.rows.length) {
          run.slice(1).forEach(p => { push('doc', { start: p.start, end: p.end, text: '' }); trimmed.push(p.ref); });
          runBreaks.push({ paragraph: run[0], tableRef: nt });
        } else {
          run.slice(Math.max(1, opts.emptyRunMax)).forEach(p => { push('doc', { start: p.start, end: p.end, text: '' }); trimmed.push(p.ref); });
        }
      }
      run = [];
    };
    body.forEach(p => {
      const sibling = run.length && /^\s*$/.test(xml.slice(run[run.length - 1].end, p.start));
      if (isEmpty(p) && (!run.length || sibling)) run.push(p);
      else { flush(); if (isEmpty(p)) run.push(p); }
    });
    flush();
  }
  // (f) empty paragraphs at the very end of the last cell of a table that holds generated content: all but the last are deleted
  //     (a cell must end with a paragraph) and the last is shrunk to a tiny line. They only reserve room under the content; when
  //     the generated content fills a page, they are what spills onto an extra, otherwise blank, page. Only after a paragraph
  //     with content in the same cell.
  const shrunk = [];
  if (opts.trailingParagraphs) {
    outline.tables.forEach(t => {
      if (t.parentCell || partOf(t.ref) !== 'doc' || !t.rows.length) return;
      const xml = xmlOf('doc');
      const inTable = outline.paragraphs.filter(p => p.cell && p.cell.table === t.ref);
      if (!inTable.some(p => TAG.test(p.text))) return; // no generated content in this table
      const lastRow = t.rows[t.rows.length - 1];
      const rowParas = inTable.filter(p => p.cell.r === lastRow.index);
      if (!rowParas.length) return;
      const lastCell = Math.max(...rowParas.map(p => p.cell.c));
      const cellParas = rowParas.filter(p => p.cell.c === lastCell).sort((a, b) => a.start - b.start);
      const emptyP = p => !p.text.trim() && !TAG.test(p.text) && !NOT_EMPTY.some(re => re.test(xml.slice(p.start, p.end)));
      let first = cellParas.length;
      while (first > 0 && emptyP(cellParas[first - 1])) first -= 1;
      if (first === 0 || first === cellParas.length) return; // no content before the tail, or no tail
      const tail = cellParas.slice(first);
      tail.slice(0, -1).forEach(p => { push('doc', { start: p.start, end: p.end, text: '' }); shrunk.push(p.ref); });
      const keep = tail[tail.length - 1];
      push('doc', { start: keep.start, end: keep.end, text: `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${layout.breakParagraph.line}" w:lineRule="exact"/><w:rPr><w:sz w:val="${layout.breakParagraph.size}"/><w:szCs w:val="${layout.breakParagraph.size}"/></w:rPr></w:pPr></w:p>` });
      shrunk.push(keep.ref);
    });
  }
  return { edits, heightsCleared, rowsDeleted, pageBreaks, runBreaks, trailing, trimmed, shrunk };
}

// Makes the heading row start a new page: the table is split in two (same table properties) with a "next page" section break
// between the parts. The section that holds the table is cut there: the first part keeps its page setup, headers, footers and
// page-number start (copied into the break), the second part continues it on a new page. Word, and other renderers, start the
// page at a section break whatever the height of the content before, and pinned (floating) tables that follow are placed on
// it. Tried and rejected on real PDFs: "page break before" on the heading's paragraph (inside a pinned table Word moves the
// table's anchor and adds pages), a page-break paragraph next to the tables (the second pinned table sometimes stays on the
// same page and overlaps the first, or leaves a blank page), and making the second part an inline table.
// Only top-level tables are split, and only when the section's page setup can be found; otherwise nothing is added.
// mode 'none' adds no break.
// A cut spacer run that led to a pinned table (runBreaks) gets the same break: its first paragraph is replaced by the tiny
// paragraph that holds the section break, so the pinned table starts the next page as the spacers made it do.
// Several breaks in one section: the first (in file order) carries the section's page setup, headers and footers, every later one
// carries the stripped continuation.
function breakEdits(outline, xmlOf, breaks, runBreaks, mode, push) {
  const done = [];
  if (mode === 'none') return done;
  const items = [];
  breaks.forEach(b => {
    if (!b.tableTop) return;
    const part = b.paragraph.split('.')[0];
    const xml = xmlOf(part);
    const t = b.tableRef;
    const from = b.headingRow.start;
    const head = xml.slice(t.start, t.rows[0].start);
    items.push({ part, pos: from, split: { tblPr: (head.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/) || [''])[0], tblGrid: (head.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/) || [''])[0] }, info: { table: b.table, row: b.row, how: 'sectionBreak' } });
  });
  (runBreaks || []).forEach(b => {
    items.push({ part: 'doc', pos: b.paragraph.start, replace: { start: b.paragraph.start, end: b.paragraph.end }, info: { table: b.tableRef.ref, row: 0, how: 'sectionBreakInPlaceOfSpacers' } });
  });
  const bySection = new Map();
  items.forEach(it => {
    const xml = xmlOf(it.part);
    const s0 = xml.indexOf('<w:sectPr', it.pos); // the page setup of the section that holds this position is the next one in the file
    const s1 = s0 >= 0 ? xml.indexOf('</w:sectPr>', s0) : -1;
    if (s1 < 0 || (it.split && !it.split.tblGrid)) return; // cannot tell which page setup applies: leave it alone
    const key = `${it.part}:${s0}`;
    if (!bySection.has(key)) bySection.set(key, { part: it.part, s0, s1: s1 + '</w:sectPr>'.length, list: [] });
    bySection.get(key).list.push(it);
  });
  bySection.forEach(g => {
    const xml = xmlOf(g.part);
    const original = xml.slice(g.s0, g.s1);
    // Word refuses a header / footer that two sections both reference, and a second page-number restart or first-page header
    // would show up in the middle of the section, so every part after the first (the last keeps the original section properties)
    // is stripped of them and continues the first.
    const full = original.replace(/<w:type [^>]*\/>/, '');
    const continued = original.replace(/<w:(headerReference|footerReference|pgNumType|titlePg)\b[^>]*\/>/g, '');
    const stripped = continued.replace(/<w:type [^>]*\/>/, '');
    const paraOf = sect => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${layout.breakParagraph.line}" w:lineRule="exact"/><w:rPr><w:sz w:val="${layout.breakParagraph.size}"/><w:szCs w:val="${layout.breakParagraph.size}"/></w:rPr>${sect}</w:pPr></w:p>`;
    g.list.sort((a, b) => a.pos - b.pos).forEach((it, k) => {
      const para = paraOf(k === 0 ? full : stripped);
      if (it.split) push(g.part, { start: it.pos, end: it.pos, text: `</w:tbl>${para}<w:tbl>${it.split.tblPr}${it.split.tblGrid}` });
      else push(g.part, { start: it.replace.start, end: it.replace.end, text: para });
      done.push(it.info);
    });
    push(g.part, { start: g.s0, end: g.s1, text: continued });
  });
  return done;
}

// Estimates (in twips) how tall an empty paragraph is and how tall the page body of a section is, from the document's own
// styles: font size, line spacing and spacing before / after of the paragraph, else of its style, else of the default style,
// else of the document defaults. An estimate is enough: it only tells a run of spacers that carries content to the next page
// from ordinary spacing.
function pageMetrics(stylesXml) {
  const num = (src, re) => { const m = re.exec(src || ''); return m ? Number(m[1]) : null; };
  const spacing = src => { const m = /<w:spacing\b[^>]*>/.exec(src || ''); return m ? m[0] : ''; };
  const attr = (tag, name) => num(tag, new RegExp('w:' + name + '="(-?\\d+)"'));
  const rule = tag => { const m = /w:lineRule="(\w+)"/.exec(tag); return m ? m[1] : 'auto'; };
  const styles = {};
  let normal = '';
  for (const m of (stylesXml || '').matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = (/w:styleId="([^"]+)"/.exec(m[0]) || [])[1];
    if (id) styles[id] = m[0];
    if (/w:default="1"/.test(m[0].slice(0, 200))) normal = m[0];
  }
  const dd = (/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml || '') || [''])[0];
  const pick = (pxml, getter) => {
    const own = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(pxml);
    const sid = (/<w:pStyle w:val="([^"]+)"/.exec(pxml) || [])[1];
    for (const src of [own ? own[0] : '', sid ? styles[sid] : '', normal, dd]) { const v = getter(src); if (v !== null && v !== undefined) return v; }
    return null;
  };
  const sizeOf = src => { const r = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(src || ''); return r ? num(r[0], /<w:sz w:val="(\d+)"/) : null; };
  return {
    paraHeight(pxml) {
      const half = pick(pxml, sizeOf) || 20; // half-points
      const font = half * 10 * 1.17; // twips: font size x the usual line height of a font
      const sp = pick(pxml, src => { const t = spacing(src); return t ? t : null; }) || '';
      const line = attr(sp, 'line'); const lr = rule(sp);
      const before = pick(pxml, src => attr(spacing(src), 'before')) || 0;
      const after = pick(pxml, src => attr(spacing(src), 'after')) || 0;
      const h = line === null ? font : lr === 'exact' ? line : lr === 'atLeast' ? Math.max(line, font) : font * (line / 240);
      return h + before + after;
    },
    bodyHeight(xml, pos) { // the page setup of the section that holds this position is the next one in the file
      const i = xml.indexOf('<w:sectPr', pos);
      const sect = i >= 0 ? xml.slice(i, xml.indexOf('</w:sectPr>', i)) : '';
      const h = attr((/<w:pgSz[^>]*>/.exec(sect) || [''])[0], 'h') || 16838;
      const mar = (/<w:pgMar[^>]*>/.exec(sect) || [''])[0];
      return h - (attr(mar, 'top') ?? 1440) - (attr(mar, 'bottom') ?? 1440);
    },
  };
}

// Returns { buffer, record } ; the buffer is the input itself when nothing was changed or when anything went wrong.
// options.pageBreak: 'sectionBreak' (default) | 'none'. The other options switch the extra rules of this step on and off.
function spacerCleanup(buffer, { applyEdits, pageBreak = layout.sectionPageBreak, trailingRows = layout.spacers.trailingRows, emptyRunMax = layout.spacers.emptyRunMax, emptyRunScope = layout.spacers.emptyRunScope, trailingParagraphs = layout.spacers.trailingParagraphs, pageAdvanceRatio = layout.spacers.pageAdvanceRatio }) {
  try {
    const zip = new PizZip(buffer);
    const outline = buildOutline(buffer);
    const xml = {};
    Object.entries(outline.files).forEach(([part, file]) => { xml[part] = zip.file(file).asText(); });
    const bound = autoBind(extractTags(buffer).tags);
    const imageTags = new Set(Object.entries(bound).filter(([, b]) => b.kind === 'diagrams').map(([name]) => name));
    const { edits, heightsCleared, rowsDeleted, pageBreaks, runBreaks, trailing, trimmed, shrunk } = planFor(outline, part => xml[part], imageTags, { trailingRows, emptyRunMax, emptyRunScope, trailingParagraphs, pageAdvanceRatio, metrics: pageMetrics(zip.file('word/styles.xml') ? zip.file('word/styles.xml').asText() : '') });
    const push = (part, e) => { (edits[part] = edits[part] || []).push(e); };
    const breaksDone = breakEdits(outline, part => xml[part], pageBreaks, runBreaks, pageBreak, push);
    const count = heightsCleared.length + rowsDeleted.length + trailing.length + trimmed.length + shrunk.length + breaksDone.length;
    const cm = twips => Math.round((twips / TWIPS_PER_CM) * 10) / 10;
    const record = {
      rowHeightsCleared: heightsCleared.length,
      emptyRowsDeleted: rowsDeleted.length,
      emptyParagraphsDeleted: rowsDeleted.reduce((n, r) => n + r.paragraphs, 0),
      cmOfFixedHeightRemoved: cm(heightsCleared.reduce((n, r) => n + r.twips, 0) + rowsDeleted.reduce((n, r) => n + r.twips, 0) + trailing.reduce((n, r) => n + r.twips, 0)),
      heightsCleared: heightsCleared.map(r => ({ ...r, cm: cm(r.twips) })),
      rowsDeleted: rowsDeleted.map(r => ({ ...r, cm: cm(r.twips) })),
      pageBreaksKept: breaksDone,
      trailingRowsDeleted: trailing.length,
      emptyParagraphsTrimmed: trimmed.length,
      trailingParagraphsShrunk: shrunk.length,
    };
    if (!count) return { buffer, record };
    Object.entries(edits).forEach(([part, list]) => { zip.file(outline.files[part], applyEdits(xml[part], list)); });
    const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    buildOutline(out); // the result must still read as a document
    return { buffer: out, record };
  } catch (err) {
    return { buffer, record: { skipped: true, reason: String(err && err.message ? err.message : err).slice(0, 200) } };
  }
}

module.exports = { spacerCleanup };
