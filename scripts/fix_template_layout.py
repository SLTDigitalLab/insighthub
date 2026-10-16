"""Layout fixes for backend/templates/proposal_template.docx (run once, after make_template.py).

usage: python scripts/fix_template_layout.py <in.docx> <out.docx>

- Letter: {solutionIntro1}/{solutionIntro2} become one {@letterXml} block (built in proposalBuilder.js,
  one Verdana 10.5pt paragraph per paragraph of text); "on {amPhone}" becomes {amPhoneClause};
  "Thank you" / "Yours sincerely" are two normal-width paragraphs.
- Address: recipient/company/address lines use the full width; the 3 address paragraphs become {@addressXml}.
- Proposed Solution table: inline (not floating), wider Service column, 10pt; space above NETWORK ARCHITECTURE.
- Contents page numbers become {toc0}..{toc15} (filled from the rendered PDF).
- T&C item 4: business name in bold. Acknowledgements: ref number at the same size as the sentence.
- Every font becomes Verdana (Times New Roman, Cambria, Calibri, Century Gothic, Gothic Uralic, Trebuchet MS).
- Page-sized pictures are left as they are: the hexagon backgrounds (Image 191, Group 247, header Image 22 / Picture 37)
  are already behindDoc="1". The only one in front of text is the back-cover artwork (Group 256), and it must stay in front:
  it is what hides the header's hexagon background, the footer and the placeholder text on the back cover.
"""
import re, sys, zipfile

SRC, DST = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(SRC)
files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
doc = files['word/document.xml'].decode('utf8')

PARA_RE = re.compile(r'<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?</w:p>', re.S)
# Innermost paragraphs only (paragraphs inside text boxes are matched on their own)


def para_with(needle, start=0):
    for m in PARA_RE.finditer(doc, start):
        if needle in m.group(0):
            return m
    raise SystemExit(f'not found: {needle}')


def replace_once(old, new):
    global doc
    assert doc.count(old) == 1, (doc.count(old), old)
    doc = doc.replace(old, new)


def replace_span(m, new):
    global doc
    doc = doc[:m.start()] + new + doc[m.end():]


def raw_para(tag):
    return f'<w:p><w:r><w:t>{{@{tag}}}</w:t></w:r></w:p>'
    # A paragraph holding only a {@raw} tag is replaced as a whole by docxtemplater


# ── Letter body paragraphs ──
m1 = para_with('{solutionIntro1}')
m2 = para_with('{solutionIntro2}', m1.end())
assert doc[m1.end():m2.start()].strip() == '', 'intro paragraphs are not adjacent'
doc = doc[:m1.start()] + raw_para('letterXml') + doc[m2.end():]

# ── "reach out to {amName} on {amPhone} should you..." ──
m = para_with('{amPhone} ')
p = m.group(0)
assert p.count('<w:t xml:space="preserve">on </w:t>') == 1
p = p.replace('<w:t xml:space="preserve">on </w:t>', '<w:t xml:space="preserve"></w:t>')
p = p.replace('{amPhone} ', '{amPhoneClause}')
replace_span(m, p)

# ── Thank you / Yours sincerely ──
m = para_with('<w:t>sincerely</w:t>')
replace_span(m,
    '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="164"/><w:ind w:left="720"/></w:pPr><w:r><w:t>Thank you</w:t></w:r></w:p>'
    '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="240"/><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">Yours sincerely</w:t></w:r></w:p>')
dots = para_with('<w:spacing w:line="254" w:lineRule="exact"/>', doc.index('Yours sincerely'))
end = doc.index('<w:sectPr', dots.end())
end = doc.rfind('<w:p ', 0, end)
assert not any(re.search(r'<w:t[ >]', m.group(0)) for m in PARA_RE.finditer(doc[dots.end():end]))
doc = doc[:dots.end()] + doc[end:]
# Drops the empty spacer paragraphs under the signature line so a full letter doesn't spill onto a blank page

# ── Address block ──
m = para_with('{recipientDesignation}')
replace_span(m, m.group(0).replace(' w:right="7834"', ''))
m = para_with('{companyName}', m.start())
assert 'w:right="7834"' in m.group(0)
replace_span(m, m.group(0).replace(' w:right="7834"', '').replace('<w:spacing w:before="240"/>', '<w:spacing w:before="0"/>'))
a1 = para_with('{addressLine1}')
a3 = para_with('{city}', a1.end())
assert '{addressLine2}' in doc[a1.end():a3.start()]
doc = doc[:a1.start()] + raw_para('addressXml') + doc[a3.end():]

