"""
Assemble les données de l'appli :
  public/data/cells/<x>_<y>.json  géométrie des lignes (avec PK par sommet) et des voies, par case de 0,25°
  public/data/lines/<code>.json   fiche de chaque ligne : tronçons, sections (vitesse…), éléments triés par PK
  public/data/manifest.json       version, sources, liste des fichiers, contrôle qualité
  tiles-src/<couche>.json         GeoJSON des couches de la carte (pour le générateur de tuiles)

Usage : python3 -I build_products.py <build> <dossier app public/data> <tiles-src>
"""
import json
import math
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point

BUILD, DATA, TSRC = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
for d in (DATA / 'cells', DATA / 'lines', TSRC):
    d.mkdir(parents=True, exist_ok=True)

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
CELL = 4  # 1/4 de degré


def fmt_pk(pk):
    if pk is None:
        return ''
    sign = '-' if pk < 0 else ''
    m = round(abs(pk) * 1000)
    return f"{sign}{m // 1000}+{m % 1000:03d}"


lines = json.load(open(BUILD / 'lines.json'))
meta = json.load(open(BUILD / 'meta_sncf.json'))
names = meta['names']
osm = json.load(open(BUILD / 'osm.json'))
STATUT_SHORT = {'Exploitée': 'E', 'Exploitée (S9A3)': 'E', 'Voie de service': 'S', 'Neutralisée': 'N',
                'Fermée': 'F', 'Déclassée': 'D', 'Retranchée': 'D'}

# ---------- Index spatial des tronçons (Lambert-93) ----------
geoms, along, pks = [], [], []
for t in lines:
    xy = [to_l93(v[0], v[1]) for v in t['verts']]
    g = LineString(xy)
    acc = [0.0]
    for i in range(1, len(xy)):
        acc.append(acc[-1] + math.dist(xy[i - 1], xy[i]))
    geoms.append(g)
    along.append(acc)
    pks.append([v[2] for v in t['verts']])
tree = shapely.STRtree(geoms)


def snap(lon, lat, maxd):
    """Tronçon le plus proche dans maxd mètres → (indice, distance, pk)."""
    p = Point(to_l93(lon, lat))
    idx = tree.query(p.buffer(maxd))
    best = None
    for i in idx:
        d = geoms[i].distance(p)
        if d <= maxd and (best is None or d < best[1]):
            best = (int(i), d)
    if not best:
        return None
    i, d = best
    a = geoms[i].project(p)
    acc, pk = along[i], pks[i]
    lo, hi = 0, len(acc) - 1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if acc[m] <= a:
            lo = m
        else:
            hi = m
    seg = acc[hi] - acc[lo]
    val = pk[lo] + (pk[hi] - pk[lo]) * ((a - acc[lo]) / seg if seg > 0 else 0)
    return i, d, val


# ---------- Signaux OSM ----------
MAIN = {'FR:C': 'Carré', 'FR:CARRE': 'Carré', 'FR:CV': 'Carré violet', 'FR:Cv': 'Carré violet',
        'FR:S': 'Sémaphore', 'FR:GA': "Guidon d'arrêt"}
DISTANT = {'FR:A': 'Avertissement', 'FR:mirliton': 'Mirliton', 'FR:D': 'Disque'}
ELEC = {'FR:SECT': 'Sectionnement', 'FR:REV': 'REV', 'FR:CC_EXE': 'Coupez courant', 'FR:CC_FIN': 'Fin coupez courant',
        'FR:BP_DIS': 'Baissez panto', 'FR:BP_EXE': 'Baissez panto', 'FR:BP_FIN': 'Fin baissez panto',
        'FR:end_of_catenary': 'Fin de caténaire'}


