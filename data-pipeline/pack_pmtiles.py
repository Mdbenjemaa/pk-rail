"""Assemble les tuiles produites par tile.mjs en un fichier PMTiles (tuiles compressées gzip)."""
import gzip
import json
import struct
import sys

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

src, dst = sys.argv[1], sys.argv[2]
tiles = []
with open(src, 'rb') as f:
    while True:
        head = f.read(13)
        if not head:
            break
        z, x, y, n = struct.unpack('<BIII', head)
        tiles.append((zxy_to_tileid(z, x, y), f.read(n)))
tiles.sort(key=lambda t: t[0])

LAYERS = ['lignes', 'vitesse', 'elec', 'tunnels', 'sst', 'gares', 'pk_km', 'pn', 'ouvrages', 'signaux', 'voies', 'quais', 'pk_hm', 'bornes']
with open(dst, 'wb') as out:
    w = Writer(out)
    for tid, data in tiles:
        w.write_tile(tid, gzip.compress(data, 6))
    w.finalize(
        {
            'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP,
            'min_zoom': 0, 'max_zoom': 14,
            'min_lon_e7': int(-5.5e7), 'min_lat_e7': int(41.2e7), 'max_lon_e7': int(10e7), 'max_lat_e7': int(51.3e7),
            'center_zoom': 5, 'center_lon_e7': int(2.4e7), 'center_lat_e7': int(46.6e7),
        },
        {
            'name': 'Repère Rail', 'format': 'pbf',
            'attribution': '© SNCF Réseau (open data) · © contributeurs OpenStreetMap',
            'vector_layers': [{'id': l, 'fields': {}} for l in LAYERS],
        },
    )
print('tuiles', len(tiles))
