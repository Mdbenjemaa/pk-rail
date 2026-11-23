# PK Rail

Appli web pour se repérer sur le réseau ferré français depuis son téléphone : la ligne et le PK là où on se trouve,
le PK qui défile en direct quand on avance, et l'itinéraire jusqu'à un PK. Elle s'installe sur l'écran d'accueil
(iPhone et Android) et ne demande aucun compte.

Version allégée de [Repère Rail](https://github.com/Mdbenjemaa/balas), sans espace chantier, sans signalements et
sans corrections de PK.

**Adresse :** https://mdbenjemaa.github.io/pk-rail/

> Aide au repérage uniquement, jamais une référence de sécurité. PK et signaux sont calculés à partir de données
> ouvertes (SNCF Réseau, OpenStreetMap) : ils peuvent être faux, incomplets ou périmés. Vérifie toujours sur le
> terrain et dans les documents officiels.

## Fonctions

| Fonction | Ce qu'elle fait |
| --- | --- |
| Me repérer | Écoute le GPS jusqu'à 12 s, rattache la position à la ligne la plus proche et donne le PK, la vitesse, l'électrification, les signaux, PN, gares et tunnels autour. Appui long sur la carte : « me placer ici ». Si deux lignes sont proches, on choisit la sienne dans « Autres lignes ici » (toucher le PK). |
| Suivre le PK en direct | Gros compteur PK au mètre qui défile en avançant, à pied comme en véhicule (lissage du GPS, sens ▲/▼ des PK, reste sur la ligne suivie aux bifurcations). La carte reste libre et revient sur toi avec « Recentrer ». L'écran reste allumé. |
| Aller au PK | Taper un PK (champs km + m), le voir sur la carte, la distance depuis ta position, les accès proches et l'itinéraire en voiture (Google Maps). |
| Recherche | Gare, code de ligne (toutes les lignes, même sans gare : la carte montre la ligne entière), ou ligne + PK (« 830000 45+200 »), ou un PK seul sur la ligne où tu es. |
| Sans réseau | L'appli garde sur le téléphone ce qui a été consulté : les données PK sur au moins 20 km autour de chaque repérage, et les morceaux de carte des voies déjà affichés. Repérage, suivi du PK et carte des voies marchent donc sans réseau là où on est déjà passé. |
| Mes accès | Importer une carte d'accès : fichier KML/KMZ/GeoJSON ou lien Google My Maps (y compris le lien court maps.app.goo.gl du bouton Partager). Chaque accès reçoit sa ligne et son PK. Gardé uniquement sur le téléphone. |
| Couches | Signaux, PN, gares, quais, voies, tunnels, sous-stations, bornes, caractéristiques de ligne ; fond plan, photo aérienne ou aucun. |
| Signaux dessinés | Carrés, sémaphores, carrés violets, avertissements, mirlitons, TIV avec leur vitesse, pancartes Z et R, chevrons, sectionnement, REV, coupez courant, baissez panto, fin de caténaire… apparaissent sur la carte avec leur vrai dessin (bibliothèque signalisation-rfn-svg) ; en touchant un signal, sa fiche le montre en grand. Les signaux sans dessin connu restent des pastilles de couleur. |

## Développement

```bash
cd app
npm ci
npm run dev      # http://localhost:5173
npm test         # tests unitaires (calcul du PK, GPS, lissage, recherche, données gardées…)
npm run check    # tout : lint, tests unitaires, construction, puis tests dans un vrai navigateur
```

### Tests dans un navigateur

`npm run e2e` (après `npm run build`) ouvre l'appli construite dans Chrome, en téléphone simulé avec un GPS simulé
le long de la ligne 830 000 à Lieusaint, et passe sur chaque écran : premier lancement, Me repérer, suivi du PK en
marchant dans les deux sens et perte du GPS, recherche (gare, PK, ligne sans gare, récents), Aller au PK, couches,
mes accès (import KML, rattachement au PK, liste, désactivation, recherche, suppression), menu et mode nuit, GPS
refusé, appui long sur la carte, petit écran, et fonctionnement sans réseau. Internet est coupé pendant les tests.
Les tests sont dans `app/e2e/`. Chrome du système (`/usr/bin/google-chrome`) ou `CHROME_PATH`, sinon
`npx playwright install chromium`.

Les données (`app/public/data` : tuiles PMTiles, cases de localisation, fiches de ligne) viennent de la même chaîne
de calcul que Repère Rail (`data-pipeline/run.sh`), recalée sur les repères SNCF Réseau et les bornes kilométriques
d'OpenStreetMap.

L'import d'un lien Google My Maps passe par la fonction serveur `mymaps` du projet Supabase de Repère Rail (le
navigateur ne peut pas lire Google directement). C'est le seul appel à un serveur : tout le reste est statique.

## Publication

```bash
bash scripts/deploy_pages.sh
```

Lance le lint et les tests unitaires, construit l'appli avec le bon chemin (`/pk-rail/`), la teste dans un
navigateur, puis la publie sur la branche `gh-pages` (GitHub Pages). Si un test échoue, rien n'est publié.

Les nouvelles versions s'installent toutes seules sur les téléphones ; la page se recharge quand l'appli est au repos,
jamais pendant un suivi du PK ou un repérage.

## Licence

Code sous licence **GPL-3.0** (fichier `LICENSE`).

Les dessins de la signalisation (carrés, sémaphores, avertissements, TIV, pancartes…) viennent de la bibliothèque
[signalisation-rfn-svg](https://github.com/nicolaswurtz/signalisation-rfn-svg) de Nicolas Wurtz, sous licence GPL-3.0
(copie dans `app/public/signaux/LICENSE.txt`). Seuls les dessins utilisés par les données sont repris
(`scripts/build_signal_assets.py`). Chaque signal OpenStreetMap reçoit le nom de son dessin dans la chaîne de données
(`data-pipeline/build_products.py`, liste `data-pipeline/rfn_icons.txt`).

Données : © SNCF Réseau (open data), © contributeurs OpenStreetMap (ODbL), fond plan OpenFreeMap / OpenMapTiles,
photo aérienne © IGN.
