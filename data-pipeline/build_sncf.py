"""
Prépare les données SNCF Réseau pour l'appli de repérage.

1. Lignes (tronçons) en Lambert-93, orientées du PK début vers le PK fin.
2. Recalage des PK : points de repère SNCF (PN, gares, ponts, quais, extrémités
   de voies et de sections) projetés sur leur tronçon ; on garde une suite
   monotone ; le PK de chaque sommet est interpolé entre repères.
3. Validation : chaque repère est masqué à tour de rôle et son PK recalculé.
4. Sorties dans build/ : JSON intermédiaires utilisés par les étapes suivantes.

Usage : python3 -I build_sncf.py <dossier raw/sncf> <dossier build>
"""
import json
import math
import os
import re
import sys
from bisect import bisect_left
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point

RAW = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform

PK_RE = re.compile(r'^\s*(-?\d+)\s*([+-])\s*(\d+)\s*$')


def parse_pk(s):
    """'019+663' → 19.663 ; '000-771' → -0.771 (en km)."""
    if s is None:
        return None
    m = PK_RE.match(str(s))
    if not m:
        try:
            return float(str(s).replace(',', '.'))
        except ValueError:
            return None
    km, sep, mm = int(m.group(1)), m.group(2), int(m.group(3))
    return km + mm / 1000 if sep == '+' else km - mm / 1000


def fmt_pk(pk):
    """19.663 → '19+663'."""
    sign = '-' if pk < 0 else ''
    m = round(abs(pk) * 1000)
    return f"{sign}{m // 1000}+{m % 1000:03d}"


def load(name):
    return json.load(open(RAW / f'{name}.geojson'))['features']


def pt(props, xk='x_wgs84', yk='y_wgs84'):
    try:
        return float(props[xk]), float(props[yk])
    except (KeyError, TypeError, ValueError):
        return None


# ---------- 1. Tronçons ----------
lines_raw = load('formes-des-lignes-du-rfn')
statut_raw = load('lignes-par-statut')

# Noms de lignes (le fichier des formes n'en a pas).
names = {}
for f in load('mode-de-cantonnement-des-lignes'):
    p = f['properties']
    n = p.get('ligne_libelle') or p.get('lib_ligne')
    if n and not n.isdigit():
        names[p['code_ligne']] = n
for f in load('liste-des-traversees-de-voie-par-le-public'):
    p = f['properties']
    if p.get('lib_ligne') and p['code_ligne'] not in names:
        names[p['code_ligne']] = p['lib_ligne']

# Point du PK début de chaque tronçon (le jeu « statut » donne ses coordonnées).
start_pt = {}
for f in statut_raw:
    p = f['properties']
    c = pt(p, 'x_d_wgs84', 'y_d_wgs84')
    if c:
        start_pt[(p['code_ligne'], p['rg_troncon'], p['pkd'], p['pkf'])] = to_l93(*c)

STATUS_LABEL = {
    'EXPLOITE': 'Exploitée', 'S9A3': 'Exploitée (S9A3)', 'VS': 'Voie de service',
    'NEUT': 'Neutralisée', 'NEUT DEF': 'Neutralisée', 'FERME': 'Fermée', 'FERME ND': 'Fermée',
    'FERME D': 'Fermée', 'FERME MV': 'Fermée', 'FERME DT': 'Fermée',
    'DEC V': 'Déclassée', 'DEC NV': 'Déclassée', 'RETRANCHE': 'Retranchée',
}

troncons = {}  # (code, rg, pkd, pkf) -> dict
skipped_no_pk = 0
for f in lines_raw:
    p = f['properties']
    # Un tronçon peut être découpé en morceaux de statuts différents : la clé inclut les PK.
    key = (p['code_ligne'], p['rg_troncon'], p['pk_debut_r'], p['pk_fin_r'])
    coords = [to_l93(x, y) for x, y in f['geometry']['coordinates']]
    pkd, pkf = parse_pk(p['pk_debut_r']), parse_pk(p['pk_fin_r'])
    if len(coords) < 2 or pkd is None or pkf is None:
        skipped_no_pk += 1
        continue
    geom = LineString(coords)
    # Orientation : le début de la géométrie doit être au PK début.
    sp = start_pt.get(key)
    if sp is not None:
        a = geom.project(Point(sp))
        if a > geom.length / 2:
            geom = LineString(coords[::-1])
    troncons[key] = {
        'code': p['code_ligne'], 'rg': p['rg_troncon'], 'pkd': pkd, 'pkf': pkf,
        'geom': geom, 'mnemo': p['mnemo'], 'oriented': sp is not None, 'anchors': [],
    }