# ── Proposed Solution table ──
t0 = doc.rfind('<w:tbl>', 0, doc.index('{#components}'))
t1 = doc.index('</w:tbl>', t0) + len('</w:tbl>')
t = doc[t0:t1]
t = re.sub(r'<w:tblpPr [^>]*/>', '', t)
t = t.replace('<w:tblW w:w="7859" w:type="dxa"/>', '<w:tblW w:w="10000" w:type="dxa"/><w:jc w:val="center"/>')
for old, new in (('1530', '2900'), ('1620', '1850'), ('2065', '1850'), ('2644', '3400')):
    t = t.replace(f'<w:gridCol w:w="{old}"/>', f'<w:gridCol w:w="{new}"/>').replace(f'<w:tcW w:w="{old}" w:type="dxa"/>', f'<w:tcW w:w="{new}" w:type="dxa"/>')
t = t.replace('<w:sz w:val="24"/>', '<w:sz w:val="20"/>').replace('<w:szCs w:val="24"/>', '<w:szCs w:val="20"/>')
doc = doc[:t0] + t + doc[t1:]

m = para_with('w:name="_bookmark5"')
# The heading itself (the Contents entry links to it with w:anchor="_bookmark5")
assert 'ARCHITECTURE' in m.group(0) and '<w:pStyle w:val="Heading2"/>' in m.group(0)
replace_span(m, m.group(0).replace('<w:pStyle w:val="Heading2"/>', '<w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="240"/>', 1))
# proposalBuilder.js looks for exactly these heading properties when it adds a page break before the heading
m = PARA_RE.search(doc, doc.index('ARCHITECTURE</w:t>', doc.index('_bookmark5"/>')))
assert '<w:t' not in m.group(0).replace('<w:tab', '')
replace_span(m, m.group(0).replace('<w:pStyle w:val="BodyText"/>', '<w:pStyle w:val="BodyText"/><w:keepNext/>', 1))
# Heading + the empty line under it stay on the same page as the network map

# ── Contents page numbers ──
toc = [m for m in PARA_RE.finditer(doc) if re.search(r'<w:pStyle w:val="TOC[12]"/>', m.group(0))]
assert len(toc) == 16, len(toc)
for i, m in reversed(list(enumerate(toc))):
    p = re.sub(r'<w:t>\d+</w:t>(</w:r></w:hyperlink>)', f'<w:t>{{toc{i}}}</w:t>\\1', m.group(0))
    p = p.replace('<w:t>s�</w:t>', '<w:t>s</w:t>')
    # Drops the stray broken character after "Acknowledgements"
    assert f'{{toc{i}}}' in p, m.group(0)
    replace_span(m, p)

# ── T&C item 4: business name in bold ──
m = re.search(r'<w:r(?: [^>]*)?>(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)<w:t xml:space="preserve">(Information contained in this proposal should not be disclosed outside )\{companyName\}( and shall[^<]*)</w:t></w:r>', doc)
rpr = m.group(1)
bold = rpr.replace('<w:color', '<w:b/><w:bCs/><w:color', 1)
replace_span(m, f'<w:r>{rpr}<w:t xml:space="preserve">{m.group(2)}</w:t></w:r><w:r>{bold}<w:t>{{companyName}}</w:t></w:r><w:r>{rpr}<w:t xml:space="preserve">{m.group(3)}</w:t></w:r>')

# ── Acknowledgements: ref number same size as the sentence ──
replace_once('<w:rPr><w:color w:val="000000"/><w:spacing w:val="6"/><w:w w:val="75"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve"> {refNo}</w:t>',
             '<w:rPr><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve"> {refNo}</w:t>')

files['word/document.xml'] = doc.encode('utf8')

# ── Verdana everywhere ──
VERDANA = '<w:rFonts w:ascii="Verdana" w:eastAsia="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>'
for name in list(files):
    if re.fullmatch(r'word/(document|styles|header\d*|footer\d*)\.xml', name):
        x = files[name].decode('utf8')
        x = re.sub(r'<w:rFonts [^>]*/>', lambda r: r.group(0) if re.search(r'Symbol|Wingdings', r.group(0)) else VERDANA, x)
        files[name] = x.encode('utf8')

zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    zout.writestr(item, files[item.filename])
zout.close()
tags = re.findall(r'\{[^{}<]*\}', ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', doc)))
print(sorted(set(tags)))
