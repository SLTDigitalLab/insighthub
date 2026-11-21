const { isRedHex } = require('./templateOutlineService');

// Placeholder colour fallback, applied at render time to the template's own XML (so templates that are already uploaded need no migration).
//
// A template author often marks the sample text of a placeholder in red, or leaves it with no colour at all, so the filled value would
// print in red / in the default text colour next to labels of another colour. Before the template is filled, every run that holds a
// placeholder takes its COLOUR from the label run next to it. The target colour is never written here: it is always copied from the
// template. Size, bold, font, character scaling, spacing and the rest of the run's formatting are never touched.
//
//   1. reference run = the nearest run of the same paragraph with visible text that is not a placeholder (blank runs are skipped)
//   2. no such run (the placeholder is alone on its line) and the placeholder is red: the last such run of the nearest paragraph above
//   3. placeholder colour red, or none:
//        reference run has an explicit colour -> that <w:color> (value, themeColor, themeTint, themeShade) is copied
//        reference run has none               -> the placeholder's own <w:color> is removed (it inherits the paragraph / style colour)
//   4. any other colour is a deliberate choice and stays
//
// The paragraph-above search (2) is used only for a RED placeholder: a placeholder without any colour is changed only by a label in its own
// paragraph, so a table cell {x} is never recoloured by an unrelated heading above it.