by_code = defaultdict(list)
for t in troncons.values():
    by_code[t['code']].append(t)
print(f"tronçons {len(troncons)}, lignes {len(by_code)}, orientés {sum(t['oriented'] for t in troncons.values())}, sans PK {skipped_no_pk}")

# ---------- 2. Repères ----------
anchor_count = defaultdict(int)


def add_anchor(code, rg, pk, xy, source):
    if pk is None or xy is None:
        return
    cands = by_code.get(code, [])
    best = None
    p = Point(xy)
    for t in cands:
        lo, hi = sorted((t['pkd'], t['pkf']))
        if not (lo - 0.05 <= pk <= hi + 0.05):
            continue
        d = t['geom'].distance(p) + (0 if rg is None or t['rg'] == rg else 5)
        if d <= 80 and (best is None or d < best[0]):
            best = (d, t)
    if best:
        t = best[1]
        t['anchors'].append((t['geom'].project(p), pk, source))
        anchor_count[source] += 1


POINT_SETS = {
    'pn': 'liste-des-passages-a-niveau', 'gare': 'liste-des-gares', 'pont': 'liste-des-ponts-route',
    'passerelle': 'liste-des-passerelles', 'souterrain': 'liste-des-passages-souterrains',
    'traversee': 'liste-des-traversees-de-voie-par-le-public',
}
points_raw = {k: load(v) for k, v in POINT_SETS.items()}
for kind, feats in points_raw.items():
    for f in feats:
        p = f['properties']
        c = pt(p)
        if c:
            add_anchor(p['code_ligne'], p.get('rg_troncon'), parse_pk(p.get('pk')), to_l93(*c), kind)

SECTION_SETS = {
    'vmax': 'vitesse-maximale-nominale-sur-ligne', 'elec': 'liste-des-lignes-electrifiees',
    'cant': 'mode-de-cantonnement-des-lignes', 'kvb': 'lignes-equipees-de-kvb',
    'ecart': 'lignes-lgv-et-par-ecartement',
}
sections_raw = {k: load(v) for k, v in SECTION_SETS.items()}
for kind, feats in sections_raw.items():
    for f in feats:
        p = f['properties']
        for end, xk, yk in (('pkd', 'x_d_wgs84', 'y_d_wgs84'), ('pkf', 'x_f_wgs84', 'y_f_wgs84')):
            c = pt(p, xk, yk)
            if c:
                add_anchor(p['code_ligne'], p.get('rg_troncon'), parse_pk(p.get(end)), to_l93(*c), 'section')

voies_raw = load('fichier-de-formes-des-voies-du-reseau-ferre-national')
for f in voies_raw:
    p = f['properties']
    for end, xk, yk in (('pk_debut_r', 'x_d_wgs84', 'y_d_wgs84'), ('pk_fin_r', 'x_f_wgs84', 'y_f_wgs84')):
        c = pt(p, xk, yk)
        if c and p.get('type_voie') in ('VPL', 'VPA'):
            add_anchor(p['code_ligne'], p.get('rg_troncon'), parse_pk(p.get(end)), to_l93(*c), 'voie')
print('repères', dict(anchor_count))


# ---------- 3. Chaîne monotone et interpolation ----------
def lis(values):
    """Indices d'une plus longue sous-suite croissante (au sens large)."""
    tails, tails_idx, prev = [], [], [-1] * len(values)
    for i, v in enumerate(values):
        j = bisect_left(tails, v + 1e-9)
        if j == len(tails):
            tails.append(v); tails_idx.append(i)
        else:
            tails[j] = v; tails_idx[j] = i
        prev[i] = tails_idx[j - 1] if j > 0 else -1
    out, k = [], tails_idx[-1] if tails_idx else -1
    while k >= 0:
        out.append(k); k = prev[k]
    return out[::-1]


