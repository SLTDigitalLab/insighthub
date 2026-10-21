"""Layout for backend/templates/proposal_template.docx (run after make_template.py).

usage: python scripts/fix_template_layout.py <in.docx> <out.docx>

The SLT document places every page with floating tables and runs of empty paragraphs, which LibreOffice (the PDF
renderer) lays out on top of each other. This script rebuilds the body as a plain flow, one section per page:
- Cover: unchanged look; its artwork and logo are pinned to the page, the empty spacer paragraphs are removed.
- Every section table becomes inline and centred, and starts on a new page; empty spacer paragraphs, tall empty
  placeholder rows and stray "-----" lines are removed.
- Pages the SLT document only lists in its Contents are added (kept from the previous template, scripts/proposal_assets):
  YOUR REQUIREMENTS ({@requirementsXml}), PROPOSED SOLUTION ({solutionSummary} + the components table),
  NETWORK ARCHITECTURE (map) and SOLUTION DIAGRAM (diagram).
- New page ABOUT YOU AND HOW WE CAN HELP YOU ({@aboutXml}, built in proposalBuilder.js) just before PROPOSED SOLUTION.
- Letter: the five dotted lines become one {@letterXml} block (built in proposalBuilder.js).
- Contents: the 13 SLT lines + the new section = 14 page numbers {toc0}..{toc13} (filled from the rendered PDF);
  the Contents links point at real headings.
- Back cover: full page, in front of the header and footer.
- Contact Us: the "Other Contacts" icon group becomes a small icon | text table (same icons and lines).
- Every body font becomes Verdana (except Symbol / Wingdings bullets); headers and footers keep the SLT fonts.
"""
import os, re, sys, zipfile

SRC, DST = sys.argv[1], sys.argv[2]
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proposal_assets')
zin = zipfile.ZipFile(SRC)
files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
doc = files['word/document.xml'].decode('utf8')

EMU = 635
# EMU per twip
BODY_MARGINS = '<w:pgMar w:top="1300" w:right="900" w:bottom="1400" w:left="620" w:header="720" w:footer="720" w:gutter="0"/>'
# Body pages: below the "Proposal Ref. No." header, above the footer artwork, clear of the "Page N" strip on the right
TEXT_WIDTH = 11906 - 900 - 620
# 10386 twips
COVER_LOGO_TOP = 5112
# Logo position on the cover, measured on Word's rendering of the SLT document (twips from the top of the page)
PAGE_BREAK = ('<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
              '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>')
# A 1pt paragraph that starts a new page (Word ignores page breaks set inside tables)
NETWORK_HEADING_PPR = '<w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="240"/>'
# proposalBuilder.js looks for exactly these heading properties when it moves NETWORK ARCHITECTURE to a new page
SUBHEADING_RPR = '<w:rPr><w:b/><w:bCs/><w:color w:val="002060"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>'

T_RE = re.compile(r'<w:t(?: [^>]*)?>([^<]*)</w:t>')


def text(x):
    return ''.join(T_RE.findall(x))


def has_picture(x):
    return '<w:drawing' in x or '<w:pict' in x


def body_children(body):
    """Top-level elements of <w:body> (paragraphs, tables, bookmarks, sectPr) as (tag, xml)."""
    out, i = [], 0
    start_re = re.compile(r'<(w:p|w:tbl|w:sectPr|w:bookmarkStart|w:bookmarkEnd|w:sdt)(?=[ >/])')
    while True:
        m = start_re.search(body, i)
        if not m:
            break
        tag = m.group(1)
        head_end = body.index('>', m.start()) + 1
        if body[head_end - 2] == '/':
            end = head_end
        else:
            depth, j = 0, m.start()
            pat = re.compile(rf'<{tag}(?=[ >/])|</{tag}>')
            while True:
                n = pat.search(body, j)
                if body.startswith('</', n.start()):
                    depth -= 1
                elif body[body.index('>', n.start()) - 1] != '/':
                    depth += 1
                j = n.end()
                if depth == 0:
                    break
            end = j
        out.append((tag, body[m.start():end]))
        i = end
    return out


