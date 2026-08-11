const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * Extracts plain text from an uploaded file based on its mimeType or file extension.
 */
async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text || '';
  }

  // Plain text, markdown, json, csv
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Splits text into overlapping chunks.
 */
function chunkText(text, chunkSize = 1000, chunkOverlap = 200) {
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
