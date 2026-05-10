'use strict';
// ═══════════════════════════════════════════════════════════════════
// build_sys_sr.js — génère SYS.SR à partir de SYS.SY
//
// Lit :
//   ../SYS.SY        (8960 octets, partie SYS-MON = offset 0..0xFFF)
//   ./symbols.json   (table des labels addr → nom)
//   ./regions.json   (annotations code/ptr-table/data)
//   ./syscalls.json  (mapping (RST_op + code) → ?NAME)
//
// Produit :
//   ./SYS.SR         (source CALM 1re gen pour assembleur Smaky 6)
//
// Usage :
//   node samos_disasm/build_sys_sr.js
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { disasmAt } = require('../disasm.js');
const { transcodeLine, fmtByte, fmtWord } = require('./disasm_calm.js');

// ─── Chargement ────────────────────────────────────────────────────

const root    = path.dirname(__dirname);
const sysSy   = fs.readFileSync(path.join(root, 'SYS.SY'));
const symRaw  = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbols.json')));
const regions = JSON.parse(fs.readFileSync(path.join(__dirname, 'regions.json')));
const syscalls= JSON.parse(fs.readFileSync(path.join(__dirname, 'syscalls.json')));

// Map int → name (depuis "0x0E55" → "RDCLK_PRIM")
const labels = {};
for (const [k, v] of Object.entries(symRaw)) {
    labels[parseInt(k.replace(/^0x/, ''), 16)] = v;
}

// Set des adresses étiquetées pour vérification rapide de "label dans plage"
const labelAddrs = new Set(Object.keys(labels).map(Number));

// ─── Pré-passage : collecte des cibles de saut/appel ────────────────
// Pour rendre le source lisible, on génère un label automatique
// L_XXXX pour chaque cible de JP/JR/CALL/DJNZ qui n'a pas déjà un nom
// dans symbols.json. Limité aux cibles dans la zone SYS-MON (0..FFFh).

