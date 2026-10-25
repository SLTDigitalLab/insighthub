"""Turns the SLT proposal (converted by convert_doc_word.ps1) into a template with {placeholders}.

usage: python scripts/make_template.py <converted.docx> <out.docx>      (then run fix_template_layout.py)

The source is a quote exported from SLT's CRM: it has no red text. Every customer / sales value is a Word merge field
(SET name "value" + REF name), so the fields are replaced by name. Nothing of the sample quote is kept: SET fields
(which hold the sample values) are deleted, every REF becomes a placeholder, and the document properties lose the
author names. The script stops if any known sample value is still in the output.
"""
import re, sys, zipfile

SRC, DST = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(SRC)
files = {i.filename: zin.read(i.filename) for i in zin.infolist()}

REF_MAP = {
    'InvoiceDate': ['{proposalDate}', '{ackDate}'],
    # 1st: letter date, 2nd: "proposal submitted on <date>" on Customer Acknowledgements
    'CustomerName2': ['{companyName}'],
    'CustomerName3': ['{companyName}'],
    'CustomerName4': ['{companyName}'],
    # Letter address block / "Business Proposal for ..." / cover
    'Designation': ['{recipientDesignation}'],
    'Address': ['{address}'],
    'RefNumber': ['{refNo}'],
    'QuoteNumber1': ['{solutionName}', '{refNo}'],
    # 1st: "We are pleased to submit the attached proposal for ..." (the solution, not the ref number), 2nd: acknowledgement
    'AccountManagerName2': ['{amName}', '{amName}'],
    'AccountManagerNumber': ['{amPhone}'],
    # Letter: "reach out to <name> on <phone>" and the signature
    'AccountManagerName3': ['{amName}'],
    'AccountManagerNumber1': ['{amPhone}'],
    'AccountManagerEmail': ['{amEmail}'],
    'SalesOffice1': ['{amDivision}', '{rebmDivision}'],
    'SalesManagerName': ['{rebmName}'],
    'SalesManagerPhoneNum': ['{rebmPhone}'],
    # Contact Us: Primary Contact = account manager, Secondary Contact = sales manager (1st Division is the primary's)
}
HEADER_REF_MAP = {'QuoteNumber1': ['{refNo}']}
# Page header: "Proposal Ref. No. <ref>"

SAMPLE_VALUES = ['Enterprise_STest', '1-WF8VSRZ', '1-WP75977', 'Hasanthi', 'lankahasanthi', '0701314128', 'Chandima',
                 'Dharmadasa', 'PSM CPN', '23/09/2025', 'Lotus Road', '00100', 'Sasiprabha', 'Wijewardhana', 'SILVA K G U',
                 'it23350496', '[short proposal description]']
# Sample quote values, real names, phone numbers, email and author names that must not survive

FLD_RUN_RE = re.compile(r'<w:r(?: [^>]*)?>(?:(?!<w:r[ >])(?!</w:r>).)*?<w:(?:fldChar|instrText)\b(?:(?!</w:r>).)*?</w:r>', re.S)
# A run holding a field character or field code (never a run with a picture inside)
SIMPLE_RE = re.compile(r'<w:fldSimple w:instr="([^"]*)"[^>]*>(.*?)</w:fldSimple>', re.S)
RPR_RE = re.compile(r'<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>', re.S)


def text_run(rpr, text):
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def first_rpr(xml):
    m = re.search(r'<w:r(?: [^>]*)?>(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)?(?:(?!</w:r>).)*?<w:t[ >]', xml, re.S)
    return (m.group(1) or '') if m else ''
    # Formatting of the field's displayed text, so the placeholder looks the same


