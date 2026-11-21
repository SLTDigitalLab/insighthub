const axios = require('axios');
const net = require('net');

// Client logo, driven entirely by the template. A logo placeholder is a picture in the template whose Alt Text
// (descr / title) is {%client_logo} (or {{client_logo}}), or a {%client_logo} text tag in a paragraph. Nothing in this file knows a page, a section, a pixel size or an alignment:
// the placeholder keeps its own frame (extent, inline / anchored position, paragraph alignment); only its image
// binary is replaced, scaled to fit inside that frame (aspect ratio kept) and centred in it.
// The `leadLogo` field is a data: URL (uploaded in the editor) or an http(s) image URL. Only PNG and JPEG are embedded;
// anything else (SVG, errors, oversized files) counts as "no logo", and the placeholder picture is removed.

const { logo } = require('../proposal/renderSettings');

const MAX_BYTES = logo.maxBytes;
const TEXT_TAG = logo.textTag;
const PLACEHOLDER_ALTS = logo.placeholderAlts.map(a => a.toLowerCase());
const { nextDocPrId, esc } = require('./ooxml');

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (net.isIPv6(h)) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { ext: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Any other format Word cannot embed (SVG, WebP, GIF, ...) is converted to PNG with sharp, keeping transparency.
async function toPng(buf, mime) {
  const sharp = require('sharp');
  const isSvg = /svg/i.test(mime) || /^\s*(?:<\?xml[\s\S]*?)?<svg[\s>]/i.test(buf.slice(0, 1024).toString('utf8'));
  return sharp(buf, isSvg ? { density: 300 } : {}).png().toBuffer();
}

// Returns { img, source, mime, reason }: img = { buf, ext, w, h, converted? } or null (then reason says why).
async function readImage(value) {
  const v = String(value || '').trim();
  const out = { img: null, source: '', mime: '', reason: '' };
  if (!v) return { ...out, reason: 'no logo value' };
  let buf;
  if (v.startsWith('data:image/')) {
    const comma = v.indexOf(',');
    out.mime = v.slice(5, comma < 0 ? undefined : comma).split(';')[0];
    out.source = `data URL (${v.length} chars)`;
    if (comma < 0 || !/;base64$/i.test(v.slice(0, comma))) return { ...out, reason: 'data URL is not base64' };
    buf = Buffer.from(v.slice(comma + 1), 'base64');
  } else if (/^https?:\/\//i.test(v)) {
    out.source = v.length > 140 ? v.slice(0, 140) + '...' : v;
    let host;
    try { host = new URL(v).hostname; } catch { return { ...out, reason: 'invalid URL' }; }
    if (isPrivateHost(host)) return { ...out, reason: 'private / local host not allowed' };
    try {
      const res = await axios.get(v, { responseType: 'arraybuffer', timeout: 8000, maxContentLength: MAX_BYTES, maxRedirects: 2 });
      buf = Buffer.from(res.data);
      out.mime = String(res.headers['content-type'] || '').split(';')[0];
    } catch (e) { return { ...out, reason: `download failed: ${e.message}` }; }
  } else {
    return { ...out, source: v.slice(0, 60), reason: 'not a data: or http(s) URL' };
  }
  if (!buf.length) return { ...out, reason: 'empty image' };
  if (buf.length > MAX_BYTES) return { ...out, reason: `image is ${buf.length} bytes, over the ${MAX_BYTES} limit` };
  let info = imageInfo(buf);
  let converted = false;
  if (!info) {
    try {
      buf = await toPng(buf, out.mime);
      info = imageInfo(buf);
      converted = !!info;
    } catch (e) { return { ...out, reason: `format ${out.mime || 'unknown'} cannot be embedded and could not be converted: ${e.message}` }; }
  }
  if (!info || !(info.w > 0 && info.h > 0)) return { ...out, reason: 'unreadable image size' };
  return { ...out, img: { buf, ...info, ...(converted ? { converted: true } : {}) } };
}

async function loadImage(value) {
  return (await readImage(value)).img;
}

// ---- Placeholders in the template --------------------------------------------------------------------------------------

const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const isPlaceholderAlt = v => PLACEHOLDER_ALTS.includes(unesc(v).replace(/\s+/g, '').toLowerCase());
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const isPlaceholderTag = tag => ['descr', 'title'].some(n => { const v = attr(tag, n); return v != null && isPlaceholderAlt(v); });

const ALT_TAG = /<(?:wp:docPr|pic:cNvPr)\b[^>]*>/g;

// First placeholder picture in `xml` at or after `from`: { start, end } = its <w:drawing> element, plus its frame.
function nextPlaceholder(xml, from = 0) {
  ALT_TAG.lastIndex = from;
  let m;
  while ((m = ALT_TAG.exec(xml))) {
    if (!isPlaceholderTag(m[0])) continue;
    const start = Math.max(xml.lastIndexOf('<w:drawing>', m.index), xml.lastIndexOf('<w:drawing ', m.index));
    const close = xml.indexOf('</w:drawing>', m.index);
    if (start < 0 || close < 0) continue;
    const end = close + '</w:drawing>'.length;
    const drawing = xml.slice(start, end);
    const embed = /<a:blip\b[^>]*\sr:embed="([^"]+)"/.exec(drawing); // a picture, not a text box that carries the alt text
    const ext = /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/.exec(drawing);
    if (!embed || !ext) { ALT_TAG.lastIndex = end; continue; }
    return { start, end, drawing, rId: embed[1], cx: Number(ext[1]), cy: Number(ext[2]), anchored: /<wp:anchor\b/.test(drawing) };
  }
  return null;
}

