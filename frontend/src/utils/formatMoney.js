// Money in a solution proposal table cell, for display only (the stored value is never changed). Same rule as the server's
// render step (backend/services/solutionRenderService.js): a plain number that has decimals or is 1000 or more prints as
// 1,234.50; small integers (a quantity), "-", "N/A", numbers with a leading zero and text stay as they are.
export function formatMoney(value) {
  const s = String(value == null ? '' : value).trim();
  const t = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t) || /^-?0\d/.test(t)) return String(value == null ? '' : value);
  const n = Number(t);
  if (!(t.includes('.') || Math.abs(n) >= 1000)) return String(value == null ? '' : value);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