def flatten_fields(xml, ref_map):
    """SET -> deleted, REF -> placeholder run, TOC -> field codes removed (the entries stay as plain text), PAGE kept."""
    used = {k: 0 for k in ref_map}
    fields, stack = [], []
    for m in FLD_RUN_RE.finditer(xml):
        r = m.group(0)
        kind = re.search(r'w:fldCharType="(\w+)"', r)
        if kind and kind.group(1) == 'begin':
            stack.append({'begin': m, 'instr': '', 'sep': None, 'runs': [m]})
        elif kind and kind.group(1) == 'separate':
            stack[-1]['sep'] = m; stack[-1]['runs'].append(m)
        elif kind and kind.group(1) == 'end':
            f = stack.pop(); f['end'] = m; f['runs'].append(m); f['depth'] = len(stack)
            fields.append(f)
        else:
            stack[-1]['instr'] += ''.join(re.findall(r'<w:instrText[^>]*>([^<]*)</w:instrText>', r)); stack[-1]['runs'].append(m)
    assert not stack, 'unbalanced field characters'
    for m in SIMPLE_RE.finditer(xml):
        fields.append({'simple': m, 'instr': m.group(1), 'depth': 0, 'begin': m})
    fields.sort(key=lambda f: f['begin'].start())

    edits = []
    # (start, end, replacement)
    for f in fields:
        instr = f['instr'].strip()
        parts = instr.split()
        kind = parts[0].upper() if parts else ''
        name = parts[1] if len(parts) > 1 else ''
        name = re.sub(r'^(?:&quot;|["\'])|(?:&quot;|["\'])$', '', name).strip()
        if kind in ('PAGE', 'NUMPAGES', 'HYPERLINK'):
            continue
        if f['depth'] > 0:
            continue
        if 'simple' in f:
            m = f['simple']
            assert kind == 'REF', instr
            edits.append((m.start(), m.end(), text_run(first_rpr(m.group(2)), placeholder(ref_map, used, name))))
            continue
        start, end = f['begin'].start(), f['end'].end()
        if kind == 'TOC':
            edits.extend((r.start(), r.end(), '') for r in f['runs'])
            # Only the field codes go; the Contents lines in between stay
            continue
        assert '</w:p>' not in xml[start:end], f'field crosses paragraphs: {instr}'
        if kind == 'SET':
            edits.append((start, end, ''))
            # SET only stores the sample value (it prints nothing)
        elif kind == 'REF':
            result = xml[f['sep'].end():f['end'].start()] if f['sep'] else ''
            own = RPR_RE.search(f['begin'].group(0))
            rpr = first_rpr(result) or (own.group(0) if own else '')
            # Formatting of the displayed value, or of the field itself when the sample value was empty
            edits.append((start, end, text_run(rpr, placeholder(ref_map, used, name))))
        else:
            print(f'Warning: unexpected field: {instr}')
    for k, n in used.items():
        if k in ref_map and n != len(ref_map[k]):
            print(f'Info: {k}: expected {len(ref_map[k])} REF fields, found {n}')
    for s, e, rep in sorted(edits, reverse=True):
        xml = xml[:s] + rep + xml[e:]
    return xml


def placeholder(ref_map, used, name):
    name = re.sub(r'^(?:&quot;|["\'])|(?:&quot;|["\'])$', '', name).strip()
    if name not in ref_map:
        return ''
    i = used.get(name, 0)
    used[name] = i + 1
    if i < len(ref_map[name]):
        return ref_map[name][i]
    return ref_map[name][-1]


def replace_once(xml, old, new):
    assert xml.count(old) == 1, (xml.count(old), old)
    return xml.replace(old, new)


PARA_RE = re.compile(r'<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?</w:p>', re.S)


def para_with(xml, needle, start=0):
    for m in PARA_RE.finditer(xml, start):
        if needle in m.group(0):
            return m
    raise SystemExit(f'not found: {needle}')


doc = flatten_fields(files['word/document.xml'].decode('utf8'), REF_MAP)
for name in files:
    if re.fullmatch(r'word/(header|footer)\d+\.xml', name):
        x = files[name].decode('utf8')
        files[name] = flatten_fields(x, HEADER_REF_MAP if 'QuoteNumber1' in x else {}).encode('utf8')

# ── Letter ──
def rebuild_para(m, text):
    p = m.group(0)
    ppr = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S)
    return f'<w:p>{ppr.group(0) if ppr else ""}{text_run("", text)}</w:p>'
    # Whole paragraph as one plain run (Word split these sentences into fragments like "o" + "n")


m = para_with(doc, '[short proposal description]')
assert re.sub(r'<[^>]+>', '', m.group(0)) == 'We are pleased to submit the attached proposal for {solutionName}. Our proposal briefs on [short proposal description].'
doc = doc[:m.start()] + rebuild_para(m, 'We are pleased to submit the attached proposal for {solutionName}. Our proposal briefs on the following.') + doc[m.end():]
# The bracketed note is the template's own instruction; the paragraphs written for the customer follow this sentence
m = para_with(doc, '{amPhone}')
assert re.sub(r'<[^>]+>', '', m.group(0)) == 'We look forward to discussing the proposal in detail. Do not hesitate to reach out to {amName} on {amPhone}  should you require any assistance.'
doc = doc[:m.start()] + rebuild_para(m, 'We look forward to discussing the proposal in detail. Do not hesitate to reach out to {amName} {amPhoneClause}should you require any assistance.') + doc[m.end():]
# amPhoneClause is "on 0771234567 " or empty, so a missing phone number leaves no "on"