def classify(tags):
    ref = tags.get('ref') or tags.get('railway:signal:main:ref') or ''
    v = tags.get('railway:signal:main')
    if v:
        return 'carre', (MAIN.get(v) or 'Signal'), ref
    v = tags.get('railway:signal:distant')
    if v:
        return 'avert', (DISTANT.get(v) or 'Avertissement'), ref
    for k in ('railway:signal:speed_limit', 'railway:signal:speed_limit_distant', 'railway:signal:speed_limit_reminder'):
        v = tags.get(k)
        if v:
            sp = tags.get(f'{k}:speed') or tags.get(f'{k}:fixed:speed') or ''
            sp = re.sub(r'[^0-9;]', '', sp.split(';')[0]) if sp else ''
            name = {'FR:Z': 'Pancarte Z', 'FR:R': 'Pancarte R', 'FR:TIV-D': 'TIV à distance', 'FR:TIV-D_FIXE': 'TIV à distance',
                    'FR:TIV-R': 'TIV de rappel', 'FR:speed_indicator': 'TIV', 'FR:Chevron': 'Chevron', 'FR:CHEVRON': 'Chevron',
                    'FR:marker': 'Repère TIV', 'FR:KM': 'Pancarte K'}.get(v, 'TIV')
            return 'vitesse', f"{name} {sp}".strip(), ref
    v = tags.get('railway:signal:electricity')
    if v:
        return 'elec', ELEC.get(v, 'Signal électrique'), ref
    for k, lab in (('railway:signal:stop', "Repère d'arrêt"), ('railway:signal:route', 'Indicateur de direction'),
                   ('railway:signal:route_distant', 'Tableau indicateur de direction'), ('railway:signal:shunting', 'Signal de manœuvre'),
                   ('railway:signal:train_protection', 'Repère TVM/ETCS'), ('railway:signal:whistle', 'Siffler'),
                   ('railway:signal:minor', 'Signal'), ('railway:signal:station_distant', "Annonce d'établissement")):
        if tags.get(k):
            return 'autre', lab, ref
    return 'autre', 'Signal', ref


line_points = defaultdict(list)  # code -> [pk, kind, label, detail, lon, lat, (pk2)]
tile_layers = defaultdict(list)


def feat(geom_type, coords, props):
    return {'type': 'Feature', 'geometry': {'type': geom_type, 'coordinates': coords}, 'properties': props}


sig_counts = defaultdict(int)
snapped_signals = 0
for s in osm['signals']:
    cat, label, ref = classify(s['tags'])
    sig_counts[cat] += 1
    lon, lat = s['xy']
    sn = snap(lon, lat, 30)
    pk = None
    props = {'k': cat, 'l': f"{label} {ref}".strip()}
    if sn:
        i, d, pk = sn
        snapped_signals += 1
        code = lines[i]['code']
        props.update({'c': code, 'pk': fmt_pk(pk)})
        line_points[code].append([round(pk, 3), f'sig_{cat}', props['l'], '', lon, lat])
    tile_layers['signaux'].append(feat('Point', [lon, lat], props))
print('signaux', dict(sig_counts), 'rattachés', snapped_signals)

# ---------- Bornes OSM : contrôle indépendant des PK calculés ----------
ms_err = []
for m in osm['milestones']:
    lon, lat = m['xy']
    try:
        pos = float(str(m['pos']).replace(',', '.').split(';')[0])
    except (TypeError, ValueError):
        pos = None
    if pos is not None:
        tile_layers['bornes'].append(feat('Point', [lon, lat], {'p': f"{pos:g}"}))
        sn = snap(lon, lat, 20)
        if sn:
            ms_err.append(abs(sn[2] - pos) * 1000)
ms_err.sort()
q = lambda v, f: round(v[int(f * (len(v) - 1))]) if v else None
milestone_check = {'bornes_comparees': len(ms_err), 'ecart_median_m': q(ms_err, .5), 'ecart_p75_m': q(ms_err, .75),
                   'ecart_p90_m': q(ms_err, .9)}
print('contrôle bornes OSM', milestone_check)

