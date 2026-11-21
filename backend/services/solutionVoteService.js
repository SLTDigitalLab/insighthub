const { sanitize, GROUP_FLAG } = require('./solutionSchemaService');

// Combining several runs of the agent on the same payload. The model is not fully repeatable, so the answers of N parallel runs
// are merged tag by tag. Generic: only the template's own schema and the sheet's cells are used, no tag names, no labels.
//
//   text / raw XML tag, runs agree        : that value
//   text / raw XML tag, runs disagree     : a value that appears in the sheet (a cell's value or displayed text) beats one that does
//                                           not; among equals the value at least 2 runs agree on; then the first non-empty value
//   loop WITH a nested loop (terms style) : when runs disagree, the UNION of the rows of all runs, matched by the text of the first
//                                           field; a matched row takes the version with the most nested lines; rows are ordered by
//                                           where their label first appears in the sheet (run order when it is not found)
//   other loops (priced tables)           : when runs disagree, the run with the most rows (a dropped row is the usual error)
//   a loop whose chosen rows are backed by fewer than 2 runs is reported, so the edit screen can ask for a check
//
// Values are compared after trimming, ignoring case, repeated spaces and thousands separators (1,000.50 = 1000.50).
// A run that failed is not passed in: with one answer left, that answer is used as it is.

const clean = v => (v == null ? '' : String(v));
const norm = s => clean(s).replace(/(\d),(?=\d{3}(\D|$))/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
const asText = v => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));

// a comparable signature of a (sanitised) value
function sig(v) {
  if (!Array.isArray(v)) return norm(v);
  return JSON.stringify(v.map(row => Object.keys(row).sort().map(k => [k, k === GROUP_FLAG ? row[k] === true : sig(row[k])])));
}

const rowCount = v => (Array.isArray(v) ? v.length : 0);

