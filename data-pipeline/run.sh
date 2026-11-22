#!/bin/bash
# Régénère toutes les données de l'appli (environ 15 min, 8 Go de disque, 6 Go de mémoire).
# Prérequis : Python 3.11+, Node 20+, curl.
set -euo pipefail
cd "$(dirname "$0")"
APP_DATA=../app/public/data
pip install --quiet pyproj shapely osmium pmtiles
npm install --silent

# 1. Données SNCF Réseau (open data)
./download_sncf.sh

# 2. OpenStreetMap France (~6 Go) — miroir OSM France
mkdir -p raw
curl -L -C - -o raw/france.osm.pbf https://download.openstreetmap.fr/extracts/europe/france.osm.pbf

# 3. Traitements
python3 extract_osm.py raw/france.osm.pbf build/osm.json   # signaux, bornes, tunnels, sous-stations
# Recalage des PK sur les repères SNCF et les bornes OSM : un passage de contrôle (1 borne sur 5 mise de côté)
# mesure la précision, puis le passage définitif utilise toutes les bornes.
RR_CONTROLE=1 python3 build_sncf.py raw/sncf build-controle build/osm.json
cp build-controle/controle_osm.json build/
python3 build_sncf.py raw/sncf build build/osm.json
python3 build_products.py build "$APP_DATA" tiles-src      # cases, fiches de ligne, couches
node --max-old-space-size=6000 tile.mjs tiles-src build/tiles.bin
python3 pack_pmtiles.py build/tiles.bin "$APP_DATA/rail.pmtiles"
python3 - <<'PY'
import json
pts = json.load(open('build/points_sncf.json'))
g = [[p['label'], round(p['xy'][0], 5), round(p['xy'][1], 5), p['code'], p['pk']] for p in pts if p['kind'] == 'gare' and p['label']]
json.dump(g, open('../app/public/data/gares.json', 'w'), ensure_ascii=False, separators=(',', ':'))
PY
echo "Données à jour dans app/public/data"
