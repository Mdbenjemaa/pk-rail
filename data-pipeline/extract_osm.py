"""
Extrait d'OpenStreetMap (fichier France) les éléments ferroviaires absents des
données SNCF : signaux, pancartes de vitesse, bornes PK, tunnels, sous-stations.

Usage : python3 -I extract_osm.py <france.osm.pbf> <build/osm.json>
"""
import json
import sys
import time

import osmium

SRC, OUT = sys.argv[1], sys.argv[2]
t0 = time.time()

signals, milestones, sub_nodes = [], [], []
tunnel_ways, sub_ways = [], []
need = set()

RAIL_WAYS = {'rail', 'light_rail', 'narrow_gauge', 'subway', 'disused', 'construction'}

fp = osmium.FileProcessor(SRC).with_filter(osmium.filter.KeyFilter('railway', 'power'))
for o in fp:
    tags = dict(o.tags)
    if o.is_node():
        loc = o.location
        if not loc.valid():
            continue
        xy = [round(loc.lon, 6), round(loc.lat, 6)]
        rw = tags.get('railway')
        if rw == 'signal':
            keep = {k: v for k, v in tags.items() if k.startswith('railway:signal') or k in ('ref', 'name', 'railway:position')}
            signals.append({'id': o.id, 'xy': xy, 'tags': keep})
        elif rw == 'milestone':
            pos = tags.get('railway:position') or tags.get('railway:position:exact') or tags.get('pk') or tags.get('ref')
            milestones.append({'id': o.id, 'xy': xy, 'pos': pos})
        elif tags.get('power') == 'substation' and (tags.get('substation') == 'traction' or tags.get('railway') == 'substation'):
            sub_nodes.append({'id': o.id, 'xy': xy, 'name': tags.get('name') or tags.get('ref'), 'operator': tags.get('operator')})
    elif o.is_way():
        rw = tags.get('railway')
        if rw in RAIL_WAYS and tags.get('tunnel') in ('yes', 'building_passage', 'culvert'):
            refs = [n.ref for n in o.nodes]
            need.update(refs)
            tunnel_ways.append({'id': o.id, 'refs': refs, 'name': tags.get('tunnel:name') or tags.get('name'),
                                'railway': rw, 'usage': tags.get('usage'), 'ref': tags.get('ref')})
        elif tags.get('power') == 'substation' and (tags.get('substation') == 'traction' or tags.get('railway') == 'substation'):
            refs = [n.ref for n in o.nodes]
            need.update(refs)
            sub_ways.append({'id': o.id, 'refs': refs, 'name': tags.get('name') or tags.get('ref'), 'operator': tags.get('operator')})

print(f'passe 1 : {time.time() - t0:.0f} s — signaux {len(signals)}, bornes {len(milestones)}, '
      f'tunnels {len(tunnel_ways)}, sous-stations {len(sub_nodes)} nœuds + {len(sub_ways)} surfaces, nœuds à localiser {len(need)}')

# Passe 2 : coordonnées des nœuds des tunnels et des sous-stations.
coords = {}
fp2 = osmium.FileProcessor(SRC, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need))
for n in fp2:
    if n.location.valid():
        coords[n.id] = (round(n.location.lon, 6), round(n.location.lat, 6))
print(f'passe 2 : {time.time() - t0:.0f} s — {len(coords)} nœuds localisés')

tunnels = []
for w in tunnel_ways:
    line = [coords[r] for r in w.pop('refs') if r in coords]
    if len(line) >= 2:
        w['coords'] = line
        tunnels.append(w)

subs = list(sub_nodes)
for w in sub_ways:
    pts = [coords[r] for r in w.pop('refs') if r in coords]
    if pts:
        w['xy'] = [round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)]
        subs.append(w)

json.dump({'signals': signals, 'milestones': milestones, 'tunnels': tunnels, 'substations': subs,
           'source_timestamp': time.strftime('%Y-%m-%d')}, open(OUT, 'w'))
print(f'fini en {time.time() - t0:.0f} s')
