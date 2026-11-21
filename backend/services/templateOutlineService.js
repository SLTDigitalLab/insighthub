const PizZip = require('pizzip');
const { parse, decode, child, textOf } = require('./ooxmlTree');

// Structured outline of an uploaded .docx, read without any template tags: paragraphs and table cells in document order,
// run formatting (red text marks the variable parts of a template), tables, images, and Word fields.
//
// References (stable for one file, used by the mapper and by the tag writer):
//   <part>.p<N>            paragraph N of the part, in document order (paragraphs inside table cells and text boxes count too)
//   <part>.p<N>.r<M>       run M of that paragraph
//   <part>.t<T>            table T;  <part>.t<T>.r<R>.c<C> = a cell
//   <part>.img<N>          image N
// <part> is "doc" for word/document.xml, otherwise the file name without extension (header1, footer2, ...).

const { outline: outlineSettings } = require('../proposal/renderSettings');
const RED_MIN = outlineSettings.redMin;
const RED_MAX_OTHER = outlineSettings.redMaxOther;

function isRedHex(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex || '')) return false;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return r >= RED_MIN && g <= RED_MAX_OTHER && b <= RED_MAX_OTHER;
}

const partName = file => (file === 'word/document.xml' ? 'doc' : file.replace(/^word\//, '').replace(/\.xml$/, ''));
const val = (node, name) => { const c = node && child(node, name); return c ? c.attrs['w:val'] : undefined; };

// style id -> heading level, from word/styles.xml
function headingLevels(zip) {
  const levels = {};
  const f = zip.file('word/styles.xml');
  if (!f) return levels;
  (function walk(n) {
    if (n.name === 'w:style' && n.attrs['w:type'] === 'paragraph') {
      const name = String(val(n, 'w:name') || '');
      const m = /^(?:heading|Heading)\s*(\d)$/.exec(name);
      if (m) levels[n.attrs['w:styleId']] = Number(m[1]);
      else if (/^title$/i.test(name)) levels[n.attrs['w:styleId']] = 0;
    }
    (n.children || []).forEach(walk);
  }(parse(f.asText())));
  return levels;
}

// style id -> outline level (0 = Heading 1 ... 8 = Heading 9), following basedOn; undefined = body text
function outlineLevels(zip) {
  const styles = {};
  const f = zip.file('word/styles.xml');
  if (!f) return {};
  (function walk(n) {
    if (n.name === 'w:style' && n.attrs['w:type'] === 'paragraph') {
      const pPr = child(n, 'w:pPr');
      const own = pPr && child(pPr, 'w:outlineLvl');
      const name = String(val(n, 'w:name') || '');
      const m = /^heading\s*(\d)$/i.exec(name);
      styles[n.attrs['w:styleId']] = {
        basedOn: val(n, 'w:basedOn'),
        level: own ? Number(own.attrs['w:val']) : (m ? Number(m[1]) - 1 : undefined),
      };
    }
    (n.children || []).forEach(walk);
  }(parse(f.asText())));
  const resolve = (id, depth = 0) => {
    const s = styles[id];
    if (!s || depth > 10) return undefined;
    return s.level !== undefined ? s.level : resolve(s.basedOn, depth + 1);
  };
  return Object.fromEntries(Object.keys(styles).map(id => [id, resolve(id)]).filter(([, l]) => l !== undefined));
}

function relationships(zip, file) {
  const rels = {};
  const f = zip.file(file.replace(/([^/]+)$/, '_rels/$1.rels'));
  if (!f) return rels;
  (function walk(n) {
    if (n.name === 'Relationship') rels[n.attrs.Id] = n.attrs.Target;
    (n.children || []).forEach(walk);
  }(parse(f.asText())));
  return rels;
}

function readRunProps(rPr) {
  const color = rPr && child(rPr, 'w:color');
  const hex = color && color.attrs['w:val'] ? color.attrs['w:val'].toUpperCase() : '';
  const highlight = String(val(rPr, 'w:highlight') || '');
  const b = rPr && child(rPr, 'w:b');
  return {
    color: hex,
    themeColor: !!(color && color.attrs['w:themeColor']),
    highlight,
    red: isRedHex(hex) || highlight.toLowerCase() === 'red',
    bold: !!b && b.attrs['w:val'] !== '0' && b.attrs['w:val'] !== 'false',
  };
}

function analysePart(file, xml, ctxShared) {
  const part = partName(file);
  const root = parse(xml);
  const rels = relationships(ctxShared.zip, file);
  const out = { part, file, paragraphs: [], tables: [], images: [], fields: [], bookmarks: [] };
  const fieldStack = []; // open Word fields: { kind, instr, phase, depth, result, para, run }
  const tableStack = [];
  let cell = null;
  let inTextBox = 0;

  function newPara(node) {
    const pPr = child(node, 'w:pPr');
    const style = String(val(pPr, 'w:pStyle') || '');
    const directLevel = pPr && child(pPr, 'w:outlineLvl');
    const level = directLevel ? Number(directLevel.attrs['w:val']) : ctxShared.outline[style];
    const para = {
      // where an outline level can be written (see templateTagWriter)
      pPrInfo: pPr ? { start: pPr.start, end: pPr.end, openEnd: pPr.openEnd, closeStart: pPr.closeStart, selfClosing: !!pPr.selfClosing, outlineLvl: directLevel ? { start: directLevel.start, end: directLevel.end } : null, before: ((pPr.children || []).find(c => ['w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'].includes(c.name)) || {}).start } : null,
      openEnd: node.openEnd,
      closeStart: node.closeStart,
      ...(level !== undefined ? { outlineLevel: level } : {}),
      ref: `${part}.p${out.paragraphs.length}`,
      index: out.paragraphs.length,
      style,
      text: '',
      runs: [],
      ...(style in ctxShared.headings ? { heading: ctxShared.headings[style] } : {}),
      ...(cell ? { cell: { ...cell } } : {}),
      ...(inTextBox ? { textBox: true } : {}),
      start: node.start,
      end: node.end,
    };
    out.paragraphs.push(para);
    return para;
  }

  function addImage(node, para, run) {
    const blip = (function find(n) {
      if (n.name === 'a:blip' && n.attrs['r:embed']) return n.attrs['r:embed'];
      if (n.name === 'v:imagedata' && n.attrs['r:id']) return n.attrs['r:id'];
      for (const c of n.children || []) { const r = find(c); if (r) return r; }
      return null;
    }(node));
    if (!blip) return;
    const extent = (function find(n) {
      if (n.name === 'wp:extent') return n;
      for (const c of n.children || []) { const r = find(c); if (r) return r; }
      return null;
    }(node));
    const docPr = (function find(n) {
      if (n.name === 'wp:docPr') return n;
      for (const c of n.children || []) { const r = find(c); if (r) return r; }
      return null;
    }(node));
    out.images.push({
      ref: `${part}.img${out.images.length}`,
      paragraph: para ? para.ref : '',
      run: run,
      anchored: !!(function find(n) { if (n.name === 'wp:anchor') return true; return (n.children || []).some(find); }(node)),
      media: rels[blip] || '',
      name: docPr ? decode(docPr.attrs.name || '') : '',
      widthEmu: extent ? Number(extent.attrs.cx) || 0 : 0,
      heightEmu: extent ? Number(extent.attrs.cy) || 0 : 0,
      ...(para && para.cell ? { cell: para.cell } : {}),
    });
  }

  function fieldEnd(top, para, runIndex) {
    const instr = top.instr.replace(/\s+/g, ' ').trim();
    const kind = (instr.split(' ')[0] || '').toUpperCase();
    const rec = {
      ref: `${part}.f${out.fields.length}`,
      kind,
      instr,
      depth: top.depth,
      paragraph: top.para,
      endParagraph: para.ref,
      // first and last run of the whole field (begin .. end), when it sits in one paragraph
      ...(top.para === para.ref ? { runs: [top.run, runIndex] } : {}),
      beginRun: top.run,
      endRun: runIndex,
      result: top.result.replace(/\s+/g, ' ').trim(),
      // child nodes (fldChar / instrText) of this field's own control runs, and every node inside it (nested fields, results);
      // used to remove a field without touching anything else in its runs
      controls: top.controls,
      all: top.all,
    };
    const parent = fieldStack[fieldStack.length - 1];
    if (parent) rec.insideKind = (parent.instr.split(' ')[0] || '').toUpperCase();
    if (kind === 'SET') {
      const m = /^SET\s+(\S+)\s*(?:"([^"]*)"|(\S+))?/i.exec(instr);
      if (m) { rec.name = m[1]; rec.value = m[2] !== undefined ? m[2] : (m[3] || ''); }
    } else if (kind === 'REF' || kind === 'PAGEREF') {
      const m = /^(?:PAGE)?REF\s+(\S+)/i.exec(instr);
      if (m) rec.name = m[1];
    }
    out.fields.push(rec);
  }

  function processRun(run, para) {
    const rPr = child(run, 'w:rPr');
    const rec = {
      index: para.runs.length,
      text: '',
      ...readRunProps(rPr),
      vanish: !!(rPr && child(rPr, 'w:vanish')),
      start: run.start,
      end: run.end,
      openEnd: run.openEnd,
      rPrNode: rPr ? { start: rPr.start, end: rPr.end } : null,
      // text-carrying children, for in-place edits
      nodes: [],
    };
    const top = () => fieldStack[fieldStack.length - 1];
    const node = c => ({ start: c.start, end: c.end, name: c.name });
    const emitAll = c => fieldStack.forEach(f => f.all.push(node(c)));
    let inCode = false;
    (run.children || []).forEach(c => {
      if (['w:t', 'w:tab', 'w:br', 'w:cr', 'w:instrText', 'w:fldChar', 'w:drawing', 'w:pict', 'w:object', 'mc:AlternateContent'].includes(c.name)) rec.nodes.push(node(c));
      switch (c.name) {
        case 'w:t': {
          const t = decode(textOf(c));
          if (top() && top().phase === 'code') break;
          emitAll(c);
          rec.text += t;
          // Text that is not shown: hidden formatting, or the stored result of a SET field (SET shows nothing)
          if (rec.vanish || (top() && top().phase === 'result' && /^SET/i.test(top().instr.trim()))) rec.hidden = true;
          if (top()) top().result += t;
          break;
        }
        case 'w:tab': rec.text += '\t'; emitAll(c); break;
        case 'w:br': case 'w:cr': rec.text += '\n'; emitAll(c); break;
        case 'w:instrText': {
          inCode = true;
          if (top()) { top().instr += decode(textOf(c)); top().controls.push(node(c)); emitAll(c); }
          break;
        }
        case 'w:fldChar': {
          const type = c.attrs['w:fldCharType'];
          if (type === 'begin') {
            fieldStack.push({ instr: '', phase: 'code', depth: fieldStack.length, result: '', para: para.ref, run: rec.index, controls: [], all: [] });
            top().controls.push(node(c));
            emitAll(c);
          } else if (type === 'separate' && top()) {
            top().phase = 'result';
            top().controls.push(node(c));
            emitAll(c);
          } else if (type === 'end' && top()) {
            top().controls.push(node(c));
            emitAll(c);
            const f = fieldStack.pop();
            fieldEnd(f, para, rec.index);
          }
          rec.fldChar = type;
          break;
        }
        case 'w:drawing': case 'w:pict': case 'w:object': case 'mc:AlternateContent': {
          addImage(c, para, rec.index);
          if (top() && top().phase === 'result') emitAll(c);
          walk(c);
          break;
        }
        default: break;
      }
    });
    rec.inFieldCode = inCode;
    para.runs.push(rec);
    if (!rec.hidden) para.text += rec.text;
  }

  function paraContent(node, para) {
    (node.children || []).forEach(c => {
      if (c.name === 'w:r') processRun(c, para);
      else if (c.name === 'w:bookmarkStart') out.bookmarks.push({ id: c.attrs['w:id'], name: c.attrs['w:name'], start: c.start, end: c.end, end2: null });
      else if (c.name === 'w:bookmarkEnd') out.bookmarks.push({ id: c.attrs['w:id'], isEnd: true, start: c.start, end: c.end });
      else if (c.name === 'w:p' || c.name === 'mc:Fallback' || c.name === 'w:pPr') { /* nested paragraphs are reached through walk() */ }
      else if (c.name !== '#text') paraContent(c, para);
    });
  }

  function walk(node) {
    (node.children || []).forEach(c => {
      if (c.name === 'mc:Fallback') return; // the same content again, for old readers
      if (c.name === 'w:p') {
        const para = newPara(c);
        paraContent(c, para);
      } else if (c.name === 'w:tbl') {
        const t = { ref: `${part}.t${out.tables.length}`, rows: [], start: c.start, end: c.end, ...(cell ? { parentCell: { ...cell } } : {}) };
        out.tables.push(t);
        tableStack.push(t);
        let r = -1;
        (c.children || []).forEach(row => {
          if (row.name !== 'w:tr') return;
          r += 1;
          const trPr = child(row, 'w:trPr');
          const trH = trPr && child(trPr, 'w:trHeight');
          t.rows.push({
            index: r,
            header: !!(trPr && child(trPr, 'w:tblHeader')),
            // where the row is in the XML and its fixed height, for the spacer cleanup (templateSpacers.js)
            start: row.start,
            end: row.end,
            ...(trH ? { trHeight: { start: trH.start, end: trH.end, twips: Number(trH.attrs['w:val']) || 0, rule: trH.attrs['w:hRule'] || 'atLeast' } } : {}),
            cells: [],
          });
          let ci = -1;
          (row.children || []).forEach(tc => {
            if (tc.name !== 'w:tc') return;
            ci += 1;
            const saved = cell;
            cell = { table: t.ref, r, c: ci };
            t.rows[r].cells.push({ index: ci });
            walk(tc);
            cell = saved;
          });
        });
        tableStack.pop();
      } else if (c.name === 'w:txbxContent') {
        inTextBox += 1;
        const saved = cell;
        cell = null;
        walk(c);
        cell = saved;
        inTextBox -= 1;
      } else if (c.name !== '#text') {
        walk(c);
      }
    });
  }

  const body = (function find(n) { if (n.name === 'w:body' || n.name === 'w:hdr' || n.name === 'w:ftr') return n; for (const c of n.children || []) { const r = find(c); if (r) return r; } return null; }(root));
  if (body) walk(body);

  // Table cell texts / red flags from the paragraphs inside them
  out.tables.forEach(t => {
    t.rows.forEach(row => row.cells.forEach(cellRec => {
      const ps = out.paragraphs.filter(p => p.cell && p.cell.table === t.ref && p.cell.r === row.index && p.cell.c === cellRec.index);
      cellRec.text = ps.map(p => p.text.trim()).filter(Boolean).join(' / ');
      cellRec.red = ps.some(p => p.runs.some(r => r.red && r.text.trim()));
      cellRec.paragraphs = ps.map(p => p.ref);
    }));
    t.headerRow = Math.max(0, t.rows.findIndex(r => r.header));
  });
  return out;
}

// Returns the full outline of the document.
function buildOutline(buffer) {
  const zip = new PizZip(buffer);
  const shared = { zip, headings: headingLevels(zip), outline: outlineLevels(zip) };
  const files = Object.keys(zip.files)
    .filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .sort((a, b) => (b === 'word/document.xml') - (a === 'word/document.xml') || a.localeCompare(b));
  const parts = files.map(f => analysePart(f, zip.file(f).asText(), shared));

  const outline = {
    parts: parts.map(p => ({ part: p.part, file: p.file })),
    paragraphs: parts.flatMap(p => p.paragraphs),
    tables: parts.flatMap(p => p.tables),
    images: parts.flatMap(p => p.images),
    fields: parts.flatMap(p => p.fields),
    bookmarks: parts.flatMap(p => p.bookmarks.map(b => ({ ...b, file: p.file }))),
    files: Object.fromEntries(parts.map(p => [p.part, p.file])),
  };
  outline.report = reportOf(outline);
  return outline;
}

// ---- What the admin should know about the file --------------------------------------------------------------------------
function reportOf(outline) {
  const sets = outline.fields.filter(f => f.kind === 'SET');
  const refs = outline.fields.filter(f => f.kind === 'REF');
  const tocs = outline.fields.filter(f => f.kind === 'TOC');
  const warnings = [];

  const sample = sets.filter(f => f.value);
  if (sample.length) {
    warnings.push({
      kind: 'merge_field_sample_data',
      message: `The template has ${sample.length} Word SET field(s) holding sample values (${sample.slice(0, 6).map(f => `${f.name} = "${f.value}"`).join('; ')}${sample.length > 6 ? '; …' : ''}). They are removed in the tagged copy so old sample data cannot print.`,
    });
  }
  const nestedToc = tocs.filter(f => f.insideKind === 'TOC' || f.depth > 0);
  const identical = Object.values(tocs.reduce((o, f) => ({ ...o, [f.instr]: (o[f.instr] || 0) + 1 }), {})).some(n => n > 1);
  if (tocs.length > 1 || nestedToc.length) {
    warnings.push({
      kind: 'toc_fields',
      message: `The template has ${tocs.length} table-of-contents field(s)${nestedToc.length ? `, ${nestedToc.length} of them nested inside another field` : ''}${identical ? ', with identical instructions' : ''}. Check the contents page after the first export.`,
    });
  }
  const redRuns = outline.paragraphs.reduce((n, p) => n + p.runs.filter(r => r.red && r.text.trim()).length, 0);
  const themed = outline.paragraphs.reduce((n, p) => n + p.runs.filter(r => r.themeColor).length, 0);
  if (themed) warnings.push({ kind: 'theme_colours', message: `${themed} run(s) use a theme colour; their red/not-red status is unknown and they are not treated as markers.` });

  return {
    stats: {
      paragraphs: outline.paragraphs.length,
      nonEmptyParagraphs: outline.paragraphs.filter(p => p.text.trim()).length,
      tables: outline.tables.length,
      images: outline.images.length,
      redRuns,
      redParagraphs: outline.paragraphs.filter(p => p.runs.some(r => r.red && r.text.trim())).length,
      textBoxParagraphs: outline.paragraphs.filter(p => p.textBox).length,
      fields: outline.fields.length,
    },
    mergeFields: {
      set: sets.map(f => ({ name: f.name, value: f.value, paragraph: f.paragraph })),
      ref: refs.map(f => ({ name: f.name, shows: f.result, paragraph: f.paragraph })),
    },
    toc: tocs.map(f => ({ instr: f.instr, depth: f.depth, insideKind: f.insideKind || '', paragraph: f.paragraph })),
    warnings,
  };
}

// ---- Compact form sent to the mapper (kept small: text is cut, empty paragraphs dropped) -------------------------------
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

function redSpans(p) {
  const spans = [];
  p.runs.forEach(r => {
    if (!(r.red && r.text.trim())) return;
    const last = spans[spans.length - 1];
    if (last && last.to === r.index - 1) { last.to = r.index; last.text += r.text; } else spans.push({ from: r.index, to: r.index, text: r.text });
  });
  return spans.map(s => ({ runs: [s.from, s.to], text: cut(s.text, 120) }));
}

// Every distinct red text (and Word field value) with all the places it appears, so the same sample value is mapped everywhere
function redValues(outline) {
  const byText = new Map();
  const add = (text, place) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) return;
    if (!byText.has(t)) byText.set(t, []);
    byText.get(t).push(place);
  };
  outline.paragraphs.forEach(p => redSpans(p).forEach(sp => add(sp.text, { paragraph: p.ref, runs: sp.runs })));
  outline.fields.filter(f => f.kind === 'REF' && f.runs).forEach(f => add(f.result, { paragraph: f.paragraph, runs: f.runs, field: f.name }));
  return [...byText.entries()].filter(([, places]) => places.length > 1).map(([text, places]) => ({ text: cut(text, 100), places: places.slice(0, 12) }));
}