# ---------- Tunnels OSM ----------
def tunnel_name(t):
    n = t.get('name') or ''
    return n if re.search(r'(?i)tunnel|souterrain|galerie|tranchée couverte', n) else 'Tunnel'


tunnels = defaultdict(list)  # (code, name) -> [(pk1, pk2, coords)]
for t in osm['tunnels']:
    if t['railway'] not in ('rail', 'narrow_gauge'):
        continue
    c = t['coords']
    a = snap(c[0][0], c[0][1], 40)
    b = snap(c[-1][0], c[-1][1], 40)
    name = tunnel_name(t)
    tile_layers['tunnels'].append(feat('LineString', c, {'n': name}))
    if a and b and lines[a[0]]['code'] == lines[b[0]]['code']:
        tunnels[(lines[a[0]]['code'], name)].append((min(a[2], b[2]), max(a[2], b[2]), c[len(c) // 2]))
n_tun = 0
for (code, name), parts in tunnels.items():
    parts.sort()
    merged = []
    for p1, p2, mid in parts:
        if merged and p1 <= merged[-1][1] + 0.05:
            merged[-1][1] = max(merged[-1][1], p2)
        else:
            merged.append([p1, p2, mid])
    for p1, p2, mid in merged:
        if p2 - p1 < 0.03:
            continue
        n_tun += 1
        line_points[code].append([round(p1, 3), 'tunnel', name, f"{round((p2 - p1) * 1000)} m · jusqu'au PK {fmt_pk(p2)}", mid[0], mid[1], round(p2, 3)])
print('tunnels rattachés', n_tun)

# ---------- Sous-stations OSM ----------
n_sst = 0
for s in osm['substations']:
    lon, lat = s['xy']
    name = s.get('name') or ''
    label = name if re.search(r'(?i)sous', name) else f"Sous-station {name}".strip()
    tile_layers['sst'].append(feat('Point', [lon, lat], {'n': label}))
    sn = snap(lon, lat, 400)
    if sn:
        n_sst += 1
        i, d, pk = sn
        line_points[lines[i]['code']].append([round(pk, 3), 'sst', label, f"à {round(d)} m de la ligne", lon, lat])
print('sous-stations rattachées', n_sst)

# ---------- Points SNCF ----------
KIND_LAYER = {'gare': 'gares', 'pn': 'pn'}
for p in json.load(open(BUILD / 'points_sncf.json')):
    lon, lat = p['xy']
    props = {'n': p['label'], 'pk': fmt_pk(p['pk']), 'c': p['code']}
    if p['kind'] == 'gare':
        props['k'] = 'V' if 'Voyageurs' in p.get('detail', '') else 'F'
    else:
        props['k'] = p['kind']
    if p.get('detail'):
        props['d'] = p['detail']
    tile_layers[KIND_LAYER.get(p['kind'], 'ouvrages')].append(feat('Point', [lon, lat], props))
    if p['pk'] is not None:
        line_points[p['code']].append([round(p['pk'], 3), p['kind'], p['label'], p.get('detail', ''), lon, lat])

# Quais
for qd in json.load(open(BUILD / 'quais.json')):
    label = (qd['label'] or 'Quai').strip()
    tile_layers['quais'].append(feat('LineString', qd['coords'], {'n': label, 'g': qd['gare'] or ''}))
    if qd['pkd'] is not None:
        mid = qd['coords'][len(qd['coords']) // 2]
        detail = ' · '.join(x for x in (qd['gare'], f"{float(qd['longueur']):.0f} m" if qd['longueur'] else None) if x)
        line_points[qd['code']].append([round(min(qd['pkd'], qd['pkf'] or qd['pkd']), 3), 'quai', label, detail, mid[0], mid[1],
                                        round(max(qd['pkd'], qd['pkf'] or qd['pkd']), 3)])

# ---------- Sections ----------
sections = json.load(open(BUILD / 'sections.json'))
ELEC_SHORT = {'25000 volts alternatif': '25 kV', '1500 volts continu': '1500 V', '15000 volts 16 2/3 alternatif': '15 kV',
              '750 Volts continu': '750 V', '3000 volts continu': '3000 V', '800 volts continu par 3ème rail': '800 V 3e rail',
              '850 volts continu par 3ème rail': '850 V 3e rail'}
line_sections = defaultdict(lambda: defaultdict(list))
for kind, items in sections.items():
    for s in items:
        if s['pkd'] is None or s['pkf'] is None:
            continue
        val = s['value']
        if kind == 'elec':
            val = ELEC_SHORT.get(val, val)
        if kind == 'ecart':
            val = 'Voie étroite (1000 mm)' if 'étroite' in val else ('LGV · 1435 mm' if 'grande vitesse' in val else 'Voie normale (1435 mm)')
        lo, hi = sorted((s['pkd'], s['pkf']))
        line_sections[s['code']][kind].append([round(lo, 3), round(hi, 3), val])
        if kind == 'vmax' and s['coords']:
            tile_layers['vitesse'].append(feat('LineString', s['coords'], {'v': int(val) if str(val).isdigit() else 0}))
        if kind == 'elec' and s['coords']:
            tile_layers['elec'].append(feat('LineString', s['coords'], {'e': val}))

# ---------- Lignes et bornes calculées (carte) ----------
for t in lines:
    tile_layers['lignes'].append(feat('LineString', [[v[0], v[1]] for v in t['verts']],
                                      {'c': t['code'], 's': STATUT_SHORT.get(t['statut'], 'E')}))
for m in json.load(open(BUILD / 'pk_marks.json')):
    layer = 'pk_km' if m['km'] else 'pk_hm'
    label = f"{int(round(m['pk']))}" if m['km'] else fmt_pk(m['pk'])
    tile_layers[layer].append(feat('Point', m['xy'], {'p': label, 'c': m['code']}))

voies = json.load(open(BUILD / 'voies.json'))
for v in voies:
    tile_layers['voies'].append(feat('LineString', v['coords'], {'n': v['nom'] or '', 't': v['type'] or ''}))

for name, feats in tile_layers.items():
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(TSRC / f'{name}.json', 'w'))
print('couches carte', {k: len(v) for k, v in tile_layers.items()})

# ---------- Fiches de ligne ----------
def encode_verts(verts):
    """Géométrie d'un tronçon avec PK : lon et lat en 1e-5 degré, PK en mètres, en différences."""
    out, prev = [], (0, 0, 0)
    for lon, lat, pk in verts:
        v = (round(lon * 1e5), round(lat * 1e5), round(pk * 1000))
        out += [v[0] - prev[0], v[1] - prev[1], v[2] - prev[2]]
        prev = v
    return out


by_code = defaultdict(list)
for t in lines:
    by_code[t['code']].append(t)
line_index = {}
for code, ts in by_code.items():
    pts = sorted(line_points.get(code, []), key=lambda r: r[0])
    for r in pts:
        r[4], r[5] = round(r[4], 5), round(r[5], 5)
    secs = {k: sorted(v) for k, v in line_sections.get(code, {}).items()}
    lo = min(min(t['pkd'], t['pkf']) for t in ts)
    hi = max(max(t['pkd'], t['pkf']) for t in ts)
    doc = {'code': code, 'name': names.get(code), 'pk': [lo, hi],
           'troncons': [{'rg': t['rg'], 'pkd': t['pkd'], 'pkf': t['pkf'], 'statut': t['statut'],
                         'g': encode_verts(t['verts'])} for t in ts],
           'sections': secs, 'points': pts}
    json.dump(doc, open(DATA / 'lines' / f'{code}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    line_index[code] = {'n': names.get(code), 'pk': [round(lo, 3), round(hi, 3)]}

# ---------- Cases de localisation ----------
def cell_of(lon, lat):
    return f"{math.floor(lon * CELL)}_{math.floor(lat * CELL)}"


MARGIN = 0.0015  # ~120 m : une recherche près d'un bord trouve la case voisine


def cells_for_segment(a, b):
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = sorted((a[1], b[1]))
    out = set()
    for cx in range(math.floor((x0 - MARGIN) * CELL), math.floor((x1 + MARGIN) * CELL) + 1):
        for cy in range(math.floor((y0 - MARGIN) * CELL), math.floor((y1 + MARGIN) * CELL) + 1):
            out.add(f"{cx}_{cy}")
    return out


cells = defaultdict(lambda: {'l': {}, 'v': {}})


def add_runs(store_key, key, meta_row, verts, with_pk):
    """Découpe une polyligne en morceaux par case (sommets en entiers : 1e-5 degré, PK en mètres)."""
    last = {}
    for i in range(len(verts) - 1):
        a, b = verts[i], verts[i + 1]
        for c in cells_for_segment(a, b):
            runs = cells[c][store_key].setdefault(key, [meta_row, []])[1]
            if last.get(c) == i and runs:
                cur = runs[-1]
            else:
                cur = []
                runs.append(cur)
                cur.extend(enc(a, with_pk))
            cur.extend(enc(b, with_pk))
            last[c] = i + 1


def enc(v, with_pk):
    out = [round(v[0] * 1e5), round(v[1] * 1e5)]
    if with_pk:
        out.append(round(v[2] * 1000))
    return out


for i, t in enumerate(lines):
    add_runs('l', f"{t['code']}|{t['rg']}|{i}", [t['code'], t['rg'], STATUT_SHORT.get(t['statut'], 'E')], t['verts'], True)
for j, v in enumerate(voies):
    if (v['type'] or '') == 'VS' and not v['nom']:
        continue
    add_runs('v', f"{v['code']}|{j}", [v['code'], v['nom'] or '', v['type'] or ''], v['coords'], False)

cell_sizes = {}
for c, content in cells.items():
    doc = {'l': [[*m, runs] for m, runs in content['l'].values()], 'v': [[*m, runs] for m, runs in content['v'].values()]}
    s = json.dumps(doc, separators=(',', ':'))
    (DATA / 'cells' / f'{c}.json').write_text(s)
    cell_sizes[c] = len(s)

manifest = {
    'version': time.strftime('%Y-%m-%d'),
    'cellsPerDegree': CELL,
    'cells': sorted(cell_sizes),
    'lines': line_index,
    # Contrôle sur des bornes OSM mises de côté (run.sh : passage RR_CONTROLE), sinon comparaison simple.
    'quality': {'pk_recalage': meta['report'], 'reperes': meta['anchors'],
                'controle_bornes_osm': json.load(open(BUILD / 'controle_osm.json')) if (BUILD / 'controle_osm.json').exists() else milestone_check},
    'sources': [
        {'name': 'SNCF Réseau – lignes, voies, gares, PN, ouvrages, quais, vitesses, électrification, cantonnement, KVB, écartement',
         'license': 'Licence ouverte SNCF / ODbL', 'url': 'https://ressources.data.sncf.com/'},
        {'name': 'OpenStreetMap – signaux, pancartes, bornes, tunnels, sous-stations', 'license': 'ODbL © contributeurs OpenStreetMap',
         'url': 'https://www.openstreetmap.org/copyright', 'date': osm.get('source_timestamp')},
    ],
}
json.dump(manifest, open(DATA / 'manifest.json', 'w'), ensure_ascii=False, separators=(',', ':'))
tot = sum(cell_sizes.values())
print(f"cases {len(cell_sizes)} ({tot / 1e6:.1f} Mo, max {max(cell_sizes.values()) / 1e3:.0f} Ko), lignes {len(line_index)}")
