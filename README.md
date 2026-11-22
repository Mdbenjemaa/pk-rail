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
| Me repérer | Écoute le GPS jusqu'à 12 s, rattache la position à la ligne la plus proche et donne le PK, la vitesse, l'électrification, les signaux, PN, gares et tunnels autour. Appui long sur la carte : « me placer ici ». Si deux lignes sont proches, on choisit la sienne dans « Autres lignes proches ». |
| Suivre le PK en direct | Gros compteur PK au mètre qui défile en avançant, à pied comme en véhicule (lissage du GPS, sens ▲/▼ des PK, reste sur la ligne suivie aux bifurcations). La carte reste libre et revient sur toi avec « Recentrer ». L'écran reste allumé. |
| Aller au PK | Taper un PK (champs km + m), le voir sur la carte, la distance depuis ta position, les accès proches et l'itinéraire en voiture (Plans, Google Maps, Waze). |
| Recherche | Gare, code de ligne, ou ligne + PK (« 830000 45+200 »), ou un PK seul sur la ligne où tu es. |
| Mes accès | Importer une carte d'accès : fichier KML/KMZ/GeoJSON ou lien Google My Maps (y compris le lien court maps.app.goo.gl du bouton Partager). Chaque accès reçoit sa ligne et son PK. Gardé uniquement sur le téléphone. |
| Couches | Signaux, PN, gares, quais, voies, tunnels, sous-stations, bornes, caractéristiques de ligne ; fond plan, photo aérienne ou aucun. |

## Développement

```bash
cd app
npm ci
npm run dev      # http://localhost:5173
npm test
```

Les données (`app/public/data` : tuiles PMTiles, cases de localisation, fiches de ligne) viennent de la même chaîne
de calcul que Repère Rail (`data-pipeline/run.sh`), recalée sur les repères SNCF Réseau et les bornes kilométriques
d'OpenStreetMap.

L'import d'un lien Google My Maps passe par la fonction serveur `mymaps` du projet Supabase de Repère Rail (le
navigateur ne peut pas lire Google directement). C'est le seul appel à un serveur : tout le reste est statique.

## Publication

```bash
bash scripts/deploy_pages.sh
```

Construit l'appli avec le bon chemin (`/pk-rail/`) et la publie sur la branche `gh-pages` (GitHub Pages).
