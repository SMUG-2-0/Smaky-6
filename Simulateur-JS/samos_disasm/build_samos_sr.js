'use strict';
// ═══════════════════════════════════════════════════════════════════
// build_samos_sr.js — génère SAMOS.SR à partir de SYS.SY
//
// Lit :
//   ../SYS.SY              (offset 0x1000..0x22FF = zone SAMOS)
//   ./symbols.json         (labels nommés, partagé avec SYS.SR)
//   ./samos_regions.json   (annotations spécifiques à la zone SAMOS)
//   ./syscalls.json        (mapping RST_op + code → ?NAME)
//
// Produit :
//   ./SAMOS.SR             (source CALM 1re gen pour assembleur Smaky 6)
//
// Usage :
//   node samos_disasm/build_samos_sr.js          (sans trace addr/opcode)
//   node samos_disasm/build_samos_sr.js --trace  (avec trace en commentaire)
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { disasmAt } = require('../disasm.js');
const { transcodeLine, fmtByte } = require('./disasm_calm.js');

const EMIT_TRACE = process.argv.includes('--trace');

// ─── Configuration de la zone SAMOS ───────────────────────────────

const SAMOS_FROM = 0x1000;
const SAMOS_TO   = 0x2300;

// ─── Chargement ────────────────────────────────────────────────────

const root    = path.dirname(__dirname);
const sysSy   = fs.readFileSync(path.join(root, 'SYS.SY'));
const symRaw  = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbols.json')));
const regions = JSON.parse(fs.readFileSync(path.join(__dirname, 'samos_regions.json')));
const syscalls= JSON.parse(fs.readFileSync(path.join(__dirname, 'syscalls.json')));

// labels[] : table COMPLETE, utilisée pour les commentaires uniquement.
// labelsLocal[] : restreinte à la zone SAMOS, passée au transcodeur pour
// substitution dans les opérandes (les addresses hors-zone passent en H'XXXX).
const labels = {};
for (const [k, v] of Object.entries(symRaw)) {
    labels[parseInt(k.replace(/^0x/, ''), 16)] = v;
}
const labelAddrs = new Set(Object.keys(labels).map(Number));

// ─── Helpers de base ───────────────────────────────────────────────

const memRead = (a) => sysSy[a & 0xFFFF];
function hex2(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }
function hex4(n) { return n.toString(16).padStart(4, '0').toUpperCase(); }

function addLabel(addr, name) {
    if (labelAddrs.has(addr)) return false;
    labels[addr] = name;
    labelAddrs.add(addr);
    return true;
}

function trySyscallEarly(addr) {
    const op = sysSy[addr & 0xFFFF];
    if (op !== 0xE7 && op !== 0xD7) return null;
    const code = sysSy[(addr + 1) & 0xFFFF];
    const key = hex2(op) + hex2(code);
    if (!syscalls[key]) return null;
    // ?TEXTIM : inclure le texte inline + terminateur 0 dans la longueur
    if (syscalls[key] === '?TEXTIM') {
        let scan = addr + 2;
        while (scan < SAMOS_TO && sysSy[scan & 0xFFFF] !== 0) scan++;
        return scan - addr + 1; // +1 pour le terminateur
    }
    return 2;
}

// ─── Pré-passage : collecte des cibles de saut dans la zone SAMOS ──
// IMPORTANT : doit utiliser la même logique d'alignement que emitCode,
// y compris la reconnaissance des syscalls RST 20h (2 octets), sinon
// la marche linéaire se désaligne sur les data et rate des cibles JR.

function collectJumpTargets() {
    const targets = new Set();
    let pc = SAMOS_FROM;
    while (pc < SAMOS_TO) {
        const scLen = trySyscallEarly(pc);
        if (scLen) { pc += scLen; continue; }
        const r = disasmAt(memRead, pc);
        if (r.length === 0) break;
        const m = r.text.match(/^(JP|JR|CALL|DJNZ)\s+(?:[A-Z]+,)?([0-9A-F]+h)$/);
        if (m) {
            const target = parseInt(m[2].replace(/h$/i, ''), 16);
            if (target >= SAMOS_FROM && target < SAMOS_TO) targets.add(target);
        }
        pc += r.length;
    }
    return targets;
}