function collectJumpTargets() {
    const mr = (a) => sysSy[a & 0xFFFF];
    const targets = new Set();
    let pc = 0;
    while (pc < 0x1000) {
        const r = disasmAt(mr, pc);
        if (r.length === 0) break;
        // Match cibles : JP/JR/CALL [cond,]addr ; DJNZ addr
        const m = r.text.match(/^(JP|JR|CALL|DJNZ)\s+(?:[A-Z]+,)?([0-9A-F]+h)$/);
        if (m) {
            const target = parseInt(m[2].replace(/h$/i, ''), 16);
            if (target < 0x1000) targets.add(target);
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
console.log('Auto-labels ajoutés :', Object.keys(labels).length, 'symboles au total');

/** Vrai si une adresse étiquetée se trouve dans (start, endExclusive). */
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

/** Émet une ligne formatée label/instruction/commentaire.
 *  - label  : "TOTO:" ou "" (laissé en colonne 0)
 *  - instr  : mnémonique + opérandes
 *  - cmt    : commentaire (sans le ;), ou null  */
function fmtLine(label, instr, cmt) {
    const labelPart = label ? label + (label.endsWith(':') ? '' : ':') : '';
    let line;
    if (labelPart) {
        // Format "LABEL: INSTR" sur la même ligne (style horloge.sr)
        line = labelPart.padEnd(8, ' ') + ' ' + instr;
    } else {
        line = ' ' + instr;
    }
    if (cmt) {
        line = line.padEnd(32, ' ') + ' ;' + cmt;
    }
    return line;
}

// ─── Détection des appels système RST 20h / RST 10h ────────────────
// Pattern : opcode E7 ou D7, puis octet code. On émet `.W ?NAME` pour
// la paire et on saute 2 octets au lieu de 1.

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

        // Tentative de reconnaissance d'un appel système RST 20h / 10h
        const sc = trySyscall(pc);
        if (sc && !labelInRange(pc + 1, pc + sc.length)) {
            out.push(fmtLine(labelStr, `.W ${sc.name}`,
                `${hex4(pc)}: ${hex2(memRead(pc))} ${hex2(memRead(pc+1))}`));
            pc += sc.length;
            continue;
        }

        // Désassemblage Zilog
        const { text, length } = disasmAt(memRead, pc);
        if (length === 0) {
            out.push(fmtLine(labelStr, `;ERREUR LENGTH=0 EN ${hex4(pc)}`, null));
            break;
        }

        // Si l'instruction "écraserait" une étiquette, on émet juste un
        // octet de donnée (bouchon entre routines, padding, etc.).
        if (labelInRange(pc + 1, pc + length)) {
            const b = memRead(pc);
            out.push(fmtLine(labelStr, `.B ${fmtByte(hex2(b) + 'h')}`,
                `${hex4(pc)}: ${hex2(b)}          ;orphelin avant ${labels[pc + 1] || hex4(pc+1)}`));
            pc++;
            continue;
        }

        // Émission normale
        const { calm, extraComment } = transcodeLine(text, labels);
        const bytes = [];
        for (let i = 0; i < length; i++) bytes.push(hex2(memRead(pc + i)));
        const trace = `${hex4(pc)}: ${bytes.join(' ').padEnd(11, ' ')}`;
        const cmt = extraComment ? `${trace}  ${extraComment}` : trace;
        out.push(fmtLine(labelStr, calm, cmt));
        pc += length;
    }
}

// ─── Génération table de dispatch RST 20h ──────────────────────────

function emitDispatchRST20H(out, from, to) {
    out.push('');
    out.push(';TABLE DE DISPATCH RST 20H : 104 ENTREES (CODES 00..67)');
    out.push(';CHAQUE .W EST L\'ADRESSE DU HANDLER POUR LE CODE CORRESPONDANT');
    out.push('');
    let code = 0;
    for (let pc = from; pc < to; pc += 2, code++) {
        const target = memRead(pc) | (memRead(pc + 1) << 8);
        const targetLabel = labels[target] || `H'${hex4(target)}`;
        const labelStr = labels[pc] ? labels[pc] : '';
        const callName = syscalls['E7' + hex2(code)] || '';
        const cmt = callName
            ? `CODE ${hex2(code)}H = ${callName}`
            : `CODE ${hex2(code)}H`;
        out.push(fmtLine(labelStr, `.W ${targetLabel}`, cmt));
    }
}

// ─── En-tête du fichier ────────────────────────────────────────────

const HEADER = ` .TITLE SYS.SR
 .PROC Z80
 .REF  FLO

 ;SYS-MON V2.2 — PARTIE SYSTEME / MONITEUR DU SMAKY 6
 ;ZONE 0000H..0FFFH (4 KO, ORIGINELLEMENT 4 EPROMS TMS2716)

 ;SOURCE RECONSTITUE PAR REVERSE-ENGINEERING DU BINAIRE SYS.SY,
 ;DANS LE CADRE DU TRAVAIL DE CONSERVATION DES SMAKY
 ;FINANCE PAR EPSITEC SA.

 ;AUTEUR PRINCIPAL DE SAMOS : ALAIN CAPT (CONTROLEUR FLOPPY,
 ;FILE SYSTEM ET BEAUCOUP D'AUTRES PARTIES).
 ;D'AUTRES CONTRIBUTEURS QUE NOUS CHERCHONS A IDENTIFIER.

 ;CETTE VERSION SUPPORTE LE DISQUE DUR (CONTROLEUR WD1002) ET
 ;LES DISQUETTES MICROPOLIS (NON COUVERTES PAR LE SIMULATEUR
 ;A CE STADE). VERSION 2.2 DE SYS COMPLEMENTEE PAR SAMOS 2.2
 ;EN ZONE 1000H..22FFH (FICHIER SAMOS.SR SEPARE).



;DEBUT DU CODE SYS-MON
;=====================

`;

// ─── Construction ──────────────────────────────────────────────────

const out = [HEADER];

for (const region of regions) {
    if (region.kind === 'code') {
        emitCode(out, region.from, region.to);
    } else if (region.kind === 'ptr-table-rst20h') {
        emitDispatchRST20H(out, region.from, region.to);
    } else {
        out.push(`;TODO region ${region.kind} ${hex4(region.from)}..${hex4(region.to)}`);
    }
}

out.push('');
out.push(' .END');
out.push('');

const dest = path.join(__dirname, 'SYS.SR');
fs.writeFileSync(dest, out.join('\n'), { encoding: 'utf8' });
console.log('Écrit', dest, ':', out.length, 'lignes,', fs.statSync(dest).size, 'octets');
