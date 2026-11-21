const PizZip = require('pizzip');
const { buildOutline, isRedHex } = require('./templateOutlineService');
const { pPrWith, rPrWith } = require('./ooxmlFormat');
const { spacerCleanup } = require('./templateSpacers');
const { picturePPr } = require('./ooxml');
const { wording, layout, terms: termsSettings, outline: outlineSettings } = require('../proposal/renderSettings');
const { ITEM_LOOP, TERMS_LOOP } = require('../proposal/fieldSchema');

// Writes docxtemplater tags into a COPY of an uploaded template, at the locations the admin confirmed, and cleans the copy
// (Word SET sample data, nested / duplicate TOC fields, empty headings). The original file is never modified.
//
// Everything is done as text splices on the XML using the node offsets recorded by the outline, so only the intended
// characters change; run formatting is kept (the red marker is removed from the runs that carry a tag).
//
//   span      the runs holding the sample text lose their text; one new run `{tag}` takes the first run's formatting
//   REF field the whole field is removed and replaced by one `{tag}` run
//   block     the first paragraph becomes `{@tag}` (its paragraph formatting kept); the other paragraphs of the range go
//   table     cells of the sample row get `{column}`, the first cell `{#tag}`, the last cell `{/tag}`
//   image     the red placeholder paragraph becomes `{@tag}`

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TEXT_NODES = ['w:t', 'w:tab', 'w:br', 'w:cr'];
const BODY_TEXT_LEVEL = outlineSettings.bodyTextLevel;
const TAG_TEXT = /\{[#/@^!]?[A-Za-z_][\w.]*\}/;

// rPr source without the red colour / red highlight
function stripRed(rPr) {
  return rPr
    .replace(/<w:color\b[^>]*\/>/g, m => { const v = /w:val="([0-9A-Fa-f]{6})"/.exec(m); return v && isRedHex(v[1]) ? '' : m; })
    .replace(/<w:highlight\b[^>]*w:val="red"[^>]*\/>/gi, '');
}

const newRun = (text, rPr) => `<w:r>${rPr || ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const visible = r => !r.hidden && r.text.trim();

// ---- What cleaning will do (also shown to the admin before confirming) --------------------------------------------------
const pos = (outline, paragraphRef, run) => [outline.paragraphs.findIndex(p => p.ref === paragraphRef), run];
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

// mappedRefs: refs of the REF fields the admin mapped to a slot (they become tags; the others are removed)
function planCleanup(outline, mappedRefs = new Set()) {
  const sets = outline.fields.filter(f => f.kind === 'SET');
  const setNames = new Set(sets.map(f => f.name));
  const refs = outline.fields.filter(f => f.kind === 'REF');
  const refsRemoved = refs.filter(f => setNames.has(f.name) && !mappedRefs.has(f.ref));

  const tocs = outline.fields.filter(f => f.kind === 'TOC');
  const toc = { found: tocs.length, keep: null, unwrap: [], remove: [] };
  if (tocs.length > 1) {
    // keep the complete one: the longest result, the deepest on a tie
    const keep = tocs.slice().sort((a, b) => (b.result.length - a.result.length) || (b.depth - a.depth))[0];
    toc.keep = keep.ref;
    const kb = pos(outline, keep.paragraph, keep.beginRun);
    const ke = pos(outline, keep.endParagraph, keep.endRun);
    tocs.filter(f => f !== keep).forEach(f => {
      const fb = pos(outline, f.paragraph, f.beginRun);
      const fe = pos(outline, f.endParagraph, f.endRun);
      const wraps = !before(kb, fb) && !before(fe, ke); // encloses the kept one
      const inside = !before(fb, kb) && !before(ke, fe); // sits inside the kept one
      (wraps || inside ? toc.unwrap : toc.remove).push(f.ref);
    });
  }

  // Headings with no text (empty, or only a picture) would show as blank contents entries
  const emptyHeadings = outline.paragraphs.filter(p => p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL && !p.text.trim()).map(p => p.ref);

  return {
    setFields: sets.map(f => ({ ref: f.ref, name: f.name, value: f.value })),
    refsRemoved: refsRemoved.map(f => ({ ref: f.ref, name: f.name, shows: f.result })),
    refsMapped: refs.filter(f => mappedRefs.has(f.ref)).length,
    toc,
    emptyHeadings,
  };
}

// ---- Applying edits -------------------------------------------------------------------------------------------------------
function applyEdits(xml, edits) {
  // Changes inside a larger deletion are dropped (the text they touch is gone anyway); partial overlaps are a bug.
  const sorted = edits.slice().sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));
  const kept = [];
  let del = null;
  sorted.forEach(e => {
    const isDel = e.end > e.start;
    if (del && (isDel ? (e.start >= del.start && e.end <= del.end) : (e.start > del.start && e.start < del.end))) return;
    if (del && isDel && e.start < del.end) throw new Error('Internal error: two changes overlap in the template');
    if (isDel) del = e;
    kept.push(e);
  });
  let out = xml;
  kept.sort((a, b) => (b.start - a.start) || ((b.end - b.start) - (a.end - a.start)))
    .forEach(e => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  return out;
}

// entries: the confirmed mapping (accepted locations). Returns { buffer, changes }.
// options.spacerCleanup === false switches the spacer cleanup (templateSpacers.js) off; it is on by default.
// options.pageBreak overrides how a heading that must keep starting its page is forced onto a new page (see renderSettings).
function writeTags(buffer, entries, options = {}) {
  const zip = new PizZip(buffer);
  const outline = buildOutline(buffer);
  const xml = Object.fromEntries(Object.entries(outline.files).map(([part, file]) => [part, zip.file(file).asText()]));
  const edits = Object.fromEntries(Object.keys(xml).map(p => [p, []]));
  const partOf = ref => ref.split('.')[0];
  const para = ref => outline.paragraphs.find(p => p.ref === ref);
  const table = ref => outline.tables.find(t => t.ref === ref);
  const rPrOf = (part, run) => (run && run.rPrNode ? stripRed(xml[part].slice(run.rPrNode.start, run.rPrNode.end)) : '');
  const del = (part, node) => edits[part].push({ start: node.start, end: node.end, text: '' });
  const insert = (part, at, text) => edits[part].push({ start: at, end: at, text });
  const changes = { tags: [], setFieldsRemoved: [], refsRemoved: [], refsMapped: 0, toc: null, headingsFixed: 0, redRemoved: 0 };
  const deleted = Object.fromEntries(Object.keys(xml).map(p => [p, []]));
  const delNode = (part, n) => { del(part, n); deleted[part].push(n); };

  // The requirements block becomes a {#requirements} loop (title, description, the product's own picture), so every product's
  // diagram sits right after its description. Done unless the author already wrote such a loop. The {@diagramsXml} placeholder,
  // if there is one, goes away: the pictures are in the loop now.
  const cellKey = p => (p.cell ? `${p.cell.table}.${p.cell.r}.${p.cell.c}` : '-');
  const isHeading = p => p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL;
  const pPrSrc = (part, p) => (p.pPrInfo ? xml[part].slice(p.pPrInfo.start, p.pPrInfo.end) : '');
  const sampleRPr = (part, p) => { const r = p.runs.find(x => x.red && visible(x)) || p.runs.find(visible) || p.runs[0]; return r ? rPrOf(part, r) : ''; };
  const LOOP = ITEM_LOOP.loop;
  const authorLoop = outline.paragraphs.some(p => p.text.includes(`{#${LOOP}}`));
  const reqEntry = entries.find(e => e.key === ITEM_LOOP.blockSlot && e.status === 'found' && e.kind === 'block');
  const aloneReq = reqEntry ? null : outline.paragraphs.find(p => p.text.trim() === `{@${ITEM_LOOP.blockSlot}}`);
  const diagEntry = entries.find(e => e.key === ITEM_LOOP.pictureSlot && e.status === 'found' && e.kind === 'image' && e.paragraph);
  const diagTagPara = outline.paragraphs.find(p => p.text.trim() === `{@${ITEM_LOOP.pictureSlot}}`);
  const makeLoop = !authorLoop && !!(reqEntry || aloneReq);
  const withDiagram = makeLoop && !!(diagEntry || diagTagPara);
  const loopInfo = makeLoop ? { withDiagram, diagramsRemoved: false } : null;
  const loopTag = tag => newRun(tag, '');

  // title line, description line and (when the template has a diagram place) the product's picture, between the loop tags.
  // Each takes the formatting of the template's own sample paragraph (red marking and heading style removed).
  function requirementsLoopXml(part, titleSrc, descSrc, single) {
    const title = `<w:p>${pPrWith(pPrSrc(part, titleSrc), { jc: layout.itemTitleAlign, keepNext: true, dropStyle: isHeading(titleSrc) })}${newRun(wording.itemLines.title, rPrWith(sampleRPr(part, titleSrc), { bold: true }))}</w:p>`;
    const desc = `<w:p>${pPrWith(pPrSrc(part, descSrc), { jc: single ? layout.itemDescriptionAlign : undefined, dropStyle: isHeading(descSrc) })}${newRun(wording.itemLines.description, sampleRPr(part, descSrc))}</w:p>`;
    const picture = withDiagram ? `<w:p>${picturePPr()}${newRun(`{@${ITEM_LOOP.pictureColumn}}`, '')}</w:p>` : '';
    return `<w:p>${loopTag(`{#${LOOP}}`)}</w:p>${title}${desc}${picture}<w:p>${loopTag(`{/${LOOP}}`)}</w:p>`;
  }
  // a placeholder paragraph that is no longer needed: removed, or emptied when it is the only paragraph of its cell
  function dropPlaceholder(p) {
    const part = partOf(p.ref);
    const siblings = outline.paragraphs.filter(q => partOf(q.ref) === part && cellKey(q) === cellKey(p)).length;
    edits[part].push({ start: p.start, end: p.end, text: siblings > 1 ? '' : '<w:p/>' });
    blockedParas.add(p.ref);
  }

  // 1. confirmed locations -> tags
  const mappedRefs = new Set();
  const blockedParas = new Set(); // paragraphs replaced or deleted as part of a block / image slot
  entries.filter(e => e.status === 'found').forEach(e => {
    const tag = e.key;
    if (e.kind === 'span') {
      (e.locations || []).forEach(l => {
        const p = para(l.paragraph);
        const part = partOf(p.ref);
        const field = outline.fields.find(f => f.kind === 'REF' && f.paragraph === p.ref && f.runs && f.runs[0] === l.runs[0] && f.runs[1] === l.runs[1]);
        if (field) {
          mappedRefs.add(field.ref);
          field.all.forEach(n => delNode(part, n));
          const src = p.runs.slice(l.runs[0], l.runs[1] + 1);
          const fmt = src.find(visible) || p.runs[l.runs[0]];
          insert(part, p.runs[l.runs[0]].start, newRun(`{${tag}}`, rPrOf(part, fmt)));
          changes.refsMapped += 1;
        } else {
          const runs = p.runs.slice(l.runs[0], l.runs[1] + 1);
          runs.forEach(r => r.nodes.filter(n => TEXT_NODES.includes(n.name)).forEach(n => delNode(part, n)));
          const fmt = runs.find(visible) || runs[0];
          insert(part, runs[0].start, newRun(`{${tag}}`, rPrOf(part, fmt)));
        }
        changes.tags.push({ tag, at: `${l.paragraph}.r${l.runs[0]}${l.runs[1] !== l.runs[0] ? `-${l.runs[1]}` : ''}` });
      });
    } else if (e.kind === 'block' || (e.kind === 'image' && e.paragraph)) {
      const refs = e.kind === 'block' ? e.paragraphs : [e.paragraph, e.paragraph];
      const first = para(refs[0]);
      const last = para(refs[1]);
      const part = partOf(first.ref);
      const range = outline.paragraphs.filter(p => partOf(p.ref) === part && p.index >= first.index && p.index <= last.index);
      const cells = new Set(range.map(p => (p.cell ? `${p.cell.table}.${p.cell.r}.${p.cell.c}` : '-')));
      if (cells.size > 1) throw Object.assign(new Error(`The block for "${e.label}" spans several table cells or leaves a table; choose paragraphs inside one place`), { status: 400 });
      const first0 = range[0];
      const fmt = first0.runs.find(r => r.red && visible(r)) || first0.runs.find(visible) || first0.runs[0];
      const at = `${refs[0]}${refs[0] !== refs[1] ? `..${refs[1]}` : ''}`;
      if (makeLoop && e.key === ITEM_LOOP.pictureSlot) {
        dropPlaceholder(first0); // the pictures are in the requirements loop now
        loopInfo.diagramsRemoved = true;
        return;
      }
      let replacement;
      if (makeLoop && e.key === ITEM_LOOP.blockSlot) {
        const filled = range.filter(p => p.text.trim());
        replacement = requirementsLoopXml(part, filled[0] || first0, filled[1] || filled[0] || first0, filled.length < 2);
        loopInfo.at = at;
        changes.tags.push({ tag: LOOP, at });
      } else {
        const pPr = first0.pPrInfo ? xml[part].slice(first0.pPrInfo.start, first0.pPrInfo.end) : '';
        replacement = `<w:p>${pPr}${newRun(`{@${tag}}`, fmt ? rPrOf(part, fmt) : '')}</w:p>`;
        changes.tags.push({ tag, at });
      }
      edits[part].push({ start: first0.start, end: first0.end, text: replacement });
      range.forEach(p => blockedParas.add(p.ref));
      range.slice(1).forEach(p => edits[part].push({ start: p.start, end: p.end, text: '' }));
    } else if (e.kind === 'table') {
      const t = table(e.table);
      const row = t.rows[e.templateRow];
      const part = partOf(e.table);
      const last = row.cells.length - 1;
      const columnOfCell = Object.fromEntries(Object.entries(e.columns).map(([col, ci]) => [ci, col]));
      row.cells.forEach((cellRec, ci) => {
        const ps = cellRec.paragraphs.map(r => para(r));
        const p = ps.find(x => x.runs.length) || ps[0];
        if (!p) return;
        const col = columnOfCell[ci];
        const parts = [ci === 0 ? `{#${e.key}}` : '', col ? `{${col}}` : '', ci === last ? `{/${e.key}}` : ''].join('');
        const hasRed = cellRec.red;
        if (col || hasRed) {
          // the cell's sample text is replaced by the tag (or just cleared for a column that is not mapped)
          const textRuns = p.runs.filter(r => r.nodes.some(n => TEXT_NODES.includes(n.name)));
          textRuns.forEach(r => r.nodes.filter(n => TEXT_NODES.includes(n.name)).forEach(n => delNode(part, n)));
          if (parts) {
            const fmt = p.runs.find(r => r.red && visible(r)) || p.runs.find(visible) || p.runs[0];
            if (p.runs.length) insert(part, (textRuns[0] || p.runs[0]).start, newRun(parts, fmt ? rPrOf(part, fmt) : ''));
            else insert(part, p.openEnd, newRun(parts, ''));
          }
        } else if (parts) {
          // a fixed cell keeps its content; only the loop marker is added
          if (ci === 0) insert(part, p.runs.length ? p.runs[0].start : p.openEnd, newRun(`{#${e.key}}`, ''));
          if (ci === last) insert(part, p.closeStart, newRun(`{/${e.key}}`, ''));
        }
      });
      changes.tags.push({ tag: e.key, at: `${e.table} row ${e.templateRow}` });
    }
  });
  changes.refsMapped = changes.refsMapped || 0;
  if (makeLoop && aloneReq) {
    // the template already has a {@requirementsXml} paragraph of its own
    const part = partOf(aloneReq.ref);
    edits[part].push({ start: aloneReq.start, end: aloneReq.end, text: requirementsLoopXml(part, aloneReq, aloneReq, true) });
    blockedParas.add(aloneReq.ref);
    loopInfo.at = aloneReq.ref;
    changes.tags.push({ tag: LOOP, at: aloneReq.ref });
  }
  if (makeLoop && !diagEntry && diagTagPara) {
    dropPlaceholder(diagTagPara);
    loopInfo.diagramsRemoved = true;
  }
  changes.requirementsLoop = loopInfo;

  // 2. Word SET fields hold old sample data: removed, with their bookmarks; REF fields that showed them are removed
  //    unless they were mapped to a slot above
  const plan = planCleanup(outline, mappedRefs);
  const byRef = Object.fromEntries(outline.fields.map(f => [f.ref, f]));
  const partOfField = f => partOf(f.paragraph);
  outline.fields.filter(f => f.kind === 'SET').forEach(f => { f.all.forEach(n => delNode(partOfField(f), n)); changes.setFieldsRemoved.push({ name: f.name, value: f.value }); });
  const setNames = new Set(plan.setFields.map(s => s.name));
  outline.bookmarks.filter(b => !b.isEnd && setNames.has(b.name)).forEach(b => {
    const part = Object.keys(outline.files).find(k => outline.files[k] === b.file);
    delNode(part, b);
    const end = outline.bookmarks.find(x => x.isEnd && x.id === b.id && x.file === b.file);
    if (end) delNode(part, end);
  });
  plan.refsRemoved.forEach(r => {
    const f = byRef[r.ref];
    // a REF whose shown value is already a {tag} (the author put the tag inside the field) keeps its text; only the field goes
    const nodes = TAG_TEXT.test(f.result) ? f.controls : f.all;
    nodes.forEach(n => delNode(partOfField(f), n));
    changes.refsRemoved.push({ name: r.name, shows: r.shows });
  });

  // 3. nested / duplicate table of contents: keep one
  const touched = new Set();
  if (plan.toc.keep) {
    plan.toc.unwrap.forEach(ref => { const f = byRef[ref]; f.controls.forEach(n => delNode(partOfField(f), n)); touched.add(f.paragraph); touched.add(f.endParagraph); });
    plan.toc.remove.forEach(ref => {
      const f = byRef[ref];
      const part = partOfField(f);
      f.all.forEach(n => delNode(part, n));
      const a = para(f.paragraph).index;
      const b = para(f.endParagraph).index;
      outline.paragraphs.filter(p => partOf(p.ref) === part && p.index > a && p.index < b).forEach(p => { edits[part].push({ start: p.start, end: p.end, text: '' }); blockedParas.add(p.ref); });
      touched.add(f.paragraph); touched.add(f.endParagraph);
    });
    changes.toc = { found: plan.toc.found, kept: plan.toc.keep, unwrapped: plan.toc.unwrap, removed: plan.toc.remove };
    // a paragraph left with nothing but removed field codes is deleted
    touched.forEach(ref => {
      const p = para(ref);
      if (!p || blockedParas.has(ref)) return;
      const part = partOf(ref);
      const inDeleted = n => deleted[part].some(d => d.start <= n.start && n.end <= d.end);
      const empty = !p.runs.some(r => r.nodes.some(n => !inDeleted(n))) && !outline.bookmarks.some(b => b.start > p.start && b.end < p.end && !inDeleted(b));
      if (empty && /^TOC/i.test(p.style)) { edits[part].push({ start: p.start, end: p.end, text: '' }); blockedParas.add(ref); }
    });
  }

  // 4. headings with no text: outline level 9 (body text) so they do not become blank contents entries
  plan.emptyHeadings.forEach(ref => {
    const p = para(ref);
    if (blockedParas.has(ref)) return;
    const part = partOf(ref);
    const lvl = `<w:outlineLvl w:val="${BODY_TEXT_LEVEL}"/>`;
    const info = p.pPrInfo;
    if (!info) insert(part, p.openEnd, `<w:pPr>${lvl}</w:pPr>`);
    else if (info.outlineLvl) edits[part].push({ start: info.outlineLvl.start, end: info.outlineLvl.end, text: lvl });
    else if (info.selfClosing) edits[part].push({ start: info.start, end: info.end, text: `<w:pPr>${lvl}</w:pPr>` });
    else insert(part, info.before !== undefined ? info.before : info.closeStart, lvl);
    changes.headingsFixed += 1;
  });

  Object.keys(edits).forEach(part => { zip.file(outline.files[part], applyEdits(xml[part], edits[part])); });
  let tagged = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  // 5. the red marker is only a marker: removed from every run that carries a tag
  const pass = redOffTagRuns(tagged);
  tagged = pass.buffer;
  changes.redRemoved = pass.count;

  // 5b. the author's {#productTerms} loop: its lines must not be headings (they would become contents entries)
  const termsPass = termsLoopLines(tagged);
  tagged = termsPass.buffer;
  changes.termsLoop = termsPass.record;

  // 6. blank space the template reserves for its sample text (tall empty rows); never fails the upload
  if (options.spacerCleanup !== false) {
    const cleaned = spacerCleanup(tagged, { applyEdits, ...(options.pageBreak ? { pageBreak: options.pageBreak } : {}), ...(options.spacer || {}) });
    tagged = cleaned.buffer;
    changes.spacerCleanup = cleaned.record;
  }
  return { buffer: tagged, changes, plan };
}

// Removes the red colour / highlight from runs that hold part of a {tag}
function redOffTagRuns(buffer) {
  return redOffTagRunsImpl(buffer);
}

// The product terms loop is written by the template author: {#productTerms}, a title line, the terms line, {/productTerms}, each
// in its own paragraph. Their formatting is the author's own and is not changed, except that
//   - a heading style on a line of the loop is removed (a heading would be listed in the table of contents once per product)
//   - the first line (the title) is kept on the same page as the line after it (settings: terms.keepTitleWithText)
// A template without the loop is returned unchanged. record = null | { lines, headingStyleRemoved, titleKeptWithText }.
function termsLoopLines(buffer) {
  const outline = buildOutline(buffer);
  const open = outline.paragraphs.findIndex(p => p.text.trim() === `{#${TERMS_LOOP}}`);
  const close = outline.paragraphs.findIndex((p, i) => i > open && p.text.trim() === `{/${TERMS_LOOP}}`);
  if (open === -1 || close === -1) return { buffer, record: null };
  const zip = new PizZip(buffer);
  const lines = outline.paragraphs.slice(open + 1, close).filter(p => p.text.trim());
  const record = { lines: lines.length, headingStyleRemoved: 0, titleKeptWithText: false };
  const edits = {};
  lines.forEach((p, n) => {
    const heading = p.outlineLevel !== undefined && p.outlineLevel < BODY_TEXT_LEVEL;
    const keepNext = termsSettings.keepTitleWithText && n === 0 && lines.length > 1;
    if (!heading && !keepNext) return;
    const file = outline.files[p.ref.split('.')[0]];
    const e = (edits[file] = edits[file] || { xml: zip.file(file).asText(), list: [] });
    if (!p.pPrInfo) e.list.push({ start: p.openEnd, end: p.openEnd, text: '<w:pPr><w:keepNext/></w:pPr>' });
    else e.list.push({ start: p.pPrInfo.start, end: p.pPrInfo.end, text: pPrWith(e.xml.slice(p.pPrInfo.start, p.pPrInfo.end), { keepList: true, keepNext, dropStyle: heading }) });
    if (heading) record.headingStyleRemoved += 1;
    if (keepNext) record.titleKeptWithText = true;
  });
  Object.entries(edits).forEach(([file, e]) => zip.file(file, applyEdits(e.xml, e.list)));
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), record };
}

function redOffTagRunsImpl(buffer) {
  const zip = new PizZip(buffer);
  const outline = buildOutline(buffer);
  const edits = {};
  let count = 0;
  const TAG = /\{[#/@^!]?[A-Za-z_][\w.]*\}/g;
  outline.paragraphs.forEach(p => {
    const runs = p.runs.filter(r => !r.hidden);
    const full = runs.map(r => r.text).join('');
    const starts = [];
    let o = 0;
    runs.forEach(r => { starts.push(o); o += r.text.length; });
    let m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(full)) !== null) {
      runs.forEach((r, i) => {
        const a = starts[i], b = starts[i] + r.text.length;
        if (!(r.red && r.rPrNode && a < m.index + m[0].length && b > m.index)) return;
        const file = outline.files[p.ref.split('.')[0]];
        (edits[file] = edits[file] || []).push({ run: r, start: r.rPrNode.start, end: r.rPrNode.end });
      });
    }
  });
  Object.entries(edits).forEach(([file, list]) => {
    const xml = zip.file(file).asText();
    const seen = new Set();
    const splices = list.filter(e => (seen.has(e.start) ? false : seen.add(e.start))).map(e => ({ start: e.start, end: e.end, text: stripRed(xml.slice(e.start, e.end)) }));
    count += splices.length;
    zip.file(file, applyEdits(xml, splices));
  });
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), count };
}

module.exports = { writeTags, planCleanup, applyEdits, stripRed, redOffTagRuns, termsLoopLines };
