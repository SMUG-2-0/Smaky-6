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
//   node samos_disasm/build_samos_sr.js
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { disasmAt } = require('../disasm.js');
const { transcodeLine, fmtByte } = require('./disasm_calm.js');

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

function trySyscallEarly(addr) {
    const op = sysSy[addr & 0xFFFF];
    if (op !== 0xE7 && op !== 0xD7) return null;
    const code = sysSy[(addr + 1) & 0xFFFF];
    const key = op.toString(16).padStart(2,'0').toUpperCase() + code.toString(16).padStart(2,'0').toUpperCase();
    return syscalls[key] ? 2 : null;
}

// ─── Pré-passage : collecte des cibles de saut dans la zone SAMOS ──
// IMPORTANT : doit utiliser la même logique d'alignement que emitCode,
// y compris la reconnaissance des syscalls RST 20h (2 octets), sinon
// la marche linéaire se désaligne sur les data et rate des cibles JR.

function collectJumpTargets() {
    const mr = (a) => sysSy[a & 0xFFFF];
    const targets = new Set();
    let pc = SAMOS_FROM;
    while (pc < SAMOS_TO) {
        const scLen = trySyscallEarly(pc);
        if (scLen) { pc += scLen; continue; }
        const r = disasmAt(mr, pc);
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

for (const t of collectJumpTargets()) {
    if (!labelAddrs.has(t)) {
        labels[t] = `L_${t.toString(16).toUpperCase().padStart(4, '0')}`;
        labelAddrs.add(t);
    }
}

// Vue restreinte à la zone SAMOS pour la substitution des opérandes.
const labelsLocal = {};
for (const [a, n] of Object.entries(labels)) {
    const addr = Number(a);
    if (addr >= SAMOS_FROM && addr < SAMOS_TO) labelsLocal[addr] = n;
}
console.log('Auto-labels ajoutés :', Object.keys(labels).length, 'au total,',
            Object.keys(labelsLocal).length, 'dans la zone SAMOS');

function labelInRange(start, endExclusive) {
    for (let a = start; a < endExclusive; a++) {
        if (labelAddrs.has(a)) return true;
    }
    return false;
}

// ─── Helpers ───────────────────────────────────────────────────────

const memRead = (a) => sysSy[a & 0xFFFF];
function hex2(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }
function hex4(n) { return n.toString(16).padStart(4, '0').toUpperCase(); }

function fmtLine(label, instr, cmt) {
    const labelPart = label ? label + (label.endsWith(':') ? '' : ':') : '';
    let line;
    if (labelPart) {
        line = labelPart.padEnd(8, ' ') + ' ' + instr;
    } else {
        line = ' ' + instr;
    }
    if (cmt) {
        line = line.padEnd(32, ' ') + ' ;' + cmt;
    }
    return line;
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
        const labelStr = labels[pc] ? labels[pc] : '';

        const sc = trySyscall(pc);
        if (sc && !labelInRange(pc + 1, pc + sc.length)) {
            out.push(fmtLine(labelStr, `.W ${sc.name}`,
                `${hex4(pc)}: ${hex2(memRead(pc))} ${hex2(memRead(pc+1))}`));
            pc += sc.length;
            continue;
        }

        const { text, length } = disasmAt(memRead, pc);
        if (length === 0) {
            out.push(fmtLine(labelStr, `;ERREUR LENGTH=0 EN ${hex4(pc)}`, null));
            break;
        }

        if (labelInRange(pc + 1, pc + length)) {
            const b = memRead(pc);
            out.push(fmtLine(labelStr, `.B ${fmtByte(hex2(b) + 'h')}`,
                `${hex4(pc)}: ${hex2(b)}          ;orphelin avant ${labels[pc + 1] || hex4(pc+1)}`));
            pc++;
            continue;
        }

        const { calm, extraComment, rawBytes } = transcodeLine(text, labelsLocal);
        const bytes = [];
        for (let i = 0; i < length; i++) bytes.push(hex2(memRead(pc + i)));

        if (rawBytes) {
            for (let i = 0; i < length; i++) {
                const b = memRead(pc + i);
                const lbl = (i === 0) ? labelStr : '';
                const trace = `${hex4(pc + i)}: ${hex2(b)}`;
                const cmt = (i === 0 && extraComment)
                    ? `${trace}  ${extraComment}`
                    : trace;
                out.push(fmtLine(lbl, `.B H'${hex2(b)}`, cmt));
            }
            pc += length;
            continue;
        }

        const trace = `${hex4(pc)}: ${bytes.join(' ').padEnd(11, ' ')}`;
        const cmt = extraComment ? `${trace}  ${extraComment}` : trace;
        out.push(fmtLine(labelStr, calm, cmt));
        pc += length;
    }
}

function emitData(out, from, to) {
    for (let pc = from; pc < to; pc++) {
        const labelStr = labels[pc] ? labels[pc] : '';
        const b = memRead(pc);
        out.push(fmtLine(labelStr, `.B H'${hex2(b)}`, `${hex4(pc)}: ${hex2(b)}`));
    }
}

// ─── En-tête du fichier ────────────────────────────────────────────

const HEADER = ` .TITLE SAMOS.SR
 .PROC Z80
 .REF  FLO
 .LOC  H'1000

 ;SAMOS V2.2 — EXTENSION SYSTEME DU SMAKY 6
 ;ZONE 1000H..22FFH (~4.8 KO)

 ;SOURCE RECONSTITUE PAR REVERSE-ENGINEERING DU BINAIRE SYS.SY,
 ;DANS LE CADRE DU TRAVAIL DE CONSERVATION DES SMAKY
 ;FINANCE PAR EPSITEC SA.

 ;AUTEUR PRINCIPAL DE SAMOS : ALAIN CAPT (CONTROLEUR FLOPPY,
 ;FILE SYSTEM ET BEAUCOUP D'AUTRES PARTIES).
 ;D'AUTRES CONTRIBUTEURS QUE NOUS CHERCHONS A IDENTIFIER.

 ;COMPLEMENTE SYS.SR (ZONE 0000H..0FFFH).



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
out.push(' .END');
out.push('');

const dest = path.join(__dirname, 'SAMOS.SR');
fs.writeFileSync(dest, out.join('\n'), { encoding: 'utf8' });
console.log('Écrit', dest, ':', out.length, 'lignes,', fs.statSync(dest).size, 'octets');
