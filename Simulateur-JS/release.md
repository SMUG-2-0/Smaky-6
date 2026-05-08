# Smaky 6 Simulator — release et workflow Git

## Liens de téléchargement (version 0.4.0)

- **Page de la release** : <https://github.com/SMUG-2-0/Smaky-6/releases/tag/v0.4.0>
- **Windows (installeur NSIS)** : <https://github.com/SMUG-2-0/Smaky-6/releases/download/v0.4.0/Smaky.6.Simulator.Setup.0.4.0.exe>
- **Linux (archive autonome)** : <https://github.com/SMUG-2-0/Smaky-6/releases/download/v0.4.0/smaky6-simulator-0.4.0.tar.gz>

Pour les futures versions, il suffit de remplacer `v0.4.0` (et la version dans le nom de fichier) par le nouveau numéro. Plus simple : faire pointer le bouton « Télécharger » de smaky6.pyr.ch vers la page **/releases/latest** qui redirige toujours vers la version la plus récente :
<https://github.com/SMUG-2-0/Smaky-6/releases/latest>

## Note pour les utilisateurs Windows

L'installeur n'est pas signé numériquement (pas de certificat de signature de code). Microsoft Defender SmartScreen affiche un avertissement « Microsoft Defender SmartScreen a empêché un démarrage non reconnu ». Cliquer sur **Informations complémentaires → Exécuter quand même**.

---

## Workflow Git pour publier une nouvelle version

À exécuter depuis `Simulateur-JS/`. Remplacer `X.Y.Z` par le nouveau numéro de version.

### 1. Avant de coder : créer une branche dédiée

```
git switch -c fix-<sujet>
```

Travailler sur cette branche, tester, itérer. Le `master` reste intact pendant le développement — filet de sécurité pédagogique.

### 2. Bumper le numéro de version

Trois endroits à modifier :
- `package.json` ligne 3 (`"version"`).
- `package-lock.json` lignes 3 et 9 (les deux `"version"`).

### 3. Construire les binaires

```
npm run dist:all
```

Produit `dist/Smaky 6 Simulator Setup X.Y.Z.exe` (Windows NSIS) et `dist/smaky6-simulator-X.Y.Z.tar.gz` (Linux). Tester l'installeur Windows avant de continuer.

### 4. Commit, merge, tag, push

| Étape | Commande |
|---|---|
| Stager les fichiers nommément | `git add smaky.js package.json package-lock.json` |
| Créer le commit (multi-lignes) | `git commit -m "$(cat <<'EOF'`<br>...<br>`EOF`<br>`)"` |
| Bascule sur master | `git switch master` |
| Fusionner | `git merge fix-<sujet>` *(fast-forward)* |
| Créer le tag annoté | `git tag -a vX.Y.Z -m "Smaky 6 Simulator X.Y.Z — résumé"` |
| Pousser la branche | `git push origin master` |
| Pousser le tag | `git push origin vX.Y.Z` *(tags non automatiques)* |
| Supprimer la branche locale | `git branch -d fix-<sujet>` *(`-d` minuscule = sûr)* |

**Important** : ne **jamais** utiliser `git add -A` ou `git add .` — ils ramassent le dossier `.claude/` (mémoire locale Claude Code) qui ne doit pas être versionné. Toujours nommer les fichiers explicitement.

### 5. Créer la release sur GitHub

```
gh release create vX.Y.Z "dist\Smaky 6 Simulator Setup X.Y.Z.exe" "dist\smaky6-simulator-X.Y.Z.tar.gz" --title "Smaky 6 Simulator X.Y.Z" --notes-file <chemin-du-md>
```

`gh` est installé et déjà authentifié sur cette machine (compte `pyrochat`). À ré-authentifier sur d'autres postes avec `gh auth login`.

---

## Notes pratiques

- **Mode développeur Windows requis** pour la première construction (`npm run dist`) — il permet à `electron-builder` d'extraire les liens symboliques du paquet `winCodeSign`. À activer une seule fois par machine : Settings → recherche « développeur » → activer « Mode développeur ».
- **Build macOS** : non disponible depuis Windows (limite d'`electron-builder` 25). La cible `mac` reste configurée dans `package.json` ; `npm run dist:mac` doit être lancé sur un Mac. Piste future : runner GitHub Actions `macos-latest`.
- **Tags Git** : `git tag -a` (annoté) plutôt que `git tag` (lightweight) pour les releases — le tag annoté porte un message, un auteur et une date, comme un mini-commit.
- **Fast-forward merge** : quand `master` n'a pas bougé pendant le développement de la branche, `git merge` se contente d'avancer le pointeur, sans créer de commit de fusion. Historique propre et linéaire.
- **`git branch -d` vs `-D`** : minuscule = supprime seulement si la branche est mergée (sûr). Majuscule = force la suppression (à éviter par défaut).