// answers: raw agent answers ({ values, missing, userSource, meta }); schema: buildSchema(...); grid: the sheet's cells
// Returns { raw, log, disagreements } where raw has the same shape as one answer and log lists who won every tag.
function vote(answers, schema, grid = { cells: [] }) {
  const n = answers.length;
  const clear = answers.map(a => sanitize(schema, a.values, true)); // what each run means, for comparing
  const values = {};
  const log = [];
  const disagreements = [];

  // ---- the sheet's texts ----
  const cells = (grid.cells || []).map(c => ({ v: norm(c.value), t: norm(c.text) }));
  const sheetTexts = new Set();
  cells.forEach(c => { if (c.v) sheetTexts.add(c.v); if (c.t) sheetTexts.add(c.t); });
  const inSheet = value => {
    const t = norm(value);
    if (!t) return false;
    if (sheetTexts.has(t)) return true;
    return t.length >= 6 && cells.some(c => c.v.includes(t) || c.t.includes(t)); // a longer cell that contains it
  };
  const position = key => { // where a label first appears in the sheet (reading order); Infinity when it is not there
    let i = cells.findIndex(c => c.v === key || c.t === key);
    if (i === -1 && key.length >= 4) i = cells.findIndex(c => c.v.includes(key) || c.t.includes(key));
    return i === -1 ? Infinity : i;
  };

  const groupsOf = (sigs, pool) => {
    const g = {};
    pool.forEach(i => { (g[sigs[i]] = g[sigs[i]] || []).push(i); });
    return g;
  };
  const biggest = groups => Object.values(groups).filter(g => g.length >= 2).sort((a, b) => b.length - a.length || a[0] - b[0])[0];

  schema.forEach(tag => {
    const sigs = clear.map(v => sig(v[tag.name]));
    const allEqual = sigs.every(s => s === sigs[0]);
    const backers = i => sigs.filter(s => s === sigs[i]).length;
    let win = 0;
    let how = 'single run';
    let unanimous = true;
    let union = null;

    if (n > 1 && !allEqual) {
      unanimous = false;
      const nested = tag.type === 'loop' && (tag.children || []).some(c => c.type === 'loop');
      if (tag.type !== 'loop') {
        const idx = sigs.map((s, i) => i);
        const inS = idx.filter(i => inSheet(clear[i][tag.name]));
        const agreed = biggest(groupsOf(sigs, inS.length ? inS : idx));
        if (agreed) { win = agreed[0]; how = inS.length ? 'in the sheet, majority' : `${agreed.length}/${n} agree`; }
        else if (inS.length) { win = inS[0]; how = 'in the sheet'; }
        else { const ne = sigs.findIndex(s => s !== ''); win = ne === -1 ? 0 : ne; how = 'all differ, first non-empty'; }
      } else if (nested) {
        // union of the rows of all runs
        const first = (tag.children || []).find(c => c.type !== 'loop');
        const lists = (tag.children || []).filter(c => c.type === 'loop').map(c => c.name);
        const lines = row => lists.reduce((sum, l) => sum + rowCount(row[l]), 0);
        const byKey = new Map();
        let order = 0;
        clear.forEach((v, run) => (Array.isArray(v[tag.name]) ? v[tag.name] : []).forEach((row, j) => {
          const key = norm(row[first && first.name]) || `\u0000${run}:${j}`;
          const cur = byKey.get(key);
          if (!cur) byKey.set(key, { row, run, order: order++, key });
          else if (lines(row) > lines(cur.row)) byKey.set(key, { ...cur, row, run }); // the version with the most nested lines
        }));
        union = [...byKey.values()].map(x => ({ ...x, pos: position(x.key) })).sort((a, b) => a.pos - b.pos || a.order - b.order);
        win = union.length ? Math.min(...union.map(x => x.run)) : 0;
        how = 'union of the runs';
      } else {
        // most rows; on a tie the version more runs agree on, then the earliest run
        let best = 0;
        clear.forEach((v, i) => {
          const c = rowCount(v[tag.name]); const b = rowCount(clear[best][tag.name]);
          if (c > b || (c === b && backers(i) > backers(best))) best = i;
        });
        win = best;
        how = 'most rows';
      }
    }

    if (union) {
      values[tag.name] = union.map(x => x.row);
      const chosen = sig(values[tag.name]);
      if (!sigs.some((s, i) => s === chosen && backers(i) >= 2)) disagreements.push(tag.name);
    } else {
      if (tag.name in answers[win].values) values[tag.name] = answers[win].values[tag.name]; // the raw value, so unknown keys can still be reported
      if (tag.type === 'loop' && n > 1 && !allEqual && backers(win) < 2) disagreements.push(tag.name);
    }
    log.push({ tag: tag.name, winner: union ? 'union' : win + 1, how, unanimous });
  });

  // the customer name: same rule as a text tag
  const names = answers.map(a => asText(a.meta && a.meta.customerName));
  const nameSigs = names.map(norm);
  let nameWin = 0;
  if (n > 1 && !nameSigs.every(s => s === nameSigs[0])) {
    const idx = nameSigs.map((s, i) => i);
    const inS = idx.filter(i => inSheet(names[i]));
    const agreed = biggest(groupsOf(nameSigs, inS.length ? inS : idx));
    nameWin = agreed ? agreed[0] : (inS.length ? inS[0] : Math.max(0, nameSigs.findIndex(s => s !== '')));
  }

  // account-manager tags named by any run (the template's stored list is applied afterwards); tags listed as missing by 2+ runs
  const seen = new Set();
  const userSource = answers.flatMap(a => (Array.isArray(a.userSource) ? a.userSource : [])).filter(u => u && u.tag && !seen.has(u.tag) && seen.add(u.tag));
  const threshold = n === 1 ? 1 : 2;
  const missCount = {};
  answers.forEach(a => (Array.isArray(a.missing) ? a.missing : []).forEach(m => { missCount[m] = (missCount[m] || 0) + 1; }));
  const missing = Object.keys(missCount).filter(m => missCount[m] >= threshold);

  return { raw: { values, missing, userSource, meta: { customerName: names[nameWin] } }, log, disagreements };
}

module.exports = { vote, norm };
