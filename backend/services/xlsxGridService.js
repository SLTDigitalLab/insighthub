const XLSX = require('xlsx');
const PizZip = require('pizzip');

// Turns a quotation workbook into a GENERIC grid. Nothing here knows what a cell means: no labels, no addresses, no layout.
//   listSheets(buffer)            -> [{ name, hidden }]
//   buildGrid(buffer, sheetName)  -> { sheetName, rows, cols, cells: [{ address, row, col, value, text? }], merges: [...], notes }
// Cached values are used (never formulas). Dates become ISO-style strings. Images and styles are ignored.
// Rows / columns are 1-based. Only the area that really holds values is reported: sheets that claim a huge range such as
// A1:Q4961 are trimmed to their last non-empty cell.

const LIMITS = {
  maxBytes: 10 * 1024 * 1024,        // upload size
  maxUncompressedBytes: 120 * 1024 * 1024, // zip-bomb guard (the xlsx is a zip)
  maxSheets: 100,
  maxCells: 8000,                    // non-empty cells in the chosen sheet
};

const fail = (status, message) => Object.assign(new Error(message), { status });

// .xlsx = a zip with a workbook part. SheetJS 0.18.5 is not safe against hostile files, so the file is checked first.
function assertXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw fail(400, 'The file is empty.');
  if (buffer.length > LIMITS.maxBytes) throw fail(413, 'The Excel file is larger than 10 MB.');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw fail(400, 'This is not a valid .xlsx file (older .xls and other formats are not supported).');
  let zip;
  try { zip = new PizZip(buffer); } catch { throw fail(400, 'This is not a valid .xlsx file.'); }
  if (!zip.file('xl/workbook.xml')) throw fail(400, 'This is not an Excel (.xlsx) workbook.');
  let total = 0;
  Object.values(zip.files).forEach(f => { total += (f._data && f._data.uncompressedSize) || 0; });
  if (total > LIMITS.maxUncompressedBytes) throw fail(413, 'The Excel file expands to an unreasonable size, so it was not opened.');
}

function read(buffer, opts) {
  try {
    return XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true, cellStyles: false, cellHTML: false, bookImages: false, ...opts });
  } catch (err) {
    throw fail(400, `The Excel file could not be read: ${err.message}`);
  }
}

function listSheets(buffer) {
  assertXlsx(buffer);
  const wb = read(buffer, { bookSheets: true });
  const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const sheets = (wb.SheetNames || []).map(name => {
    const m = meta.find(s => s.name === name);
    return { name, hidden: !!(m && m.Hidden) };
  });
  if (!sheets.length) throw fail(400, 'The workbook has no sheets.');
  if (sheets.length > LIMITS.maxSheets) throw fail(413, `The workbook has more than ${LIMITS.maxSheets} sheets.`);
  return sheets;
}

const pad = n => String(n).padStart(2, '0');
// SheetJS builds a Date whose LOCAL parts are the date shown in Excel, so the local parts are read (no time zone shift)
function dateString(d) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return time === '00:00:00' ? date : `${date}T${time}`;
}

const colName = c => XLSX.utils.encode_col(c - 1);
const addr = (r, c) => `${colName(c)}${r}`;

function buildGrid(buffer, sheetName) {
  assertXlsx(buffer);
  const wb = read(buffer, { sheets: sheetName });
  const ws = wb.Sheets && wb.Sheets[sheetName];
  if (!ws) throw fail(400, `The sheet "${sheetName}" was not found in this workbook.`);

  const keys = Object.keys(ws).filter(k => k[0] !== '!');
  if (keys.length > LIMITS.maxCells * 4) throw fail(413, `The sheet "${sheetName}" is too large to read.`);

  const cells = [];
  let formulaNoCache = 0;
  let errorCells = 0;
  keys.forEach(key => {
    const c = ws[key];
    if (!c) return;
    if (c.t === 'e') { errorCells += 1; return; }
    let value = c.v;
    if (value === undefined || value === null) { if (c.f) formulaNoCache += 1; return; }
    if (value instanceof Date) value = Number.isNaN(value.getTime()) ? null : dateString(value);
    else if (typeof value === 'string') { if (!value.trim()) return; }
    else if (typeof value === 'number') { if (!Number.isFinite(value)) return; }
    if (value === null) return;
    const { r, c: col } = XLSX.utils.decode_cell(key);
    const cell = { address: key, row: r + 1, col: col + 1, value };
    // the text Excel shows (thousands separators, %, dates) when it differs from the value itself
    if (c.w != null && typeof value !== 'string' && String(c.w).trim() && String(c.w).trim() !== String(value)) cell.text = String(c.w).trim();
    cells.push(cell);
  });

  if (cells.length > LIMITS.maxCells) throw fail(413, `The sheet "${sheetName}" has more than ${LIMITS.maxCells} filled cells, which is too many to read.`);
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  const rows = cells.reduce((m, c) => Math.max(m, c.row), 0);
  const cols = cells.reduce((m, c) => Math.max(m, c.col), 0);
  const filled = new Set(cells.map(c => `${c.row}:${c.col}`));

  // merged ranges that contain at least one filled cell
  const merges = (ws['!merges'] || []).map(m => ({ startRow: m.s.r + 1, startCol: m.s.c + 1, endRow: m.e.r + 1, endCol: m.e.c + 1 }))
    .filter(m => {
      for (let r = m.startRow; r <= Math.min(m.endRow, rows); r += 1) for (let c = m.startCol; c <= Math.min(m.endCol, cols); c += 1) if (filled.has(`${r}:${c}`)) return true;
      return false;
    })
    .map(m => ({ range: `${addr(m.startRow, m.startCol)}:${addr(m.endRow, m.endCol)}`, ...m }));

  return { sheetName, rows, cols, cells, merges, notes: { formulaCellsWithoutCachedValue: formulaNoCache, errorCells } };
}

module.exports = { LIMITS, listSheets, buildGrid };
