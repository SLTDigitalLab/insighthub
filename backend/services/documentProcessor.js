const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

/**
 * Extracts plain text from an uploaded file based on its mimeType or file extension.
 */
async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    // 1. PDF Documents
    if (mimeType === 'application/pdf' || ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer, {
        // Robust page rendering
        max: 0
      });
      return pdfData.text || '';
    }

    // 2. Excel & CSV Spreadsheets (.xlsx, .xls, .csv, .tsv)
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.tsv' || mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) {
      const workbook = XLSX.readFile(filePath);
      let fullSheetText = '';

      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (rows && rows.length > 0) {
          const header = rows[0].join(' | ');
          fullSheetText += `[Sheet: ${sheetName}]\nColumns: ${header}\n\n`;
          rows.slice(1).forEach((row, idx) => {
            if (row && row.length > 0 && row.some(cell => cell !== null && cell !== undefined && String(cell).trim().length > 0)) {
              fullSheetText += `Row ${idx + 1}: ` + row.map((cell, cIdx) => `${rows[0][cIdx] || 'Col' + (cIdx + 1)}: ${cell}`).join(', ') + '\n';
            }
          });
          fullSheetText += '\n---\n';
        }
      });
      return fullSheetText;
    }

    // 3. Plain text, markdown, json
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[Document Processor Error] Failed to extract text from ${filePath}:`, err);
    return '';
  }
}

/**
 * Splits text into overlapping chunks.
 */
function chunkText(text, chunkSize = 1200, chunkOverlap = 200) {
  if (!text || text.trim().length === 0) return [];

  const cleanedText = text.replace(/\r\n/g, '\n');
  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = startIndex + chunkSize;

    // Try to cut at paragraph or sentence boundary if possible
    if (endIndex < cleanedText.length) {
      const lastNewline = cleanedText.lastIndexOf('\n', endIndex);
      if (lastNewline > startIndex + (chunkSize * 0.5)) {
        endIndex = lastNewline;
      } else {
        const lastPeriod = cleanedText.lastIndexOf('.', endIndex);
        if (lastPeriod > startIndex + (chunkSize * 0.5)) {
          endIndex = lastPeriod + 1;
        }
      }
    }

    const chunk = cleanedText.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    startIndex = endIndex - chunkOverlap;
    if (startIndex >= cleanedText.length || endIndex >= cleanedText.length) {
      break;
    }
  }

  return chunks;
}

module.exports = {
  extractText,
  chunkText
};
