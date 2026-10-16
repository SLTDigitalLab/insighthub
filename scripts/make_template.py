import re, zipfile, sys

SRC = sys.argv[1]
DST = sys.argv[2]
RED = ('EE0000', 'FF0000')

zin = zipfile.ZipFile(SRC)
doc = zin.read('word/document.xml').decode('utf8')

EXACT = {
    'BLUE BEACH HOTEL': '{companyNameUpper}',
    'Proposal Ref. No. 1-SDERFS': 'Proposal Ref. No. {refNo}',
    '1-SDERFS': '{refNo}',
    '08 AUG 2025': '{proposalDate}',
    'IT Manager': '{recipientDesignation}',
    'Blue Beach Hotel': '{companyName}',
    '01,': '{addressLine1}',
    'Galle Road,': '{addressLine2}',
    'Colombo': '{city}',
    'Business Internet Line': '{solutionName}',
    'Samith Senevirathne': '{amName}',
    '0718765467': '{amPhone}',
    'After careful study on your requirement, we have designed following solutions for your requirements. Total solution includes following components.': '{solutionSummary}',
    'BIL': '{#components}{service}',
    'Malabe': '{station}',
    'Fibre': '{accessMedia}',
    'Layer 3 Cisco Router': '{ntu}{/components}',
    'WPC2 [REBM AREA]': '{rebmArea}',
    'Enterprise Account Manager': '{amDesignation}',
    'samith@slt.com.lk': '{amEmail}',
    'Regional Enterprise Business Manager': '{rebmDesignation}',
    '0718765456': '{rebmPhone}',
    'amila@slt.com.lk': '{rebmEmail}',
}
PREFIX = {
    'Business Internet lines are used': '{solutionIntro1}',
    'Dedicated internet solution': '{solutionIntro2}',
}
division_seen = [0]

def transform(text):
    core = text.strip()
    lead = text[:len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    if core in EXACT:
        return lead + EXACT[core] + trail
    if core == 'REBM WPC 2':
        division_seen[0] += 1
        return lead + ('{amDivision}' if division_seen[0] == 1 else '{rebmDivision}') + trail
    for p, v in PREFIX.items():
        if core.startswith(p):
            return lead + v + trail
    if 'Blue Beach Hotel' in text:
        return text.replace('Blue Beach Hotel', '{companyName}')
    return text

def is_red(run):
    m = re.search(r'<w:color w:val="([0-9A-Fa-f]{6})"', run)
    return bool(m and m.group(1).upper() in RED)

def set_text(run, new):
    ts = list(re.finditer(r'<w:t(?: [^>]*)?>[^<]*</w:t>', run))
    if not ts:
        return run
    out = run[:ts[0].start()] + '<w:t xml:space="preserve">' + new.replace('&', '&amp;') + '</w:t>'
    out += run[ts[-1].end():] if len(ts) == 1 else ''.join(
        re.sub(r'<w:t(?: [^>]*)?>[^<]*</w:t>', '', run[ts[0].end():]))
    return out

def run_text(run):
    return ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', run)).replace('&amp;', '&')

RUN_RE = re.compile(r'<w:r(?: [^>]*)?>(?:(?!</w:r>).)*?</w:r>', re.S)

def process_para(p):
    runs = list(RUN_RE.finditer(p))
    groups, cur = [], []
    for r in runs:
        txt = run_text(r.group(0))
        if is_red(r.group(0)) and txt != '':
            cur.append(r)
        elif txt == '' and cur:
            continue
        else:
            if cur: groups.append(cur); cur = []
    if cur: groups.append(cur)
    edits = {}
    for g in groups:
        joined = ''.join(run_text(r.group(0)) for r in g)
        new = transform(joined)
        if new == joined:
            continue
        edits[g[0].start()] = (g[0].end(), set_text(g[0].group(0), new))
        for r in g[1:]:
            edits[r.start()] = (r.end(), set_text(r.group(0), ''))
    out, pos = [], 0
    for s in sorted(edits):
        e, rep = edits[s]
        out.append(p[pos:s]); out.append(rep); pos = e
    out.append(p[pos:])
    return ''.join(out)

PARA_RE = re.compile(r'<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?</w:p>', re.S)
doc = PARA_RE.sub(lambda m: process_para(m.group(0)), doc)

REQ = 'Uninterrupted Internet connectivity for head office with dedicated IP'
m = re.search(r'<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?' + re.escape(REQ) + r'.*?</w:p>', doc, re.S)
para = m.group(0)
para = re.sub(r' w14:paraId="[^"]+"', '', para)
block = para.replace(REQ, '{@requirementsXml}')
doc = doc[:m.start()] + block + doc[m.end():]

PLAIN = [
    ('<w:t>Business Internet Line_BWB</w:t>', '<w:t>{#investment}{description}</w:t>'),
    ('<w:t>10Mbps</w:t>', '<w:t>{bandwidth}</w:t>'),
    ('<w:t>100,000.00</w:t>', '<w:t>{oneTimeCharge}</w:t>'),
    ('<w:t>150,000.00</w:t>', '<w:t>{monthlyRental}{/investment}</w:t>'),
    ('>1 Year </w:t>', '>{commitmentPeriod} </w:t>'),
]
for a, b in PLAIN:
    assert doc.count(a) == 1, a
    doc = doc.replace(a, b)

names = iter(['{amName}', '{rebmName}'])
doc = re.sub(r'<w:t>Name:</w:t>', lambda m: '<w:t xml:space="preserve">Name: ' + next(names) + '</w:t>', doc)

for c in RED:
    doc = doc.replace(f'w:val="{c}"', 'w:val="000000"')

zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = doc.encode('utf8') if item.filename == 'word/document.xml' else zin.read(item.filename)
    zout.writestr(item, data)
zout.close()

tags = re.findall(r'\{[^{}<]*\}', ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', doc)))
print(sorted(set(tags)))