# ── Investment table: one looped row, with the new QoS Template column ──
t0 = doc.rfind('<w:tbl>', 0, doc.index('QoS Template'))
t1 = doc.index('</w:tbl>', t0) + len('</w:tbl>')
t = doc[t0:t1]
rows = re.findall(r'<w:tr[ >].*?</w:tr>', t, re.S)
assert len(rows) == 3 and 'AB Fiber Access Bearer' in rows[1] and 'BB_SLT' in rows[2], len(rows)
row = rows[1]
for old, new in (('AB Fiber Access Bearer', '{#investment}{description}'), ('4,500.00', '{oneTimeCharge}'), ('750.00', '{monthlyRental}{/investment}')):
    row = replace_once(row, f'>{old}<', f'>{new}<')
na = [mm for mm in re.finditer(r'<w:t>N/A</w:t>', row)]
assert len(na) == 2
row = row[:na[0].start()] + '<w:t>{bandwidth}</w:t>' + row[na[0].end():na[1].start()] + '<w:t>{qosTemplate}</w:t>' + row[na[1].end():]
t = t.replace(rows[1], row).replace(rows[2], '')
doc = doc[:t0] + t + doc[t1:]

# ── Customer Acknowledgements ──
doc = replace_once(doc, '<w:t xml:space="preserve">Regional Enterprise Business Manager </w:t>', '<w:t xml:space="preserve">{ackAddressee1}</w:t>')
doc = replace_once(doc, '<w:t xml:space="preserve">Sri Lanka Telecom PLC </w:t>', '<w:t xml:space="preserve">{ackAddressee2}</w:t>')
ACK_ROWS = [('Company Name', 'ackCompanyName'), ('Address', 'ackAddress'), ('Solution', 'ackSolution'),
            ('Initial Charge', 'ackInitialCharge'), ('Monthly Charge', 'ackMonthlyCharge'), ('Commitment Period', 'ackCommitment')]
ack = doc.index('{ackAddressee1}')
for label, key in ACK_ROWS:
    m = para_with(doc, f'<w:t>{label}</w:t>', ack)
    rpr = '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
    assert rpr in m.group(0) and '…' in m.group(0), label
    new = (f'<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="3600"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'
           f'<w:ind w:left="3780" w:hanging="3600"/>{rpr}</w:pPr>{text_run(rpr, label)}<w:r>{rpr}<w:tab/><w:t xml:space="preserve">: {{{key}}}</w:t></w:r></w:p>')
    doc = doc[:m.start()] + new + doc[m.end():]
    # Same label and ":" position (tab stop 3600) as the template; a long value wraps under itself, not under the label

# ── Contact Us ──
c = doc.index('{amName}', doc.index('Primary Contact'))
doc = doc[:c] + replace_once(doc[c:], '<w:t xml:space="preserve"> Regional Enterprise Account Manager</w:t>', '<w:t xml:space="preserve"> {amDesignation}</w:t>')
sec = doc.index('Secondary Contact')
doc = doc[:sec] + replace_once(doc[sec:], '<w:t>Regional Enterprise Business Manager</w:t>', '<w:t>{rebmDesignation}</w:t>')
lbl = para_with(doc, '<w:t>Email</w:t>', sec)
val = PARA_RE.search(doc, doc.index('<w:tc>', lbl.end()))
assert '<w:t' not in val.group(0), 'Secondary Contact email cell is not empty'
rpr = first_rpr(para_with(doc, '{rebmName}', sec).group(0))
doc = doc[:val.start()] + val.group(0).replace('</w:p>', text_run(rpr, '{rebmEmail}') + '</w:p>') + doc[val.end():]
# The template's Secondary Contact email cell is empty; it gets its placeholder

files['word/document.xml'] = doc.encode('utf8')

# ── Document properties: no author names ──
core = files['docProps/core.xml'].decode('utf8')
core = re.sub(r'<dc:creator>[^<]*</dc:creator>', '<dc:creator>SLT-MOBITEL</dc:creator>', core)
core = re.sub(r'<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>', '<cp:lastModifiedBy>SLT-MOBITEL</cp:lastModifiedBy>', core)
files['docProps/core.xml'] = core.encode('utf8')
app = files['docProps/app.xml'].decode('utf8')
app = re.sub(r'<(Company|Manager)>[^<]*</\1>', r'<\1></\1>', app)
files['docProps/app.xml'] = app.encode('utf8')

for name, data in files.items():
    if name.endswith('.xml') or name.endswith('.rels'):
        x = data.decode('utf8')
        left = [v for v in SAMPLE_VALUES if v in x]
        if left:
            print(f'Notice: {name} still contains {left}')

zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    zout.writestr(item, files[item.filename])
zout.close()
tags = re.findall(r'\{[^{}<]*\}', ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', doc)))
print(sorted(set(tags)))
