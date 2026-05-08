'use strict';
// build.js — génère un fichier HTML autonome (tout en un)
// Usage : node build.js
// Résultat : smaky6.html (uploadable seul sur n'importe quel hébergeur)

const fs   = require('fs');
const path = require('path');

const DIR = __dirname;

function read(name) {
    return fs.readFileSync(path.join(DIR, name), 'utf8');
}

let html = read('index.html');

// Remplacer chaque <script src="xxx.js"> par le contenu inline du fichier
html = html.replace(/<script src="([^"]+)"><\/script>/g, (match, file) => {
    const content = read(file);
    return `<script>\n${content}\n</script>`;
});

const out = path.join(DIR, 'smaky6.html');
fs.writeFileSync(out, html, 'utf8');
console.log('Fichier généré :', out);
console.log('Taille :', Math.round(fs.statSync(out).size / 1024), 'Ko');