function compactOutline(outline) {
  return {
    paragraphs: outline.paragraphs.filter(p => p.text.trim()).map(p => {
      const red = redSpans(p);
      return {
        ref: p.ref,
        text: cut(p.text.trim(), 240),
        ...(p.heading !== undefined ? { heading: p.heading } : (p.style ? { style: p.style } : {})),
        ...(red.length ? { red } : {}),
        ...(p.cell ? { cell: `${p.cell.table}.r${p.cell.r}.c${p.cell.c}` } : {}),
        ...(p.textBox ? { textBox: true } : {}),
      };
    }),
    tables: outline.tables.map(t => ({
      ref: t.ref,
      headerRow: t.headerRow,
      rows: t.rows.map(r => ({ r: r.index, cells: r.cells.map(c => cut(c.text || '', 60)), ...(r.cells.some(c => c.red) ? { redCells: r.cells.map((c, i) => (c.red ? i : -1)).filter(i => i >= 0) } : {}) })),
    })),
    images: outline.images.map(i => ({ ref: i.ref, paragraph: i.paragraph, anchored: i.anchored, name: i.name, widthEmu: i.widthEmu, heightEmu: i.heightEmu })),
    // SET holds a stored sample value (never a location); a REF field shows one and can be replaced as a whole (runs = its first and last run)
    fields: outline.fields.filter(f => f.kind === 'SET' || f.kind === 'REF').map(f => ({ kind: f.kind, name: f.name, ...(f.kind === 'SET' ? { value: f.value } : { shows: f.result, ...(f.runs ? { runs: f.runs } : {}) }), paragraph: f.paragraph })),
    redValues: redValues(outline),
  };
}

module.exports = { buildOutline, compactOutline, isRedHex, redSpans };