const partsOf = zip => Object.keys(zip.files).filter(n => /^word\/[^/]+\.xml$/.test(n));

// ---- {%client_logo} text tags (Word may split the tag over several runs) ---------------------------------------------------

const PARA = /<w:p[ >][\s\S]*?<\/w:p>/g;
const SEG = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g;

// The text segments (<w:t>) of one paragraph with their position in the paragraph's text.
function segmentsOf(para) {
  const segs = [];
  let off = 0;
  let m;
  const re = new RegExp(SEG.source, 'g');
  while ((m = re.exec(para))) {
    const text = unesc(m[1]);
    segs.push({ at: m.index, len: m[0].length, text, off });
    off += text.length;
  }
  return { segs, text: segs.map(s => s.text).join('') };
}

const tOf = text => `<w:t xml:space="preserve">${esc(text)}</w:t>`;
const withText = (run, seg, runAt, text) => run.slice(0, seg.at - runAt) + tOf(text) + run.slice(seg.at - runAt + seg.len);

// Replaces the first {%client_logo} of a paragraph by `drawingRun`; null when it has none.
function replaceTextTag(para, drawingRun) {
  const { segs, text } = segmentsOf(para);
  const s = text.indexOf(TEXT_TAG);
  if (s < 0) return null;
  const e = s + TEXT_TAG.length;
  const find = pos => segs.findIndex(g => pos >= g.off && pos < g.off + g.text.length);
  const i = find(s);
  const j = find(e - 1);
  const runOf = seg => {
    const at = Math.max(para.lastIndexOf('<w:r>', seg.at), para.lastIndexOf('<w:r ', seg.at));
    return { at, end: para.indexOf('</w:r>', seg.at + seg.len) + '</w:r>'.length };
  };
  const ri = runOf(segs[i]);
  const edits = [];
  const run = para.slice(ri.at, ri.end);
  if (i === j) {
    edits.push({ at: ri.at, end: ri.end, text: withText(run, segs[i], ri.at, segs[i].text.slice(0, s - segs[i].off)) + drawingRun + withText(run, segs[i], ri.at, segs[i].text.slice(e - segs[i].off)) });
  } else {
    edits.push({ at: segs[j].at, end: segs[j].at + segs[j].len, text: tOf(segs[j].text.slice(e - segs[j].off)) });
    for (let k = i + 1; k < j; k += 1) edits.push({ at: segs[k].at, end: segs[k].at + segs[k].len, text: tOf('') });
    edits.push({ at: ri.at, end: ri.end, text: withText(run, segs[i], ri.at, segs[i].text.slice(0, s - segs[i].off)) + drawingRun });
  }
  edits.sort((a, b) => b.at - a.at).forEach(x => { para = para.slice(0, x.at) + x.text + para.slice(x.end); });
  return para;
}