// ─── Génération des labels DO_XXX pour les redirections SAMOS ───────
// Un point d'entrée FLO.ST (RODWIB, BOOT, etc.) est typiquement un JP
// vers le vrai handler. On ajoute un label DO_<NAME> à la cible.

function addDoLabels() {
    let added = 0;
    for (const [addrStr, name] of Object.entries(labels)) {
        const addr = Number(addrStr);
        if (/^(L_|DO_|SAMOS_BASE)/.test(name)) continue;
        if (addr < SAMOS_FROM || addr >= SAMOS_TO) continue;
        if (memRead(addr) !== 0xC3) continue; // pas un JP nn
        const target = memRead(addr + 1) | (memRead(addr + 2) << 8);
        if (target < SAMOS_FROM || target >= SAMOS_TO) continue;
        // Si la cible a déjà un label auto L_xxxx, on le remplace par DO_<NAME>.
        // Le préfixe I_ (label interne, évite collision avec FLO.ST) est retiré
        // côté destination : I_RODWIB → DO_RODWIB.
        const existing = labels[target];
        if (!existing || /^L_/.test(existing)) {
            const baseName = name.replace(/^I_/, '');
            labels[target] = `DO_${baseName}`;
            labelAddrs.add(target);
            added++;
        }
    }
    return added;
}

// ─── Application des pré-passages ───────────────────────────────────

for (const t of collectJumpTargets()) {
    addLabel(t, `L_${hex4(t)}`);
}
const nDo = addDoLabels();

// Vue restreinte à la zone SAMOS pour la substitution des opérandes.
const labelsLocal = {};
for (const [a, n] of Object.entries(labels)) {
    const addr = Number(a);
    if (addr >= SAMOS_FROM && addr < SAMOS_TO) labelsLocal[addr] = n;
}
console.log('Labels :', Object.keys(labels).length, 'au total,',
            Object.keys(labelsLocal).length, 'dans la zone SAMOS',
            `(DO_xxx: ${nDo})`);

function labelInRange(start, endExclusive) {
    for (let a = start; a < endExclusive; a++) {
        if (labelAddrs.has(a)) return true;
    }
    return false;
}

// ─── Mise en forme des lignes ──────────────────────────────────────
// Convention :
//  - étiquette seule sur sa ligne (suivie de ':')
//  - instruction indentée d'un tabulateur (tab fixe à 8 caractères)
//  - commentaire d'information (orphelin, mnémonique, etc.) toujours émis
//  - trace adresse/opcode optionnelle, contrôlée par --trace

function pushLine(out, label, instr, info, trace) {
    if (label) {
        const lbl = label.replace(/:$/, '');
        out.push(`${lbl}:`);
    }
    let line = `\t${instr}`;
    const cmtParts = [];
    if (EMIT_TRACE && trace) cmtParts.push(trace);
    if (info) cmtParts.push(info);
    if (cmtParts.length) line += `\t;${cmtParts.join('  ')}`;
    out.push(line);
}

function maybeBlankAfter(out, instr) {
    if (instr === 'RET' || instr === 'RETI' || instr === 'RETN') {
        out.push('');
    }
}

function trySyscall(addr) {
    const op = memRead(addr);
    if (op !== 0xE7 && op !== 0xD7) return null;
    const code = memRead(addr + 1);
    const key = hex2(op) + hex2(code);
    const name = syscalls[key];
    if (!name) return null;
    return { name, length: 2 };
}

// ─── Génération section CODE ───────────────────────────────────────

