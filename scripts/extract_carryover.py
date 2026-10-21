"""Saves the parts of the previous proposal template that the new SLT template doesn't have (run once).

usage: python scripts/extract_carryover.py <old proposal_template.docx> scripts/proposal_assets

- components_table.xml: the Proposed Solution table with its {#components}..{/components} row loop
- network_map.png / solution_diagram.png: the NETWORK ARCHITECTURE and SOLUTION DIAGRAM pictures
- table_style.xml: the "LightShading-Accent5" table style that table uses
fix_template_layout.py reads these files, so the template can be rebuilt without the old one.
"""
import os, re, sys, zipfile

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
z = zipfile.ZipFile(SRC)
doc = z.read('word/document.xml').decode('utf8')
rels = z.read('word/_rels/document.xml.rels').decode('utf8')
styles = z.read('word/styles.xml').decode('utf8')

t0 = doc.rfind('<w:tbl>', 0, doc.index('{#components}'))
t1 = doc.index('</w:tbl>', t0) + len('</w:tbl>')
table = re.sub(r' w14:(paraId|textId)="[^"]+"', '', doc[t0:t1])
# The components table, without Word's paragraph ids (they must be unique in the new document)
open(os.path.join(OUT, 'components_table.xml'), 'w', encoding='utf8').write(table)


def image_after(bookmark):
    i = doc.index(f'w:name="{bookmark}"')
    rid = re.search(r'r:embed="([^"]+)"', doc[i:]).group(1)
    target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"', rels).group(1)
    return z.read('word/' + target)
    # First picture after the heading (found by its bookmark; the Contents page has the same words)


open(os.path.join(OUT, 'network_map.png'), 'wb').write(image_after('_bookmark5'))
open(os.path.join(OUT, 'solution_diagram.png'), 'wb').write(image_after('_bookmark6'))
style = re.search(r'<w:style [^>]*w:styleId="LightShading-Accent5".*?</w:style>', styles, re.S).group(0)
open(os.path.join(OUT, 'table_style.xml'), 'w', encoding='utf8').write(style)
print('saved to', OUT, sorted(os.listdir(OUT)))