b0 = doc.index('<w:body>') + len('<w:body>')
b1 = doc.rindex('</w:body>')
kids = body_children(doc[b0:b1])
assert ''.join(x for _, x in kids) == re.sub(r'^\s+|\s+$', '', doc[b0:b1]), 'body split lost content'


def find(pred, start=0, what=''):
    for k in range(start, len(kids)):
        if pred(*kids[k]):
            return k
    raise SystemExit(f'not found: {what}')


def table_with(s, start=0):
    return find(lambda tag, x: tag == 'w:tbl' and s in text(x), start, s)


# ── Locate every block of the SLT document ──
cover_end = find(lambda tag, x: tag == 'w:p' and '<w:sectPr' in x, 0, 'cover section break')
toc_head = find(lambda tag, x: 'TABLE OF CONTENTS' in text(x), cover_end, 'TABLE OF CONTENTS')
letter = table_with('{proposalDate}')
toc_entries = [k for k in range(toc_head + 1, letter) if re.search(r'<w:pStyle w:val="TOC[12]"/>', kids[k][1]) and text(kids[k][1]).strip()]
assert len(toc_entries) == 13, len(toc_entries)
overview = table_with('COMPANY OVERVIEW')
strengths = table_with('OUR STRENGTHS')
strengths_pic = find(lambda tag, x: tag == 'w:p' and has_picture(x), strengths, 'Our Strengths picture')
why = table_with('WHY WITH US')
why_pic = find(lambda tag, x: tag == 'w:p' and has_picture(x), why, 'Why With Us picture')
solution = table_with('PROPOSED SOLUTION')
investment = table_with('{#investment}')
investment_head = table_with('YOUR INVESTMENT')
terms_head = table_with('TERMS AND CONDITIONS')
terms = [k for k in range(investment_head + 1, terms_head) if kids[k][0] == 'w:p' and text(kids[k][1]).strip()]
assert len(terms) == 7, len(terms)
ack = table_with('{ackAddressee1}')
sme = table_with('SME SOLUTIONS')
awards = table_with('AWARDS AND ACCOLADES')
awards2 = find(lambda tag, x: tag == 'w:tbl' and has_picture(x), awards + 1, 'second Awards page')
contact = table_with('CONTACT US')
back = find(lambda tag, x: tag == 'w:p' and has_picture(x), contact + 1, 'back cover')
final = find(lambda tag, x: tag == 'w:sectPr', back, 'final section')
assert investment_head > investment > solution > why_pic > why > strengths_pic > strengths > overview > letter
assert final == len(kids) - 1


def clean_ids(x):
    return re.sub(r' w14:(paraId|textId)="[^"]+"', '', x)
    # Copied XML must not repeat Word's paragraph ids


def inline_table(x):
    x = re.sub(r'<w:tblpPr [^>]*/>', '', x)
    # No longer floating: the table sits in the text flow
    m = re.match(r'<w:tbl><w:tblPr>(.*?)</w:tblPr>', x, re.S)
    pr = re.sub(r'<w:jc w:val="\w+"/>|<w:tblInd [^>]*/>', '', m.group(1))
    pr = re.sub(r'(<w:tblW [^>]*/>)', lambda w: w.group(1) + '<w:jc w:val="center"/>', pr, count=1)
    assert '<w:tblW ' in pr and '<w:jc w:val="center"/>' in pr, pr
    x = f'<w:tbl><w:tblPr>{pr}</w:tblPr>' + x[m.end():]
    # Centred, like the floating tables were (tblpXSpec="center"); jc goes right after tblW (Word checks the order)
    rows = re.findall(r'<w:tr[ >](?:(?!</w:tr>).)*</w:tr>', x, re.S)
    for r in rows:
        h = re.search(r'<w:trHeight w:val="(\d+)"', r)
        if h and int(h.group(1)) >= 1000 and not text(r).strip() and not has_picture(r):
            x = x.replace(r, '', 1)
            # Tall empty rows only reserved space next to the floating layout
    return x