def build_chain(t, exclude=None):
    """Liste (abscisse, pk) monotone pour le tronçon."""
    L = t['geom'].length
    sign = 1 if t['pkf'] >= t['pkd'] else -1
    pts = [(0.0, t['pkd']), (L, t['pkf'])]
    pts += [(a, pk) for i, (a, pk, _) in enumerate(t['anchors']) if i != exclude]
    pts.sort()
    keep = lis([sign * pk for _, pk in pts])
    chain = [pts[i] for i in keep]
    # Repères quasi confondus : on garde le premier.
    out = []
    for a, pk in chain:
        if out and a - out[-1][0] < 1.0:
            continue
        out.append((a, pk))
    return out, sign


def pk_at(chain, sign, a):
    if len(chain) == 1:
        return chain[0][1] + sign * (a - chain[0][0]) / 1000
    xs = [c[0] for c in chain]
    i = bisect_left(xs, a)
    if i == 0:
        a0, p0 = chain[0]
        return p0 - sign * (a0 - a) / 1000
    if i >= len(chain):
        a0, p0 = chain[-1]
        return p0 + sign * (a - a0) / 1000
    (a0, p0), (a1, p1) = chain[i - 1], chain[i]
    return p0 + (p1 - p0) * (a - a0) / (a1 - a0) if a1 > a0 else p0


# ---------- 3 bis. Bornes kilométriques relevées dans OpenStreetMap ----------
# Facultatif (3e argument : osm.json produit par extract_osm.py). Une borne devient un repère si elle est
# à moins de 25 m d'un tronçon couvrant son PK et si elle s'écarte de moins de 300 m du PK estimé avec les
# seuls repères SNCF (au-delà : autre système de PK sur le terrain, ou borne mal placée dans OSM).
# RR_CONTROLE=1 : une borne sur cinq est mise de côté pour mesurer le gain (sinon toutes servent).
osm_controle = []
if len(sys.argv) > 3 and Path(sys.argv[3]).exists():
    from shapely.strtree import STRtree
    tr_list = list(troncons.values())
    tree = STRtree([t['geom'] for t in tr_list])
    base = {id(t): build_chain(t) for t in tr_list}
    kept = rejected = 0
    for m in json.load(open(sys.argv[3]))['milestones']:
        try:
            pos = float(str(m['pos']).replace(',', '.').split(';')[0])
        except ValueError:
            continue
        p = Point(to_l93(*m['xy']))
        best = None
        for i in tree.query(p.buffer(25)):
            t = tr_list[i]
            lo, hi = sorted((t['pkd'], t['pkf']))
            if not (lo - 0.3 <= pos <= hi + 0.3):
                continue
            d = t['geom'].distance(p)
            if d <= 25 and (best is None or d < best[0]):
                best = (d, t)
        if not best:
            continue
        t = best[1]
        a = t['geom'].project(p)
        chain, sign = base[id(t)]
        est = pk_at(chain, sign, a)
        if abs(est - pos) > 0.3:
            rejected += 1
            continue
        if os.environ.get('RR_CONTROLE') and m['id'] % 5 == 0:
            osm_controle.append((t, a, pos, est))
            continue
        t['anchors'].append((a, pos, 'borne'))
        anchor_count['borne'] += 1
        kept += 1
    print(f'bornes OSM : {kept} repères ajoutés, {len(osm_controle)} mises de côté pour le contrôle, {rejected} écartées (> 300 m)')

