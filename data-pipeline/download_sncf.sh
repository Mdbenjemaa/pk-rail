#!/bin/bash
mkdir -p raw/sncf && cd raw/sncf
for ds in formes-des-lignes-du-rfn fichier-de-formes-des-voies-du-reseau-ferre-national liste-des-gares liste-des-passages-a-niveau liste-des-quais vitesse-maximale-nominale-sur-ligne lignes-lgv-et-par-ecartement liste-des-lignes-electrifiees liste-des-ponts-route liste-des-passerelles liste-des-passages-souterrains liste-des-traversees-de-voie-par-le-public mode-de-cantonnement-des-lignes lignes-equipees-de-kvb lignes-par-statut; do
  for i in $(seq 1 12); do
    curl -sS -m 300 -o "$ds.geojson.part" "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/$ds/exports/geojson" && python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$ds.geojson.part" 2>/dev/null && mv "$ds.geojson.part" "$ds.geojson" && echo "OK $ds $(stat -c %s $ds.geojson)" && break
    echo "retry $ds $i"; sleep 4
  done
done
echo ALLDONE