def banner(title, bookmark=None):
    """The SLT section heading bar (navy row with white capitals), copied from PROPOSED SOLUTION."""
    t = inline_table(kids[solution][1])
    rows = re.findall(r'<w:tr[ >](?:(?!</w:tr>).)*</w:tr>', t, re.S)
    head = rows[1]
    assert 'PROPOSED SOLUTION' in head
    if title != 'PROPOSED SOLUTION':
        head = re.sub(r'<w:bookmark(Start|End) [^>]*/>', '', head).replace('<w:t>PROPOSED SOLUTION</w:t>', f'<w:t>{title}</w:t>')
        # A copy must not take PROPOSED SOLUTION's own bookmark
    if bookmark:
        head = head.replace('<w:r', f'<w:bookmarkStart w:id="{bookmark[0]}" w:name="{bookmark[1]}"/><w:bookmarkEnd w:id="{bookmark[0]}"/><w:r', 1)
    t = t[:t.index('<w:tr')] + rows[0] + head + '</w:tbl>'
    return clean_ids(t)
    # Spacer row + heading row; the content follows the table as normal paragraphs


def raw_para(tag):
    return f'<w:p><w:r><w:t>{{@{tag}}}</w:t></w:r></w:p>'
    # A paragraph holding only a {@raw} tag is replaced as a whole by docxtemplater


def subheading(title, bookmark, new_page=False):
    ppr = NETWORK_HEADING_PPR if not new_page else '<w:pStyle w:val="Heading2"/><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0"/>'
    return (f'<w:p><w:pPr>{ppr}<w:ind w:left="360"/></w:pPr><w:bookmarkStart w:id="{bookmark[0]}" w:name="{bookmark[1]}"/>'
            f'<w:bookmarkEnd w:id="{bookmark[0]}"/><w:r>{SUBHEADING_RPR}<w:t>{title}</w:t></w:r></w:p>')


def picture_para(rid, pic_id, name, width_tw, px):
    cx = width_tw * EMU
    cy = round(cx * px[1] / px[0])
    return (f'<w:p><w:pPr><w:keepLines/><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
            f'<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{pic_id}" name="{name}"/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{pic_id}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')


def png_size(path):
    b = open(path, 'rb').read(24)
    return int.from_bytes(b[16:20], 'big'), int.from_bytes(b[20:24], 'big')


def pin_to_page(x, name, h=None, v=None):
    """Anchors the named picture to the page instead of to a paragraph that moves when spacers are removed."""
    m = re.search(rf'<wp:anchor (?:(?!</wp:anchor>).)*?name="{re.escape(name)}"(?:(?!</wp:anchor>).)*</wp:anchor>', x, re.S)
    assert m, name
    a = m.group(0)
    if h is not None:
        a = re.sub(r'<wp:positionH relativeFrom="\w+">\s*<wp:posOffset>-?\d+</wp:posOffset>', f'<wp:positionH relativeFrom="page"><wp:posOffset>{h}</wp:posOffset>', a)
    if v is not None:
        a = re.sub(r'<wp:positionV relativeFrom="\w+">\s*<wp:posOffset>-?\d+</wp:posOffset>', f'<wp:positionV relativeFrom="page"><wp:posOffset>{v}</wp:posOffset>', a)
    return x.replace(m.group(0), a), a


# ── Cover ──
cover = [x for tag, x in kids[:cover_end + 1] if tag == 'w:tbl' or has_picture(x) or '<w:sectPr' in x]
assert len(cover) == 4, len(cover)
# Title table, cover artwork, logo, section break
cover[0], n = re.subn(r'<w:tblpPr [^>]*/>', '', cover[0])
assert n == 1
cover[0], n = re.subn(r'<w:trHeight w:val="15096"/>', '<w:trHeight w:val="2600"/>', cover[0])
assert n == 1
cover[0] = re.sub(r'<w:p(?: [^>]*)?/>|<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?</w:p>', lambda p: p.group(0) if text(p.group(0)).strip() else '', cover[0], flags=re.S)
cover[0] = cover[0].replace('</w:tc>', '<w:p/></w:tc>')
assert text(cover[0]).count('{') == 2
# Only the title paragraphs stay in the title cell (the 20 empty 24pt lines under them made it taller than the page)
# Title table inline at the top of the cover; its one row was page-tall (the title sits at its top), which pushed the
# artwork and logo onto a second page in LibreOffice
cover[1], art = pin_to_page(cover[1], 'Group 2', h=0, v=0)
cover[2], logo = pin_to_page(cover[2], 'Image 7', v=COVER_LOGO_TOP * EMU)
assert 'relativeFrom="page"><wp:posOffset>2483485' in logo
cover[2] = cover[2].replace(logo, logo.replace('<wp:wrapTopAndBottom/>', '<wp:wrapNone/>'))
# Pinned to the page, the logo no longer needs to push text down (that pushed the section break onto a blank page 2)

