const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const PizZip = require('pizzip');

function findLibreOfficeCli() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

/**
 * Extracts clean, human-readable text from a .docx file including tables and paragraphs.
 */
function extractDocxText(filePath) {
  try {
    const fileBuf = fs.readFileSync(filePath);
    const zip = new PizZip(fileBuf);
    const docXml = zip.file('word/document.xml');
    if (!docXml) return '';

    const xml = docXml.asText();

    // Preserve table layout and line breaks
    const processed = xml
      .replace(/<w:tr\b[^>]*>/gi, '\n')
      .replace(/<w:tc\b[^>]*>/gi, ' | ')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<w:tab\/>/gi, '\t');

    // Extract text runs
    const tokens = processed.match(/<w:t\b[^>]*>([^<]*)<\/w:t>|\n|\t| \| /g) || [];
    let text = '';
    for (const token of tokens) {
      if (token === '\n' || token === '\t' || token === ' | ') {
        text += token;
      } else {
        text += token.replace(/<[^>]+>/g, '');
      }
    }

    return text
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n\n');
  } catch (err) {
    console.error(`[documentProcessor] Error extracting .docx text from ${filePath}:`, err.message);
    return '';
  }
}

/**
 * Converts legacy .doc to .docx via LibreOffice then extracts text.
 */
function extractDocText(filePath) {
  const soffice = findLibreOfficeCli();
  if (!soffice) {
    console.warn('[documentProcessor] LibreOffice not found. Legacy .doc text extraction requires LibreOffice.');
    return '';
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-doc-extract-'));
  try {
    execFileSync(soffice, ['--headless', '--convert-to', 'docx', '--outdir', tempDir, filePath], { timeout: 60000 });
    const convertedName = path.basename(filePath, path.extname(filePath)) + '.docx';
    const convertedPath = path.join(tempDir, convertedName);
    if (fs.existsSync(convertedPath)) {
      return extractDocxText(convertedPath);
    }
  } catch (err) {
    console.error(`[documentProcessor] Error converting .doc to .docx for ${filePath}:`, err.message);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return '';
}

/**
 * Extracts plain text from an uploaded file based on its mimeType or file extension.
 */
async function extractText(filePath, mimeType = '') {
  const ext = path.extname(filePath).toLowerCase();

  try {
    // 1. Modern Word Documents (.docx)
    if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
      const docxText = extractDocxText(filePath);
      if (docxText && docxText.trim().length > 0) {
        return docxText;
      }
    }

    // 2. Legacy Word Documents (.doc)
    if (ext === '.doc' || mimeType === 'application/msword') {
      const docText = extractDocText(filePath);
      if (docText && docText.trim().length > 0) {
        return docText;
      }
    }

    // 3. PDF Documents (.pdf)
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer, { max: 0 });
      return pdfData.text || '';
    }

    // 4. Excel & CSV Spreadsheets (.xlsx, .xls, .csv, .tsv)
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

    // 5. Plain text, markdown, json, etc.
    const raw = fs.readFileSync(filePath, 'utf8');
    // Sanitize any NUL bytes to avoid breaking JSON / database storage
    return raw.replace(/\0/g, '');
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

  // Strip NUL bytes and normalize line endings
  const cleanedText = text.replace(/\0/g, '').replace(/\r\n/g, '\n');
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
