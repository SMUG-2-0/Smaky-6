# SimSmaky6 — notes pour les curieux

Documentation rapide des fichiers `.js` du dossier `web/` du simulateur Smaky 6,
et de la procédure pour produire un fichier HTML autonome.

## Rôle des fichiers `.js`

### Cœur du simulateur (exécuté dans le navigateur)

- **`z80.js`** — Émulateur du processeur Z80. Décode et exécute chaque
  instruction Z80 (jeu complet incluant les préfixes CB/DD/ED/FD et les opcodes
  non documentés utilisés par la ROM du Smaky). C'est le « CPU virtuel ».

- **`smaky.js`** — Logique de la machine Smaky 6 autour du Z80 : mémoire,
  contrôleur disque (WD1002), gestion de l'écran texte/graphique, clavier,
  interruptions, boucle d'exécution à ~50 Hz. C'est le port JS de l'ancien
  `SimSmaky6.py`.

- **`disasm.js`** — Désassembleur Z80. Traduit les octets mémoire en
  mnémoniques (ex : `3E 00` → `LD A,00h`). Utilisé par la commande `X` du
  mode interactif.

- **`rom18.js`** — La ROM du Smaky 6 (version 1-8) encodée en base64 dans une
  constante `ROM18_B64`. Chargée au démarrage dans la mémoire du simulateur.

### Environnement Electron (app de bureau)

- **`main.js`** — Processus principal Electron : crée la fenêtre, gère les
  dialogues natifs (choix du dossier disques), accès fichiers, zoom,
  presse-papiers. Ne tourne **pas** dans le navigateur en mode Web.

- **`preload.js`** — Pont sécurisé entre `main.js` (Node) et la page
  (renderer) : expose l'objet `window.electronAPI`. Aussi spécifique à
  Electron.

### Outils de développement

- **`build.js`** — Script Node qui fusionne `index.html` + tous les
  `<script src="…">` en un **seul fichier HTML autonome** (`smaky6.html`).
  Pratique pour publier sur un hébergeur.

- **`test_z80.js`, `test_smaky.js`, `test_disasm.js`** — Tests unitaires
  (à lancer via Node) pour vérifier que l'émulation reste correcte.

- **`test_z80_py.py`** — Script de référence Python pour comparer les
  résultats d'exécution Z80 entre l'ancien simulateur et le port JS.

En mode navigateur, seuls `z80.js`, `disasm.js`, `smaky.js` et `rom18.js`
sont chargés par `index.html`. Les autres servent au packaging Electron ou
aux tests.

## Produire `smaky6.html` (fichier HTML autonome)

Ouvrir un terminal dans le dossier `web/` et lancer :

```
node build.js
```

Ça produit `smaky6.html` dans le même dossier. Le script :

1. lit `index.html`,
2. remplace chaque `<script src="xxx.js"></script>` par le contenu inline du
   fichier,
3. écrit `smaky6.html` et affiche sa taille.

**Prérequis :** Node.js installé (`node --version` pour vérifier). Il est
déjà présent si Electron est utilisé.

Le fichier résultant est totalement autonome — un simple double-clic dans
Chrome l'ouvre, et il peut être déposé tel quel sur un hébergeur Web.

## Créer un installateur Windows avec Electron

Tout est déjà configuré dans `package.json` (section `build`).

### 1. Installer les dépendances (une seule fois, ou après un clone)

```
npm install
```

### 2. Tester en mode dev

```
npm start
```

Lance Electron directement sur le dossier courant.

### 3. Créer l'installateur Windows

```
npm run dist
```

Ça exécute `electron-builder --win`, qui :

- empaquette l'app + une copie d'Electron,
- produit un installateur **NSIS** (`.exe`) dans un nouveau sous-dossier
  `dist/`,
- nom typique : `Smaky 6 Simulator Setup 0.2.0.exe`.

### Configuration actuelle

Dans `package.json`, section `build` :

- `appId` : `ch.epsitec.smaky6sim`
- Installateur **one-click** (pas de choix de dossier), **par utilisateur**
  (pas besoin d'être admin)
- Raccourci automatique sur le bureau
- Icône : `icon.ico`
- Fichiers embarqués : `index.html`, `main.js`, `preload.js`, `rom18.js`,
  `z80.js`, `disasm.js`, `smaky.js` (les `.DSK` restent externes :
  l'utilisateur choisit son dossier d'images)

### Changer le numéro de version

Avant une release, éditer `"version"` en haut de `package.json`
(ex. `"0.3.0"`), puis relancer `npm run dist`.

### Ajouter des fichiers supplémentaires à l'installateur

Les lister dans le tableau `"files"` de la section `build`. Avec l'aide et
la page des disques maintenant inlinées dans `index.html`, ce n'est plus
nécessaire pour celles-ci.
