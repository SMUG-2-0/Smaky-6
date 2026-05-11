'use strict';
// ═══════════════════════════════════════════════════════════════════
// check_roundtrip.js — vérifie que le réassemblage de SYS.SR + SAMOS.SR
// reproduit bit-pour-bit le binaire d'origine SYS.SY.
//
// Workflow complet :
//   1. node samos_disasm/build_sys_sr.js     → produit SYS.SR
//   2. node samos_disasm/build_samos_sr.js   → produit SAMOS.SR
//   3. (sur Smaky 6) assembler SYS.SR        → produit sys-retour.sm
//   4. (sur Smaky 6) assembler SAMOS.SR      → produit samos-retour.sm
//   5. node samos_disasm/check_roundtrip.js  → compare avec SYS.SY
//
// Compare la concaténation :
//     sys-retour.sm  (4096 octets, zone 0000H..0FFFH)
//   + samos-retour.sm (4864 octets, zone 1000H..22FFH)
//   = 8960 octets
// avec :
//     SYS.SY         (8960 octets, binaire d'origine)
//
// Signale les différences avec leur adresse, l'octet attendu et l'octet
// trouvé. Les 50 premières divergences sont listées.
//
// Usage :
//   node samos_disasm/check_roundtrip.js
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const root = path.dirname(__dirname);
const sysSy   = fs.readFileSync(path.join(root, 'SYS.SY'));
const sysSm   = fs.readFileSync(path.join(__dirname, 'sys-retour.sm'));
const samosSm = fs.readFileSync(path.join(__dirname, 'samos-retour.sm'));

function hex2(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }
function hex4(n) { return n.toString(16).padStart(4, '0').toUpperCase(); }

const reassembled = Buffer.concat([sysSm, samosSm]);

console.log(`SYS.SY         : ${sysSy.length} octets`);
console.log(`sys-retour.sm  : ${sysSm.length} octets  (zone 0000H..0FFFH attendue : 4096)`);
console.log(`samos-retour.sm: ${samosSm.length} octets  (zone 1000H..22FFH attendue : 4864)`);
console.log(`concaténation  : ${reassembled.length} octets  (attendu : ${sysSy.length})`);
console.log('');

if (reassembled.length !== sysSy.length) {
    console.log(`!! TAILLE DIFFERENTE : écart de ${reassembled.length - sysSy.length} octets`);
}

const diffs = [];
const len = Math.min(reassembled.length, sysSy.length);
for (let i = 0; i < len; i++) {
    if (reassembled[i] !== sysSy[i]) diffs.push(i);
}

if (diffs.length === 0 && reassembled.length === sysSy.length) {
    console.log('OK : réassemblage bit-pour-bit identique à SYS.SY.');
    process.exit(0);
}

console.log(`${diffs.length} octet(s) divergent(s) sur ${len} comparé(s).`);
console.log('');
console.log('  Adresse  attendu  trouvé');
console.log('  -------  -------  ------');
for (const off of diffs.slice(0, 50)) {
    console.log(`  ${hex4(off)}      ${hex2(sysSy[off])}       ${hex2(reassembled[off])}`);
}
if (diffs.length > 50) {
    console.log(`  ... (${diffs.length - 50} autre(s) non affichée(s))`);
}
process.exit(1);