# ── Contents ──
ABOUT = 'ABOUT YOU AND HOW WE CAN HELP YOU'
ABOUT_ANCHOR = '_TocIHAboutYou'
# New section (not in the SLT document), between YOUR REQUIREMENTS and PROPOSED SOLUTION
anchors = {}
entries = []
for k in toc_entries:
    p = kids[k][1]
    name = re.sub(r'\s+', ' ', text(p).rstrip('0123456789').strip())
    anchors[name] = re.search(r'w:anchor="([^"]+)"', p).group(1)
    p = re.sub(r'(</w:hyperlink>)<w:r(?: [^>]*)?>(?:(?!</w:r>).)*<w:t>\d+</w:t></w:r>', r'\1', p, flags=re.S)
    # Word split "12" across the end of the link ("1" inside, "2" outside); the outside digit goes
    p = p.replace('<w:webHidden/>', '')
    # LibreOffice hides "web hidden" runs, which held the dotted tab and the page number
    entries.append((name, p))
SLT_ORDER = ['COMPANY OVERVIEW', 'OUR STRENGTHS', 'WHY WITH US', 'YOUR REQUIREMENTS', 'PROPOSED SOLUTION', 'NETWORK ARCHITECTURE',
             'SOLUTION DIAGRAM', 'YOUR INVESTMENT', 'TERMS AND CONDITIONS', 'CUSTOMER ACKNOWLEDGEMENTS', 'SME SOLUTIONS',
             'AWARDS AND ACCOLADES', 'CONTACT US']
assert [n for n, _ in entries] == SLT_ORDER, [n for n, _ in entries]
req = SLT_ORDER.index('YOUR REQUIREMENTS')
about_entry = clean_ids(entries[req][1]).replace('<w:t>YOUR REQUIREMENTS</w:t>', f'<w:t>{ABOUT}</w:t>')
about_entry = re.sub(r'w:anchor="[^"]+"', f'w:anchor="{ABOUT_ANCHOR}"', about_entry)
assert ABOUT in text(about_entry)
entries.insert(req + 1, (ABOUT, about_entry))
anchors[ABOUT] = ABOUT_ANCHOR
# Contents line for the new section: a copy of the YOUR REQUIREMENTS line, linked to the new heading
toc = [kids[toc_head][1]]
for i, (name, p) in enumerate(entries):
    p, n = re.subn(r'<w:t>\d+</w:t>(</w:r></w:hyperlink>)', f'<w:t>{{toc{i}}}</w:t>\\1', p)
    assert n == 1, name
    toc.append(p)
TOC_ORDER = [n for n, _ in entries]
assert len(TOC_ORDER) == 14
# Same order as TOC_HEADINGS in proposalBuilder.js: {toc0}..{toc13}

# ── Letter ──
lt = inline_table(kids[letter][1])
dots = [m for m in re.finditer(r'<w:p(?: [^>]*)?>(?:(?!</w:p>).)*?</w:p>', lt, re.S) if re.fullmatch(r'…+', text(m.group(0)))]
assert len(dots) == 5, len(dots)
lt = lt[:dots[0].start()] + raw_para('letterXml') + lt[dots[-1].end():]
assert '{amPhoneClause}' in lt

# ── New pages kept from the previous template ──
used_ids = [int(i) for i in re.findall(r'<w:bookmarkStart w:id="(\d+)"', doc)]
bid = iter(range(max(used_ids + [0]) + 1, 10 ** 6))
for name in ('YOUR REQUIREMENTS', ABOUT, 'NETWORK ARCHITECTURE', 'SOLUTION DIAGRAM', 'PROPOSED SOLUTION'):
    doc_has = f'w:name="{anchors[name]}"' in doc
    anchors[name] = (next(bid), anchors[name]) if not doc_has else None
    # The SLT document has no heading for these yet, so its Contents links went nowhere

