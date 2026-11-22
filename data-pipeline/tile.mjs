// Génère les tuiles vectorielles (MVT) de toutes les couches, parcours en profondeur.
// Sortie : fichier binaire d'enregistrements [z:u8][x:u32][y:u32][len:u32][pbf].
// Usage : node --max-old-space-size=6000 tile.mjs <tiles-src> <sortie.bin>
import fs from 'node:fs';
import path from 'node:path';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const [src, outFile] = process.argv.slice(2);
const MAXZ = 14;
// [couche, zoom mini, tolérance de simplification]
const LAYERS = [
  ['lignes', 4, 2], ['vitesse', 6, 3], ['elec', 6, 3], ['tunnels', 9, 2], ['sst', 9, 0],
  ['gares', 8, 0], ['pk_km', 10, 0], ['pn', 11, 0], ['ouvrages', 12, 0], ['signaux', 12, 0],
  ['voies', 12, 1], ['quais', 13, 1], ['pk_hm', 13, 0], ['bornes', 13, 0],
];

const idx = LAYERS.map(([name, minz, tol]) => {
  const fc = JSON.parse(fs.readFileSync(path.join(src, `${name}.json`), 'utf8'));
  const t0 = Date.now();
  const index = geojsonvt(fc, { maxZoom: MAXZ, indexMaxZoom: 4, indexMaxPoints: 100000, tolerance: tol, extent: 4096, buffer: 64 });
  console.error(`${name}: ${fc.features.length} objets indexés en ${Date.now() - t0} ms`);
  return { name, minz, index };
});

const out = fs.openSync(outFile, 'w');
let count = 0;
let bytes = 0;
const toID = (z, x, y) => ((1 << z) * y + x) * 32 + z;

function visit(z, x, y) {
  const parts = {};
  let any = false;
  let include = false;
  for (const { name, minz, index } of idx) {
    const t = index.getTile(z, x, y);
    if (t && t.features.length) {
      any = true;
      if (z >= minz) {
        parts[name] = t;
        include = true;
      }
    }
  }
  if (!any) return;
  if (include) {
    const buf = vtpbf.fromGeojsonVt(parts, { version: 2, extent: 4096 });
    const head = Buffer.alloc(13);
    head.writeUInt8(z, 0);
    head.writeUInt32LE(x, 1);
    head.writeUInt32LE(y, 5);
    head.writeUInt32LE(buf.length, 9);
    fs.writeSync(out, head);
    fs.writeSync(out, buf);
    count++;
    bytes += buf.length;
  }
  if (z < MAXZ) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(z + 1, x * 2 + dx, y * 2 + dy);
  }
  // Libère la mémoire des tuiles déjà traitées.
  if (z > 4) for (const { index } of idx) delete index.tiles[toID(z, x, y)];
}

const t0 = Date.now();
visit(0, 0, 0);
fs.closeSync(out);
console.error(`${count} tuiles, ${(bytes / 1e6).toFixed(1)} Mo (non compressé), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