# Validation : on masque chaque repère intérieur et on recalcule son PK.
errors_full, errors_naive = [], []
for t in troncons.values():
    n = len(t['anchors'])
    if n == 0:
        continue
    for i in range(0, n, max(1, n // 40)):  # échantillon par tronçon
        a, pk, src = t['anchors'][i]
        if src not in ('pn', 'gare', 'pont'):
            continue
        chain, sign = build_chain(t, exclude=i)
        errors_full.append(abs(pk_at(chain, sign, a) - pk) * 1000)
        naive = [(0.0, t['pkd']), (t['geom'].length, t['pkf'])]
        errors_naive.append(abs(pk_at(naive, sign, a) - pk) * 1000)


def pct(v, q):
    v = sorted(v)
    return v[min(len(v) - 1, int(q * len(v)))] if v else float('nan')


report = {
    'validation_points': len(errors_full),
    'erreur_mediane_m': round(pct(errors_full, 0.5), 1),
    'erreur_p90_m': round(pct(errors_full, 0.9), 1),
    'erreur_p99_m': round(pct(errors_full, 0.99), 1),
    'sans_recalage_mediane_m': round(pct(errors_naive, 0.5), 1),
    'sans_recalage_p90_m': round(pct(errors_naive, 0.9), 1),
}
print('validation PK', report)

# ---------- 4. Sorties ----------
def wgs(xy, nd=6):
    x, y = to_wgs(*xy)
    return [round(x, nd), round(y, nd)]


lines_out = []
for t in troncons.values():
    chain, sign = build_chain(t)
    t['chain'], t['sign'] = chain, sign
    g = t['geom']
    coords = list(g.coords)
    acc, verts = 0.0, []
    for i, c in enumerate(coords):
        if i:
            acc += math.dist(coords[i - 1], c)
        verts.append(wgs(c) + [round(pk_at(chain, sign, acc), 4)])
    lines_out.append({
        'code': t['code'], 'rg': t['rg'], 'pkd': t['pkd'], 'pkf': t['pkf'],
        'statut': STATUS_LABEL.get(t['mnemo'], t['mnemo']), 'mnemo': t['mnemo'],
        'name': names.get(t['code']), 'anchors': len(chain) - 2, 'verts': verts,
    })
json.dump(lines_out, open(OUT / 'lines.json', 'w'))

if osm_controle:
    before = [abs(est - pos) * 1000 for _, _, pos, est in osm_controle]
    after = [abs(pk_at(t['chain'], t['sign'], a) - pos) * 1000 for t, a, pos, _ in osm_controle]
    report['controle_bornes_osm'] = {
        'bornes': len(after),
        'avant_mediane_m': round(pct(before, 0.5), 1), 'avant_p90_m': round(pct(before, 0.9), 1),
        'apres_mediane_m': round(pct(after, 0.5), 1), 'apres_p90_m': round(pct(after, 0.9), 1),
        'apres_p95_m': round(pct(after, 0.95), 1),
    }
    print('contrôle sur bornes OSM non utilisées', report['controle_bornes_osm'])
    json.dump(report['controle_bornes_osm'], open(OUT / 'controle_osm.json', 'w'))

# Bornes PK calculées tous les 100 m (les km entiers sont signalés).
pk_marks = []
for t in troncons.values():
    if t['mnemo'] in ('DEC V', 'DEC NV', 'RETRANCHE'):
        continue
    chain, sign = t['chain'], t['sign']
    g = t['geom']
    L = g.length
    lo, hi = sorted((t['pkd'], t['pkf']))
    k = math.ceil(lo * 10 - 1e-9)
    # On cherche l'abscisse de chaque PK rond par dichotomie (pk monotone en abscisse).
    while k / 10 <= hi + 1e-9:
        target = k / 10
        a0, a1 = 0.0, L
        for _ in range(40):
            m = (a0 + a1) / 2
            if sign * (pk_at(chain, sign, m) - target) < 0:
                a0 = m
            else:
                a1 = m
        p = g.interpolate((a0 + a1) / 2)
        pk_marks.append({'code': t['code'], 'pk': round(target, 1), 'km': k % 10 == 0, 'xy': wgs((p.x, p.y))})
        k += 1
json.dump(pk_marks, open(OUT / 'pk_marks.json', 'w'))
print('bornes PK calculées', len(pk_marks))

# Points SNCF avec PK, pour la carte et les fiches de ligne.
points_out = []
labels = {'pn': 'PN', 'gare': 'Gare', 'pont': 'Pont-route', 'passerelle': 'Passerelle',
          'souterrain': 'Passage souterrain', 'traversee': 'Traversée de voie'}
for kind, feats in points_raw.items():
    for f in feats:
        p = f['properties']
        c = pt(p)
        if not c:
            continue
        rec = {'kind': kind, 'code': p['code_ligne'], 'pk': parse_pk(p.get('pk')), 'xy': [round(c[0], 6), round(c[1], 6)]}
        if kind == 'pn':
            rec['label'] = p.get('libelle') or 'PN'
            rec['detail'] = ' · '.join(x for x in (p.get('mnemo', '').title(), p.get('obstacle'), p.get('saco_libelle_commune')) if x)
        elif kind == 'gare':
            rec['label'] = p.get('libelle')
            rec['detail'] = ' · '.join(x for x in (('Voyageurs' if p.get('voyageurs') == 'O' else None), ('Fret' if p.get('fret') == 'O' else None), (p.get('commune') or '').title()) if x)
            rec['uic'] = p.get('code_uic')
        elif kind == 'pont':
            rec['label'] = f"Pont-route {p.get('libelle') or ''}".strip()
            rec['detail'] = p.get('obstacle') or ''
        else:
            rec['label'] = p.get('libelle') or labels[kind]
            rec['detail'] = ' · '.join(x for x in (p.get('obstacle'), p.get('lib_gare')) if x)
        points_out.append(rec)
json.dump(points_out, open(OUT / 'points_sncf.json', 'w'))
print('points SNCF', len(points_out))

# Sections par PK (vitesse, électrification, cantonnement, KVB, écartement) + géométries.
sections_out = defaultdict(list)
for kind, feats in sections_raw.items():
    for f in feats:
        p = f['properties']
        val = {'vmax': p.get('v_max'), 'elec': p.get('elect'), 'cant': p.get('libelle'), 'kvb': 'KVB',
               'ecart': p.get('catlig')}[kind]
        g = f['geometry']
        coords = g['coordinates'] if g and g['type'] == 'LineString' else []
        sections_out[kind].append({
            'code': p['code_ligne'], 'pkd': parse_pk(p.get('pkd')), 'pkf': parse_pk(p.get('pkf')), 'value': val,
            'coords': [[round(x, 5), round(y, 5)] for x, y in coords],
        })
json.dump(sections_out, open(OUT / 'sections.json', 'w'))

# Voies nommées (simplifiées à 0,5 m) et quais.
voies_out = []
nv = 0
for f in voies_raw:
    p = f['properties']
    g = LineString([to_l93(x, y) for x, y in f['geometry']['coordinates']]).simplify(0.5)
    nv += len(g.coords)
    voies_out.append({'code': p['code_ligne'], 'nom': p.get('nom_voie'), 'type': p.get('type_voie'),
                      'pkd': parse_pk(p.get('pk_debut_r')), 'pkf': parse_pk(p.get('pk_fin_r')),
                      'coords': [wgs(c) for c in g.coords]})
json.dump(voies_out, open(OUT / 'voies.json', 'w'))
print('voies', len(voies_out), 'sommets après simplification', nv)

quais_out = []
for f in load('liste-des-quais'):
    p = f['properties']
    g = f['geometry']
    parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    for part in parts:
        quais_out.append({'code': p['code_ligne'], 'label': p.get('libelle'), 'gare': p.get('lib_gare'),
                          'longueur': p.get('longueur'), 'voie': p.get('code_voie'),
                          'pkd': parse_pk(p.get('pkd')), 'pkf': parse_pk(p.get('pkf')),
                          'coords': [[round(x, 6), round(y, 6)] for x, y in part]})
json.dump(quais_out, open(OUT / 'quais.json', 'w'))
json.dump({'names': names, 'report': report, 'anchors': dict(anchor_count)}, open(OUT / 'meta_sncf.json', 'w'), ensure_ascii=False)
print('quais', len(quais_out))
