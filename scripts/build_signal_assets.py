"""
Planche d'icônes des signaux pour la carte, à partir de la bibliothèque
nicolaswurtz/signalisation-rfn-svg (GPL-3.0), réduite aux dessins utilisés par les données.

Usage : python3 -I scripts/build_signal_assets.py <dossier signalisation-rfn-svg> <signal_icons.json> <app/public>
Produit, dans <app/public>/signaux/ :
  rfn.json, rfn.png, rfn@2x.json, rfn@2x.png   planche MapLibre (images « rfn:<NOM> »)
  fiche/<nom>.png                               dessin en grand pour la fiche d'un signal
  LICENSE.txt                                   licence GPL-3.0 de la bibliothèque
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

SRC, USED, PUBLIC = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
OUT = PUBLIC / 'signaux'
(OUT / 'fiche').mkdir(parents=True, exist_ok=True)
for old in (OUT / 'fiche').glob('*.png'):
    old.unlink()
names = json.load(open(USED))


def slug(name: str) -> str:
    """Même règle que l'appli (lib/signaux.ts)."""
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


assert len({slug(n) for n in names}) == len(names), 'deux dessins auraient le même fichier'


def pack(ratio: int, suffix: str):
    meta = json.load(open(SRC / 'sprites' / f'sprites{suffix}.json'))
    sheet = Image.open(SRC / 'sprites' / f'sprites{suffix}.png').convert('RGBA')
    crops = [(n, sheet.crop((meta[n]['x'], meta[n]['y'], meta[n]['x'] + meta[n]['width'], meta[n]['y'] + meta[n]['height']))) for n in names]
    # Rangées successives (les images font 64 ou 128 de côté à l'échelle 1).
    width = 16 * 64 * ratio
    x = y = row_h = 0
    places = {}
    for n, im in sorted(crops, key=lambda c: -c[1].height):
        if x + im.width > width:
            x, y, row_h = 0, y + row_h, 0
        places[n] = (x, y, im)
        x += im.width
        row_h = max(row_h, im.height)
    out = Image.new('RGBA', (width, y + row_h), (0, 0, 0, 0))
    index = {}
    for n, (px, py, im) in places.items():
        out.paste(im, (px, py))
        index[n] = {'x': px, 'y': py, 'width': im.width, 'height': im.height, 'pixelRatio': ratio}
    out.save(OUT / f'rfn{suffix}.png', optimize=True)
    json.dump(index, open(OUT / f'rfn{suffix}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    return crops


pack(1, '')
pack(2, '@2x')
# Dessins de la fiche et des listes : échelle 3, recadrés, hauteur limitée à 240 px.
for n, im in pack(3, '@3x'):
    # Recadré sur le dessin (les planches laissent de la marge transparente autour des petits signaux).
    box = im.getchannel('A').getbbox()
    if box:
        pad = 6
        im = im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width), min(box[3] + pad, im.height)))
    if im.height > 240:
        im = im.resize((round(im.width * 240 / im.height), 240), Image.LANCZOS)
    im.save(OUT / 'fiche' / f'{slug(n)}.png', optimize=True)
(OUT / 'rfn@3x.png').unlink()
(OUT / 'rfn@3x.json').unlink()
shutil.copy(SRC / 'LICENSE', OUT / 'LICENSE.txt')
print(f'{len(names)} dessins → {OUT}')