const PLACEHOLDER = /\{[#/@^!%]?[A-Za-z_][\w.]*\}/;          // any tag, also loop / raw / image tags
const VALUE_TAG = /\{[A-Za-z_][\w.]*\}/;                      // a plain value tag: the only kind that is recoloured
const RPR = /<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/;
const COLOR = /<w:color\b[^>]*\/>/;
// elements of CT_RPr that come after w:color: a new w:color is inserted before the first of them (schema order)
const AFTER_COLOR = /<w:(?:spacing|w|kern|position|sz|szCs|highlight|u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath)\b/;

const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = run => (run.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map(t => unescapeXml(t.replace(/<[^>]+>/g, ''))).join('');
const colorOf = run => { const rPr = RPR.exec(run); const c = rPr && COLOR.exec(rPr[0]); return c ? c[0] : ''; };
const hexOf = colorEl => { const m = /w:val="([0-9A-Fa-f]{6})"/.exec(colorEl || ''); return m ? m[1] : ''; };

const isReferenceRun = run => { const t = textOf(run); return t.trim() !== '' && !/[{}]/.test(t); };

// the run with its colour set to `colorEl` ('' = no colour); nothing else in the run changes
function withColour(run, colorEl) {
  const rPr = RPR.exec(run);
  if (!rPr) {
    if (!colorEl) return run;
    return run.replace(/^(<w:r(?:\s[^>]*)?>)/, `$1<w:rPr>${colorEl}</w:rPr>`);
  }
  let next = rPr[0];
  if (next === '<w:rPr/>' || /^<w:rPr\s*\/>$/.test(next)) next = colorEl ? `<w:rPr>${colorEl}</w:rPr>` : next;
  else if (COLOR.test(next)) next = next.replace(COLOR, () => colorEl);
  else if (colorEl) {
    const after = AFTER_COLOR.exec(next);
    next = after ? next.slice(0, after.index) + colorEl + next.slice(after.index) : next.replace(/<\/w:rPr>$/, `${colorEl}</w:rPr>`);
  }
  return run.slice(0, rPr.index) + next + run.slice(rPr.index + rPr[0].length);
}

// the colour element a placeholder run should have, or null when it is left alone
function targetColour(runColor, ref) {
  const hex = hexOf(runColor);
  const isRed = !!runColor && isRedHex(hex);
  if (runColor && !isRed) return null;                       // 4: a deliberate colour
  if (!ref) return null;
  return { colorEl: colorOf(ref.run), red: isRed };
}

// A "line" = the runs between two paragraph boundaries. Paragraphs can be nested (a text box inside a run of the header's own paragraph), so
// the xml is cut at every <w:p> / </w:p> instead of matched paragraph by paragraph; the runs of the outer paragraph that come after a
// nested one stay together. Only leaf runs (runs that hold no other run) are looked at.
const BOUNDARY = /<w:p(?:\s[^>]*)?>|<\/w:p>/g;
const LEAF_RUN = /<w:r(?:\s[^>]*)?>(?:(?!<w:r[\s>])[\s\S])*?<\/w:r>/g;
const TAG_SPAN = /\{[#/@^!%]?[A-Za-z_][\w.]*\}/g;

// the tags of a line, also those Word split over several runs: [{ first, last, plain }] (run indexes; plain = a plain {value} tag)
function tagSpans(runs) {
  const texts = runs.map(r => textOf(r.run));
  let all = '';
  const owner = []; // character -> run index
  texts.forEach((t, i) => { all += t; for (let k = 0; k < t.length; k++) owner.push(i); });
  const spans = [];
  for (const m of all.matchAll(TAG_SPAN)) {
    spans.push({ first: owner[m.index], last: owner[m.index + m[0].length - 1], plain: VALUE_TAG.test(m[0]) && !/^\{[#/@^!%]/.test(m[0]) });
  }
  return spans;
}

function recolourLine(runs, lastReferenceAbove) {
  const spans = tagSpans(runs);
  const inTag = new Set();
  spans.forEach(s => { for (let i = s.first; i <= s.last; i++) inTag.add(i); });
  const isRef = i => !inTag.has(i) && isReferenceRun(runs[i].run);
  const lastRef = (() => { for (let i = runs.length - 1; i >= 0; i--) if (isRef(i)) return runs[i].run; return lastReferenceAbove || null; })();
  const recolour = new Map(); // run index -> new run xml
  spans.filter(s => s.plain).forEach(s => {
    // 1: nearest reference run of this line (the one before wins a tie); a tag split over runs is measured from its first / last run
    let ref = null;
    for (let d = 1; d < runs.length && !ref; d++) {
      if (s.first - d >= 0 && isRef(s.first - d)) ref = { run: runs[s.first - d].run };
      else if (s.last + d < runs.length && isRef(s.last + d)) ref = { run: runs[s.last + d].run };
    }
    const colours = []; for (let i = s.first; i <= s.last; i++) colours.push(colorOf(runs[i].run));
    const first = colours[0];
    const red = !!first && isRedHex(hexOf(first));
    // 2: alone on its line: the line above, for a red placeholder only
    if (!ref && red && lastReferenceAbove) ref = { run: lastReferenceAbove };
    const target = targetColour(first, ref);
    if (!target) return;
    for (let i = s.first; i <= s.last; i++) recolour.set(i, withColour(runs[i].run, target.colorEl));
  });
  return { recolour, lastReference: lastRef };
}

// xml of one part (document / header / footer) -> the same xml with the placeholder colours fixed
function recolourPlaceholders(xml) {
  if (!PLACEHOLDER.test(xml) && !/\{/.test(xml)) return xml;
  // cut points: paragraph boundaries; leaf runs in between belong to the line that ends at the next boundary
  const cuts = [...xml.matchAll(BOUNDARY)].map(m => m.index);
  const runs = [...xml.matchAll(LEAF_RUN)].map(m => ({ run: m[0], index: m.index }));
  const lineOf = r => { let lo = 0, hi = cuts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cuts[mid] < r.index) lo = mid + 1; else hi = mid; } return lo; };
  const lines = new Map();
  runs.forEach(r => { const k = lineOf(r); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(r); });
  let above = null;
  const edits = [];
  [...lines.keys()].sort((a, b) => a - b).forEach(k => {
    const res = recolourLine(lines.get(k), above);
    above = res.lastReference;
    res.recolour.forEach((xmlRun, i) => { const r = lines.get(k)[i]; edits.push({ start: r.index, end: r.index + r.run.length, text: xmlRun }); });
  });
  if (!edits.length) return xml;
  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  edits.forEach(e => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  return out;
}

// zip = the template's PizZip, changed in place; must run BEFORE docxtemplater reads it (the placeholders are still in the text)
function applyPlaceholderColours(zip) {
  Object.keys(zip.files).filter(n => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(n)).forEach(name => {
    try {
      const xml = zip.file(name).asText();
      const next = recolourPlaceholders(xml);
      if (next !== xml) zip.file(name, next);
    } catch (e) {
      console.warn(`[placeholderColour] ${name} left as it is (${e && e.message})`); // colours are cosmetic: never stop a proposal
    }
  });
  return zip;
}

module.exports = { applyPlaceholderColours, recolourPlaceholders };