const countIn = (text, needle) => { let c = 0; for (let k = text.indexOf(needle); k >= 0; k = text.indexOf(needle, k + 1)) c += 1; return c; };
const countTextTags = xml => (xml.match(PARA) || []).reduce((n, p) => n + countIn(segmentsOf(p).text, TEXT_TAG), 0);

// Text area (EMU) the tag's paragraph can use: its table cell, else its page between the margins.
function areaOf(zip, xml, pos) {
  const num = (s, re) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
  const tcAt = Math.max(xml.lastIndexOf('<w:tc>', pos), xml.lastIndexOf('<w:tc ', pos));
  if (tcAt >= 0 && xml.lastIndexOf('</w:tc>', pos) < tcAt) {
    const tcW = /<w:tcW\b[^>]*>/.exec(xml.slice(tcAt, xml.indexOf('</w:tc>', tcAt)));
    const w = tcW && /w:type="dxa"/.test(tcW[0]) ? num(tcW[0], /w:w="(\d+)"/) : null;
    if (w) return { w: w * 635, h: Infinity };
  }
  let sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(xml.slice(pos));
  if (!sect && zip.file('word/document.xml')) {
    const all = zip.file('word/document.xml').asText().match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g);
    sect = all && [all[all.length - 1]];
  }
  if (!sect) return { w: Infinity, h: Infinity };
  const s = sect[0];
  const pw = num(s, /<w:pgSz\b[^>]*w:w="(\d+)"/);
  const ph = num(s, /<w:pgSz\b[^>]*w:h="(\d+)"/);
  const m = k => num(s, new RegExp(`<w:pgMar\\b[^>]*w:${k}="(\\d+)"`)) || 0;
  return { w: pw ? (pw - m('left') - m('right')) * 635 : Infinity, h: ph ? (ph - m('top') - m('bottom')) * 635 : Infinity };
}

