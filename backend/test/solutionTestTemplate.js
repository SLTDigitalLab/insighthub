// Builds a small TEST solution template (.docx) for the solution-proposal tests.
// The tag names below belong to this test file only; the application code never names them.
//   node test/solutionTestTemplate.js [output.docx]      (default: test/fixtures/test_solution_template.docx)
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
// a heading written like SLT's template: keep-with-next, bold, no style
const h = text => `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = inner => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
const border = '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>';

// a table whose second row repeats: {#loop} in its first cell, {/loop} in its last cell. Every cell is written like SLT's
// template: {#_group}{field}{/_group}{^_group}{field}{/_group} (here a group row gets a "**" marker so the test can see it)
const table = (loop, cols) => `<w:tbl>${border}<w:tr>${cols.map(c => cell(p(c.toUpperCase()))).join('')}</w:tr><w:tr>${cols.map((c, i) => cell(p(
  `${i === 0 ? `{#${loop}}` : ''}{#_group}**{${c}}{/_group}{^_group}{${c}}{/_group}${i === cols.length - 1 ? `{/${loop}}` : ''}`))).join('')}</w:tr></w:tbl>`;

function build() {
  const body = [
    p('Reference: {ref_no}   Date: {proposal_date}'),
    p('Customer: {customer_name}'),
    p('Address: {customer_address}'),
    p('Attention: {contact_person}'),
    p('{@cover_letter}'),
    h('Solution BOQ'),
    table('boq_rows', ['item_description', 'qty', 'unit_price', 'line_total']),
    p('Total: {grand_total}'),
    h('Optional items'),
    table('optional_rows', ['option_description', 'option_price']),
    p('Terms and conditions'),
    p('{@terms_text}'),
    p('Account manager: {am_name}  {am_phone}  {am_email}'),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>',
  ].join('');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, 'fixtures', 'test_solution_template.docx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, build());
  console.log('written', out);
}

module.exports = { build };
