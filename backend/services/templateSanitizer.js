const PizZip = require('pizzip');

const REF_REPLACEMENTS = [
  { match: /REF\s+CustomerName\d*/gi, tag: '{companyName}' },
  { match: /REF\s+InvoiceDate/gi, tag: '{proposalDate}' },
  { match: /REF\s+Designation/gi, tag: '{recipientDesignation}' },
  { match: /REF\s+Address/gi, tag: '{address}' },
  { match: /REF\s+RefNumber/gi, tag: '{refNo}' },
  { match: /REF\s+QuoteNumber\d*/gi, tag: '{refNo}' },
  { match: /REF\s+AccountManagerName\d*/gi, tag: '{amName}' },
  { match: /REF\s+AccountManagerNumber\d*/gi, tag: '{amPhone}' },
  { match: /REF\s+AccountManagerEmail/gi, tag: '{amEmail}' },
  { match: /REF\s+SalesManagerName/gi, tag: '{rebmName}' },
  { match: /REF\s+SalesManagerPhoneNum/gi, tag: '{rebmPhone}' },
  { match: /REF\s+SalesOffice\d*/gi, tag: '{amDivision}' },
];

/**
 * Sanitizes an uploaded Word (.docx) template buffer:
 * 1. Removes raw SLT CRM SET field codes and sample values (e.g. Enterprise_STest 1)
 * 2. Converts CRM REF merge fields to docxtemplater {tags}
 * 3. Removes floating table properties (<w:tblpPr>) which cause LibreOffice and Word to render overlapping pages
 * 4. Ensures {companyName} and other key tags are present and clean
 */
function sanitizeTemplate(buffer) {
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (err) {
    throw new Error(`Invalid Word (.docx) file: ${err.message}`);
  }

  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid Word document: missing word/document.xml');
  }

  let xml = docFile.asText();
  const warnings = [];

  // Check for raw CRM fields
  const hasRawCrm = xml.includes('SET CustomerName') || xml.includes('Enterprise_STest') || xml.includes('<w:instrText');
  const hasFloatingTables = xml.includes('<w:tblpPr');

  if (hasRawCrm || hasFloatingTables) {
    console.log('[templateSanitizer] Sanitizing raw CRM fields / floating tables in uploaded template...');

    // 1. Remove all SET fields completely:
    // <w:r...><w:instrText...> SET ... </w:instrText></w:r>
    xml = xml.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>).)*?<w:instrText\b[^>]*>\s*SET\s+[^<]*<\/w:instrText>(?:(?!<\/w:r>).)*?<\/w:r>/gis, '');

    // 2. Remove sample value runs like Enterprise_STest 1
    xml = xml.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>).)*?<w:t\b[^>]*>\s*Enterprise_STest[^\s<]*\s*<\/w:t>(?:(?!<\/w:r>).)*?<\/w:r>/gis, '');
    xml = xml.replace(/Enterprise_STest\s*\d*/gi, '');

    // 3. Remove sample address from CRM if it was hardcoded in a separate run
    xml = xml.replace(/<w:t\b[^>]*>\s*No 125, Lotus Road[^\s<]*\s*<\/w:t>/gis, '');

    // 4. Convert REF fields to docxtemplater tags
    for (const { match, tag } of REF_REPLACEMENTS) {
      // Handle <w:fldSimple w:instr=" REF ... ">
      xml = xml.replace(new RegExp(`<w:fldSimple\\s+w:instr="[^"]*${match.source}[^"]*"[^>]*>(.*?)<\\/w:fldSimple>`, 'gis'), `<w:r><w:t>${tag}</w:t></w:r>`);
      // Handle complex field runs <w:instrText> REF ... </w:instrText>
      xml = xml.replace(new RegExp(`<w:r\\b[^>]*>(?:(?!<\\/w:r>).)*?<w:instrText\\b[^>]*>\\s*${match.source}\\b[^<]*<\\/w:instrText>(?:(?!<\\/w:r>).)*?<\\/w:r>`, 'gis'), `<w:r><w:t>${tag}</w:t></w:r>`);
    }

    // 5. Remove floating table positioning so LibreOffice & Word do not stack tables on top of each other
    if (hasFloatingTables) {
      xml = xml.replace(/<w:tblpPr\b[^>]*\/>/gis, '');
    }

    zip.file('word/document.xml', xml);
  }

  // Also clean headers & footers
  for (const fileName of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d+\.xml$/i.test(fileName)) {
      let hXml = zip.file(fileName).asText();
      let changed = false;
      if (hXml.includes('QuoteNumber') || hXml.includes('REF')) {
        for (const { match, tag } of REF_REPLACEMENTS) {
          if (match.test(hXml)) {
            hXml = hXml.replace(new RegExp(`<w:fldSimple\\s+w:instr="[^"]*${match.source}[^"]*"[^>]*>(.*?)<\\/w:fldSimple>`, 'gis'), `<w:r><w:t>${tag}</w:t></w:r>`);
            hXml = hXml.replace(new RegExp(`<w:r\\b[^>]*>(?:(?!<\\/w:r>).)*?<w:instrText\\b[^>]*>\\s*${match.source}\\b[^<]*<\\/w:instrText>(?:(?!<\\/w:r>).)*?<\\/w:r>`, 'gis'), `<w:r><w:t>${tag}</w:t></w:r>`);
            changed = true;
          }
        }
      }
      if (hXml.includes('Enterprise_STest')) {
        hXml = hXml.replace(/Enterprise_STest\s*\d*/gi, '{companyName}');
        changed = true;
      }
      if (changed) {
        zip.file(fileName, hXml);
      }
    }
  }

  // Detect which tags are present
  const tagsFound = [...new Set((xml.match(/\{[a-zA-Z0-9_@#\/]+\}/g) || []))];
  const hasCompanyName = tagsFound.includes('{companyName}') || xml.includes('{companyName}');

  if (!hasCompanyName) {
    warnings.push('Template does not appear to contain the "{companyName}" placeholder. Dynamic customer names may not be replaced.');
  }

  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    hasCompanyName,
    tagsFound,
    warnings
  };
}

module.exports = { sanitizeTemplate, REF_REPLACEMENTS };