components = open(os.path.join(ASSETS, 'components_table.xml'), encoding='utf8').read()
assert '{#components}' in components and '{/components}' in components
components = components.replace('<w:tblW w:w="10000" w:type="dxa"/>', f'<w:tblW w:w="{min(10000, TEXT_WIDTH - 400)}" w:type="dxa"/>')
summary = ('<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="240" w:after="240" w:line="360" w:lineRule="auto"/>'
           '<w:ind w:left="360" w:right="360"/><w:jc w:val="both"/></w:pPr><w:r><w:t>{solutionSummary}</w:t></w:r></w:p>')
map_px = png_size(os.path.join(ASSETS, 'network_map.png'))
diagram_px = png_size(os.path.join(ASSETS, 'solution_diagram.png'))

requirements_page = [PAGE_BREAK, banner('YOUR REQUIREMENTS', anchors['YOUR REQUIREMENTS']), raw_para('requirementsXml')]
about_page = [PAGE_BREAK, banner(ABOUT, anchors[ABOUT]), raw_para('aboutXml')]
# Description + recommended products, built in proposalBuilder.js (kept to one page there)
solution_page = [PAGE_BREAK, banner('PROPOSED SOLUTION', anchors['PROPOSED SOLUTION']), summary, components, '<w:p/>',
                 subheading('NETWORK ARCHITECTURE', anchors['NETWORK ARCHITECTURE']),
                 picture_para('rIdIHMap', 9801, 'Network architecture', 6285, map_px)]
diagram_page = [subheading('SOLUTION DIAGRAM', anchors['SOLUTION DIAGRAM'], new_page=True),
                picture_para('rIdIHDiagram', 9802, 'Solution diagram', 7080, diagram_px)]

# ── Contact Us: "Other Contacts" icons + text as a small table ──
def other_contacts(x):
    """The SLT document draws the 4 icons and a text box as one floating group; LibreOffice lays the text box out
    differently from Word, so the lines ran over the icons. Same icons and lines, as icon | text rows."""
    g = x.index('name="Group 14"')
    a0 = x.rfind('<mc:AlternateContent>', 0, g)
    a1 = x.index('</mc:AlternateContent>', g) + len('</mc:AlternateContent>')
    choice = x[a0:x.index('<mc:Fallback>', a0)]
    icons = re.findall(r'r:embed="([^"]+)"', choice)
    lines = re.findall(r'<w:p[ >](?:(?!</w:p>).)*?</w:p>', re.search(r'<w:txbxContent>(.*?)</w:txbxContent>', choice, re.S).group(1), re.S)
    lines = [p for p in lines if text(p).strip()]
    assert len(icons) == 4 and len(lines) == 4, (icons, len(lines))
    rows = ''
    for n, (rid, line) in enumerate(zip(icons, lines)):
        runs = re.sub(r'^<w:p(?: [^>]*)?>(?:<w:pPr>.*?</w:pPr>)?|</w:p>$', '', line, flags=re.S)
        icon = picture_para(rid, 9810 + n, f'Contact icon {n + 1}', 300, (1, 1)).replace(
            '<w:pPr><w:keepLines/><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr>', '<w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>')
        rows += (f'<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>{icon}</w:tc>'
                 f'<w:tc><w:tcPr><w:tcW w:w="5400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>'
                 f'<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>{runs}</w:p></w:tc></w:tr>')
    table = ('<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr>'
             f'<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="5400"/></w:tblGrid>{rows}</w:tbl>')
    p0 = max(x.rfind('<w:p>', 0, a0), x.rfind('<w:p ', 0, a0))
    p1 = x.index('</w:p>', a1) + len('</w:p>')
    assert not text(x[p0:a0] + x[a1:p1]).strip()
    return x[:p0] + table + '<w:p/>' + x[p1:]
    # A table in a cell must be followed by a paragraph


SPACER = '<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>'
# Space under a section heading bar; also keeps two tables from merging into one

# ── Back cover: full page, in front of the header and footer ──
bc, art = pin_to_page(kids[back][1], 'Image 263', h=0, v=0)
bc = bc.replace(art, art.replace('behindDoc="1"', 'behindDoc="0"'))
# In front, so the header's ref number, the "Page N" strip and the footer don't show on the back cover