function inlineDrawing(id, cx, cy, rId, alt) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Client logo" descr="${esc(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Client logo"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// Turns every {%client_logo} text tag into the logo picture at its final size (shares of the text width of its container, fitted,
// times the factor; no crop). Without a usable logo it becomes a placeholder picture that applyClientLogo removes. Runs before docxtemplater reads the document. Returns what applyClientLogo needs.
async function prepareClientLogo(zip, value, sizeName, templateLabel = '') {
  const read = await readImage(value);
  const ctx = { img: read.img, factor: scaleOf(sizeName), state: {} };
  console.log(`[logo] ${templateLabel || 'template'}: source=${read.source || '(none)'} mime=${read.mime || '(unknown)'} ${read.img ? `size=${read.img.w}x${read.img.h}px embedded as ${read.img.ext}${read.img.converted ? ' (converted to PNG)' : ''}` : 'size=n/a'} usable=${!!read.img}${read.img ? '' : ` (${read.reason})`} size-factor=${ctx.factor}`);
  const tagCount = partsOf(zip).reduce((n, part) => n + countTextTags(zip.file(part).asText()), 0);
  const picCount = detectPlaceholders(zip).length - tagCount;
  console.log(`[logo] ${templateLabel || 'template'}: ${TEXT_TAG} found ${tagCount} time(s) as text, ${picCount} as picture placeholder(s)${tagCount + picCount ? '' : ' - the template has no logo placeholder, so no logo is placed'}`);
  const EMU_PER_PX = 9525; // 96 dpi: how Word sizes an image's pixels, not a design size
  for (const part of partsOf(zip)) {
    let xml = zip.file(part).asText();
    if (!xml.includes('client_logo') && !xml.includes('%')) continue;
    let changed = false;
    let from = 0;
    for (;;) {
      const re = new RegExp(PARA.source, 'g');
      re.lastIndex = from;
      let found = null;
      let m;
      while ((m = re.exec(xml))) { if (segmentsOf(m[0]).text.includes(TEXT_TAG)) { found = m; break; } }
      if (!found) break;
      const area = areaOf(zip, xml, found.index);
      const { img } = ctx;
      let cx = 1;
      let cy = 1;
      if (img) {
        // box = shares of the text width (when the width is unknown: the logo's own size); scaled up or down to fit it
        if (!Number.isFinite(area.w)) {
          const paraNo = (xml.slice(0, found.index).match(/<w:p[ >]/g) || []).length + 1;
          const snippet = segmentsOf(found[0]).text.slice(0, 60);
          console.warn(`[logo] ${TEXT_TAG} in ${part}, paragraph ${paraNo} ("${snippet}"), template ${templateLabel || 'unknown'}: container width unknown, using the logo's own size`);
        }
        const boxW = Number.isFinite(area.w) ? area.w * logo.textBoxWidthShare : img.w * EMU_PER_PX;
        const boxH = Number.isFinite(area.w) ? area.w * logo.textBoxHeightShare : img.h * EMU_PER_PX;
        const k = Math.min(boxW / (img.w * EMU_PER_PX), boxH / (img.h * EMU_PER_PX));
        // final size = fitted size x Small / Medium / Large factor; set directly as the extent, no crop (the paragraph aligns it)
        cx = Math.max(1, Math.round(img.w * EMU_PER_PX * k * ctx.factor));
        cy = Math.max(1, Math.round(img.h * EMU_PER_PX * k * ctx.factor));
      }
      const rId = img ? addImageTo(zip, part, img, ctx.state) : 'rIdIHLogo';
      const next = replaceTextTag(found[0], inlineDrawing(nextDocPrId(zip), cx, cy, rId, img ? 'Client logo' : TEXT_TAG));
      if (!next) break;
      xml = xml.slice(0, found.index) + next + xml.slice(found.index + found[0].length);
      from = found.index;
      changed = true;
    }
    if (changed) zip.file(part, xml);
  }
  return ctx;
}

// Every {%client_logo} tag and picture of a .docx package: [{ part, widthEmu, heightEmu, anchored }] (a text tag has no box
// of its own: widthEmu / heightEmu are null). Stored with a template version.
// Also: kind ('text' | 'picture') and location = the text of the nearest heading-styled paragraph above it (Heading / Title
// styles), else the nearest non-empty paragraph above it. No page numbers are computed.
function detectPlaceholders(zip) {
  const found = [];
  const styleNames = styleNamesOf(zip);
  partsOf(zip).forEach(part => {
    const xml = zip.file(part).asText();
    const here = [];
    const tagsInDoc = []; // the other {tags} of this part in document order: { at, name }
    const paras = [...xml.matchAll(new RegExp(PARA.source, 'g'))];
    paras.forEach(m => {
      const text = segmentsOf(m[0]).text;
      for (let k = text.indexOf(TEXT_TAG); k >= 0; k = text.indexOf(TEXT_TAG, k + 1)) here.push({ at: m.index + k, para: m.index, entry: { part, kind: 'text', textTag: true, widthEmu: null, heightEmu: null, anchored: false } });
      for (const t of text.matchAll(/\{([#@^]?)([A-Za-z_][\w.]*)\}/g)) tagsInDoc.push({ at: m.index + t.index, name: t[2] });
    });
    let p = nextPlaceholder(xml);
    while (p) {
      here.push({ at: p.start, para: p.start, entry: { part, kind: 'picture', widthEmu: p.cx, heightEmu: p.cy, anchored: p.anchored } });
      p = nextPlaceholder(xml, p.end);
    }
    here.sort((a, b) => a.at - b.at).forEach(h => {
      const near = nearTag(tagsInDoc, h.at);
      found.push({ ...h.entry, location: locationAbove(xml, h.para, styleNames), nearField: near ? near.name : '', nearSection: near ? near.section : '' });
    });
  });
  return found;
}

// The editor section (proposal/fieldSchema.js) a template tag fills: a composed slot (aboutXml, ...) or a field / table by name.
function sectionOfTag(name) {
  const { BY_KEY, BLOCK_SLOTS } = require('../proposal/fieldSchema');
  const slot = BLOCK_SLOTS.find(b => b.key === name);
  if (slot) return slot.section;
  return BY_KEY[name] ? BY_KEY[name].section : '';
}

// The nearest other tag after `at` that fills a known section, else the nearest one before it.
function nearTag(tagsInDoc, at) {
  const known = tagsInDoc.map(t => ({ ...t, section: sectionOfTag(t.name) })).filter(t => t.section && !/^(?:leadLogo)$/.test(t.name));
  return known.find(t => t.at > at) || [...known].reverse().find(t => t.at < at) || null;
}

// style id -> style name, from word/styles.xml
function styleNamesOf(zip) {
  const names = {};
  const f = zip.file('word/styles.xml');
  if (!f) return names;
  for (const m of f.asText().matchAll(/<w:style\b[^>]*\sw:styleId="([^"]+)"[\s\S]*?<w:name\s+w:val="([^"]*)"/g)) names[m[1]] = m[2];
  return names;
}

// Text of the nearest heading-styled (Heading / Title) paragraph before `pos` in `xml`; if there is none, of the nearest
// non-empty paragraph before it; '' when the placeholder is at the very top.
function locationAbove(xml, pos, styleNames) {
  const clean = t => t.replace(/\s+/g, ' ').trim().slice(0, 120);
  const before = [...xml.slice(0, pos).matchAll(new RegExp(PARA.source, 'g'))].map(m => m[0]).reverse();
  let nearest = '';
  for (const para of before) {
    const text = clean(segmentsOf(para).text);
    if (!text) continue;
    const id = (/<w:pStyle\s+w:val="([^"]+)"/.exec(para) || [])[1] || '';
    if (/^(heading|title)/i.test(id) || /^(heading|title)/i.test(styleNames[id] || '')) return text;
    if (!nearest) nearest = text;
  }
  return nearest;
}

// ---- Filling them ------------------------------------------------------------------------------------------------------

// Registers the logo for one part (media file, relationship, content type) and returns the relationship id.
function addImageTo(zip, part, img, state) {
  const mediaName = `ih_logo.${img.ext}`;
  if (!state.media) { zip.file(`word/media/${mediaName}`, img.buf); state.media = true; }
  if (!state.rels) state.rels = {};
  if (state.rels[part]) return state.rels[part];
  const relsPath = part.replace(/^word\//, 'word/_rels/') + '.rels';
  const rId = 'rIdIHLogo';
  const rels = zip.file(relsPath) ? zip.file(relsPath).asText() : '';
  if (rels && !rels.includes(`Id="${rId}"`)) {
    zip.file(relsPath, rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`));
  }
  const ctPath = '[Content_Types].xml';
  const ct = zip.file(ctPath) ? zip.file(ctPath).asText() : '';
  if (ct && !new RegExp(`Extension="${img.ext}"`, 'i').test(ct)) {
    zip.file(ctPath, ct.replace('<Default ', `<Default Extension="${img.ext}" ContentType="image/${img.ext}"/><Default `));
  }
  state.rels[part] = rId;
  return rId;
}

// Scale factor of the editor's Small / Medium / Large (renderSettings.logo.scale); capped at 1 = never above the template's box.
function scaleOf(sizeName) {
  const s = logo.scale[String(sizeName || '').toLowerCase()] ?? logo.scale[logo.defaultSize];
  return Math.min(1, Math.max(0, Number(s) || 1));
}

// The picture keeps the placeholder's frame (extent). The logo is fitted inside it by padding the picture with a negative
// source crop (a:srcRect), which centres it on both axes and keeps the logo's aspect ratio.
function fillPlaceholder(p, rId, img, factor) {
  const fit = Math.min(p.cx / img.w, p.cy / img.h) * factor; // EMU per logo pixel
  const fw = (img.w * fit) / p.cx;
  const fh = (img.h * fit) / p.cy;
  const pad = f => Math.round(((1 / f - 1) / 2) * 100000);
  const crop = `<a:srcRect l="${-pad(fw)}" t="${-pad(fh)}" r="${-pad(fw)}" b="${-pad(fh)}"/>`;
  let d = p.drawing
    .replace(/(<a:blip\b[^>]*\sr:embed=")[^"]+(")/, `$1${rId}$2`)
    .replace(/<a:srcRect\b[^>]*\/>/, '')
    .replace(/(<a:stretch\b)/, `${crop}$1`)
    .replace(/(<wp:docPr\b[^>]*?)\sdescr="[^"]*"/, '$1 descr="Client logo"')
    .replace(/(<wp:docPr\b[^>]*?)\stitle="[^"]*"/, '$1')
    .replace(/(<pic:cNvPr\b[^>]*?)\sdescr="[^"]*"/, '$1 descr="Client logo"')
    .replace(/(<pic:cNvPr\b[^>]*?)\stitle="[^"]*"/, '$1');
  if (!d.includes('<a:srcRect')) d = d.replace(/(<\/a:blip>|<a:blip\b[^>]*\/>)/, `$1${crop}`);
  return d;
}

function lastIndexOfRegex(xml, re, before) {
  let idx = -1;
  let m;
  while ((m = re.exec(xml)) && m.index < before) idx = m.index;
  return idx;
}

// Removes the placeholder picture: its run, and its paragraph when nothing else is left in it (a table cell, header or footer
// keeps its last paragraph, which Word requires).
function removePlaceholder(xml, p) {
  const runStart = lastIndexOfRegex(xml, /<w:r[ >]/g, p.start);
  const runClose = xml.indexOf('</w:r>', p.end);
  if (runStart < 0 || runClose < 0) return xml.slice(0, p.start) + xml.slice(p.end);
  const runEnd = runClose + '</w:r>'.length;
  const without = xml.slice(0, runStart) + xml.slice(runEnd);
  const paraStart = lastIndexOfRegex(xml, /<w:p[ >]/g, runStart);
  const paraClose = xml.indexOf('</w:p>', runEnd);
  if (paraStart < 0 || paraClose < 0) return without;
  const paraEnd = paraClose + '</w:p>'.length;
  const rest = xml.slice(paraStart, runStart) + xml.slice(runEnd, paraEnd);
  // runs the tag left behind with no text in them do not count as content: the line is removed, not kept as an empty line
  const EMPTY_RUN = /<w:r(?:\s[^>]*)?>(?:<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>)?(?:<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?><\/w:t>)*<\/w:r>/g;
  const body = rest.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '').replace(EMPTY_RUN, '');
  const hasContent = /<w:(?:r|hyperlink|fldSimple|sdt|smartTag|ins|del)[\s>]/.test(body) || /<w:sectPr/.test(rest);
  if (hasContent) return without;
  const onlyChild = /^\s*<\/w:(?:tc|hdr|ftr)>/.test(xml.slice(paraEnd)) && !xml.slice(0, paraStart).trimEnd().endsWith('</w:p>');
  if (onlyChild) return without;
  return xml.slice(0, paraStart) + xml.slice(paraEnd);
}

// Fills every logo picture of the generated document `zip` (ctx from prepareClientLogo: the client's logo and the editor's
// Small / Medium / Large factor). No usable logo -> the placeholder pictures are removed.
async function applyClientLogo(zip, ctx) {
  const parts = partsOf(zip).filter(part => nextPlaceholder(zip.file(part).asText()));
  if (!parts.length) return 0;
  const { img, factor, state } = ctx;
  let count = 0;
  for (const part of parts) {
    let xml = zip.file(part).asText();
    const rId = img ? addImageTo(zip, part, img, state) : null;
    let p = nextPlaceholder(xml);
    while (p) {
      xml = img ? xml.slice(0, p.start) + fillPlaceholder(p, rId, img, factor) + xml.slice(p.end) : removePlaceholder(xml, p);
      count += 1;
      p = nextPlaceholder(xml); // a filled picture no longer carries the placeholder alt text
    }
    zip.file(part, xml);
  }
  return count;
}

module.exports = { toPng, prepareClientLogo, applyClientLogo, detectPlaceholders, loadImage, readImage, imageInfo };
