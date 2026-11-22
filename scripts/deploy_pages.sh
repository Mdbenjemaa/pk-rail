#!/bin/bash
# Construit l'appli et la publie sur la branche gh-pages (GitHub Pages).
# Adresse : https://<compte>.github.io/<dépôt>/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(basename -s .git "$(git -C "$ROOT" remote get-url origin)")"
cd "$ROOT/app"
npm ci
npm test
BASE_PATH="/$REPO/" npm run build
touch dist/.nojekyll
TMP="$(mktemp -d)"
git -C "$ROOT" worktree add --detach "$TMP"
cd "$TMP"
git checkout -q --orphan gh-pages-new
git rm -rfq . >/dev/null
cp -a "$ROOT/app/dist/." .
git add -A
git commit -qm "Publication de l'appli"
git push -f origin HEAD:gh-pages
cd "$ROOT"
git worktree remove --force "$TMP"
git branch -D gh-pages-new >/dev/null 2>&1 || true
echo "Publié : https://$(git remote get-url origin | sed -E 's#.*github.com[/:]([^/]+)/.*#\1#' | tr 'A-Z' 'a-z').github.io/$REPO/"
