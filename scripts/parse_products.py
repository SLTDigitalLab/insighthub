import re, json, sys
txt = open(sys.argv[1], encoding='utf8').read()
lines = txt.split('\n')
products = []
pillar = None
cur = None
section = None
for raw in lines:
    s = raw.strip()
    m = re.match(r'PILLAR:\s*\d+\.\s*(.+)', s)
    if m:
        pillar = m.group(1).strip().title().replace('Idc', 'IDC').replace('Tv', 'TV')
        continue
    m = re.match(r'PRODUCT NAME:\s*(.+)', s)
    if m:
        cur = {'name': m.group(1).strip(), 'pillar': pillar, 'description': '', 'features': []}
        products.append(cur); section = None
        continue
    if cur is None or not s or set(s) <= set('―-'):
        continue
    m = re.match(r'(Product Description|Business Description|Key Features)\s*(.*)', s)
    if m:
        section = 'features' if m.group(1) == 'Key Features' else 'description'
        s = m.group(2).strip()
        if not s:
            continue
    if section == 'description':
        cur['description'] = (cur['description'] + ' ' + s).strip()
    elif section == 'features':
        if s.startswith('•'):
            cur['features'].append(s.lstrip('•').strip())
        elif cur['features']:
            cur['features'][-1] += ' ' + s
for p in products:
    p['description'] = re.sub(r'\s+', ' ', p['description']).replace('Plesk -based', 'Plesk-based').replace('"edge"wherever', '"edge" wherever')
    p['features'] = [re.sub(r'\s+', ' ', f) for f in p['features']]
    p['id'] = re.sub(r'[^a-z0-9]+', '-', p['name'].lower().split('(')[0]).strip('-')
print(len(products))
bad = [p['name'] for p in products if not p['description'] or not p['features']]
print('missing:', bad)
json.dump(products, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