function emitCode(out, from, to) {
    let pc = from;
    while (pc < to) {
        const labelStr = labels[pc] || '';

        const sc = trySyscall(pc);
        if (sc && !labelInRange(pc + 1, pc + sc.length)) {
            const trace = `${hex4(pc)}: ${hex2(memRead(pc))} ${hex2(memRead(pc+1))}`;
            pushLine(out, labelStr, `.W ${sc.name}`, null, trace);
            pc += sc.length;
            // ?TEXTIM : texte inline terminé par un octet 0, émis en .ASCIZ
            if (sc.name === '?TEXTIM') {
                const ESCAPES = { 0x0D: '<CR>', 0x0A: '<LF>' };
                let text = '';
                while (pc < to && memRead(pc) !== 0) {
                    const b = memRead(pc);
                    text += ESCAPES[b] || (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : `<${hex2(b)}>`);
                    pc++;
                }
                if (pc < to) pc++; // consomme le terminateur 0
                const delim = text.includes('/') ? '|' : '/';
                pushLine(out, '', `.ASCIZ ${delim}${text}${delim}`, null, null);
            }
            continue;
        }

        const { text, length } = disasmAt(memRead, pc);
        if (length === 0) {
            pushLine(out, labelStr, `;ERREUR LENGTH=0 EN ${hex4(pc)}`, null, null);
            break;
        }

        if (labelInRange(pc + 1, pc + length)) {
            const b = memRead(pc);
            const trace = `${hex4(pc)}: ${hex2(b)}`;
            const info = `orphelin avant ${labels[pc + 1] || hex4(pc+1)}`;
            pushLine(out, labelStr, `.B ${fmtByte(hex2(b) + 'h')}`, info, trace);
            pc++;
            continue;
        }

        const { calm, extraComment, rawBytes } = transcodeLine(text, labelsLocal);
        const bytes = [];
        for (let i = 0; i < length; i++) bytes.push(hex2(memRead(pc + i)));

        if (rawBytes) {
            const byteStrs = Array.from({ length }, (_, i) => fmtByte(hex2(memRead(pc + i)) + 'h'));
            const hexBytes = Array.from({ length }, (_, i) => hex2(memRead(pc + i)));
            const trace = `${hex4(pc)}: ${hexBytes.join(' ')}`;
            pushLine(out, labelStr, `.B ${byteStrs.join(', ')}`, extraComment, trace);
            pc += length;
            continue;
        }

        const trace = `${hex4(pc)}: ${bytes.join(' ')}`;
        pushLine(out, labelStr, calm, extraComment, trace);
        maybeBlankAfter(out, calm);
        pc += length;
    }
}

function emitData(out, from, to) {
    for (let pc = from; pc < to; pc++) {
        const labelStr = labels[pc] || '';
        const b = memRead(pc);
        const trace = `${hex4(pc)}: ${hex2(b)}`;
        pushLine(out, labelStr, `.B ${fmtByte(hex2(b) + 'h')}`, null, trace);
    }
}

// ─── En-tête du fichier ────────────────────────────────────────────

const HEADER = `\t.TITLE SAMOS.SR
\t.PROC Z80
\t.REF  FLO
\t.LOC  10000

\t;SAMOS V2.2 — EXTENSION SYSTEME DU SMAKY 6
\t;ZONE 1000H..22FFH (~4.8 KO)

\t;SOURCE RECONSTITUE PAR REVERSE-ENGINEERING DU BINAIRE SYS.SY,
\t;DANS LE CADRE DU TRAVAIL DE CONSERVATION DES SMAKY
\t;FINANCE PAR EPSITEC SA.

\t;AUTEUR PRINCIPAL DE SAMOS : ALAIN CAPT (CONTROLEUR FLOPPY,
\t;FILE SYSTEM ET BEAUCOUP D'AUTRES PARTIES).
\t;D'AUTRES CONTRIBUTEURS QUE NOUS CHERCHONS A IDENTIFIER.

\t;COMPLEMENTE SYS.SR (ZONE 0000H..0FFFH).



;DEBUT DU CODE SAMOS
;===================

`;

// ─── Construction ──────────────────────────────────────────────────

const out = [HEADER];

for (const region of regions) {
    if (region.kind === 'code') {
        emitCode(out, region.from, region.to);
    } else if (region.kind === 'data') {
        emitData(out, region.from, region.to);
    } else {
        out.push(`;TODO region ${region.kind} ${hex4(region.from)}..${hex4(region.to)}`);
    }
}

out.push('');
out.push('\t.END');
out.push('');

const dest = path.join(__dirname, 'SAMOS.SR');
fs.writeFileSync(dest, out.join('\n'), { encoding: 'utf8' });
console.log('Écrit', dest, ':', out.length, 'lignes,', fs.statSync(dest).size, 'octets',
            EMIT_TRACE ? '(avec trace)' : '(sans trace)');