# ── Body pages, one section per page ──
section = lambda k: [PAGE_BREAK, inline_table(kids[k][1])]
body = (cover + toc
        + [PAGE_BREAK, lt]
        + section(overview)
        + section(strengths) + [kids[strengths_pic][1]]
        + section(why) + [kids[why_pic][1]]
        + requirements_page + about_page + solution_page + diagram_page
        + section(investment_head) + [SPACER, inline_table(kids[investment][1])]
        + section(terms_head) + [SPACER] + [kids[k][1] for k in terms]
        + section(ack) + section(sme) + section(awards) + section(awards2)
        + [PAGE_BREAK, other_contacts(inline_table(kids[contact][1]))]
        + [PAGE_BREAK, bc]
        + [kids[final][1]])
body[-1] = re.sub(r'<w:pgMar [^>]*/>', BODY_MARGINS, body[-1])
# Body pages get the new margins; the cover section (its section break is in the cover paragraphs) keeps its own
body_xml = ''.join(body)
assert body_xml.count(BODY_MARGINS) == 1

starts = set(re.findall(r'<w:bookmarkStart w:id="(\d+)"', body_xml))
ends = set(re.findall(r'<w:bookmarkEnd w:id="(\d+)"', body_xml))
body_xml = re.sub(r'<w:bookmarkStart w:id="(\d+)"[^>]*/>', lambda m: m.group(0) if m.group(1) in ends else '', body_xml)
body_xml = re.sub(r'<w:bookmarkEnd w:id="(\d+)"[^>]*/>', lambda m: m.group(0) if m.group(1) in starts else '', body_xml)
# Bookmarks whose other half sat in a removed spacer paragraph
doc = doc[:b0] + body_xml + doc[b1:]

kept = text(body_xml)
dropped = [t for t in (text(x).strip() for _, x in kids) if t and re.sub(r'\d+$', '', t)[:40] not in kept]
assert all(re.fullmatch(r'-+', t) for t in dropped), dropped
# Only the stray "-----" lines may be left out; every other text block is in the new body

files['word/document.xml'] = doc.encode('utf8')

# ── Pictures and table style for the added pages ──
files['word/media/ih_network_map.png'] = open(os.path.join(ASSETS, 'network_map.png'), 'rb').read()
files['word/media/ih_solution_diagram.png'] = open(os.path.join(ASSETS, 'solution_diagram.png'), 'rb').read()
rels = files['word/_rels/document.xml.rels'].decode('utf8')
IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
rels = rels.replace('</Relationships>', f'<Relationship Id="rIdIHMap" Type="{IMG}" Target="media/ih_network_map.png"/>'
                    f'<Relationship Id="rIdIHDiagram" Type="{IMG}" Target="media/ih_solution_diagram.png"/></Relationships>')
files['word/_rels/document.xml.rels'] = rels.encode('utf8')
styles = files['word/styles.xml'].decode('utf8')
if 'w:styleId="LightShading-Accent5"' not in styles:
    styles = styles.replace('</w:styles>', open(os.path.join(ASSETS, 'table_style.xml'), encoding='utf8').read() + '</w:styles>')
files['word/styles.xml'] = styles.encode('utf8')

# ── Verdana everywhere ──
VERDANA = '<w:rFonts w:ascii="Verdana" w:eastAsia="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>'
for name in list(files):
    if name in ('word/document.xml', 'word/styles.xml'):
        # Headers and footers keep the SLT fonts: the footer's "#DoBusinessBetter #BusinessIntelligence" box is sized for Century Gothic
        x = files[name].decode('utf8')
        x = re.sub(r'<w:rFonts [^>]*/>', lambda r: r.group(0) if re.search(r'Symbol|Wingdings', r.group(0)) else VERDANA, x)
        files[name] = x.encode('utf8')

zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    zout.writestr(item, files[item.filename])
for name in ('word/media/ih_network_map.png', 'word/media/ih_solution_diagram.png'):
    zout.writestr(name, files[name])
zout.close()
tags = re.findall(r'\{[^{}<]*\}', ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', doc)))
print(sorted(set(tags)))
