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
//   node samos_disasm/build_sys_sr.js          (sans trace addr/opcode)
//   node samos_disasm/build_sys_sr.js --trace  (avec trace en commentaire)
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { disasmAt } = require('../disasm.js');
const { transcodeLine, fmtByte, fmtWord } = require('./disasm_calm.js');

const EMIT_TRACE = process.argv.includes('--trace');

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

// ─── Pré-passage : collecte des cibles de saut/appel ────────────────
// Pour rendre le source lisible, on génère un label automatique
// L_XXXX pour chaque cible de JP/JR/CALL/DJNZ qui n'a pas déjà un nom
// dans symbols.json. Limité aux cibles dans la zone SYS-MON (0..FFFh).

function collectJumpTargets() {
    const targets = new Set();
    let pc = 0;
    while (pc < 0x1000) {
        const r = disasmAt(memRead, pc);
        if (r.length === 0) break;
        const m = r.text.match(/^(JP|JR|CALL|DJNZ)\s+(?:[A-Z]+,)?([0-9A-F]+h)$/);
        if (m) {
            const target = parseInt(m[2].replace(/h$/i, ''), 16);
            if (target < 0x1000) targets.add(target);
        }
        pc += r.length;
    }
    return targets;
}

// ─── Résolution des syscalls via la table de dispatch RST 20H ───────
// Pour chaque entrée du dispatch, on récupère l'adresse du handler et on
// la nomme avec le syscall correspondant (sans le préfixe '?'). Les codes
// non documentés sont laissés sans label.
//
// Exceptions : certains noms de syscalls collisionneraient avec des
// mots-clés / symboles réservés de l'assembleur. On les renomme.
const SYSCALL_RENAME = {
    'SPACE': 'DOSPACE',
    'TAB':   'DOTAB',
};

function addSyscallLabelsFromDispatch() {
    const region = regions.find(r => r.kind === 'ptr-table-rst20h');
    if (!region) return 0;
    let added = 0;
    let code = 0;
    for (let pc = region.from; pc < region.to; pc += 2, code++) {
        const target = memRead(pc) | (memRead(pc + 1) << 8);
        const callName = syscalls['E7' + hex2(code)];
        if (!callName) continue;
        const bare = callName.replace(/^\?/, '');
        const final = SYSCALL_RENAME[bare] || bare;
        if (addLabel(target, final)) added++;
    }
    return added;
}

// ─── Génération des labels DO_XXX pour les redirections ─────────────
// Un point d'entrée FLO.ST (RODWIB, BOOT, etc.) est typiquement un JP
// vers le vrai handler. On ajoute un label DO_<NAME> à la cible pour
// que le source montre clairement la redirection.

function addDoLabels() {
    let added = 0;
    for (const [addrStr, name] of Object.entries(labels)) {
        const addr = Number(addrStr);
        // Ne traite pas les labels auto (L_, DO_, déjà résolus).
        if (/^(L_|DO_)/.test(name)) continue;
        if (addr >= 0x1000) continue;        // SAMOS traité par son propre script
        if (memRead(addr) !== 0xC3) continue; // pas un JP nn
        const target = memRead(addr + 1) | (memRead(addr + 2) << 8);
        if (target >= 0x1000) continue;
        // Si la cible a déjà un label auto L_xxxx, on le remplace par DO_<NAME>.
        const existing = labels[target];
        if (!existing || /^L_/.test(existing)) {
            labels[target] = `DO_${name}`;
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
const nSyscalls = addSyscallLabelsFromDispatch();
const nDo       = addDoLabels();
console.log('Labels :', Object.keys(labels).length, 'au total',
            `(syscalls résolus: ${nSyscalls}, DO_xxx: ${nDo})`);

/** Vrai si une adresse étiquetée se trouve dans (start, endExclusive). */
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

/** Ajoute une ligne vide après les vraies fins de routine (RET, RETI, RETN). */
function maybeBlankAfter(out, instr) {
    if (instr === 'RET' || instr === 'RETI' || instr === 'RETN') {
        out.push('');
    }
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
        const labelStr = labels[pc] || '';

        // Tentative de reconnaissance d'un appel système RST 20h / 10h
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

        // Désassemblage Zilog
        const { text, length } = disasmAt(memRead, pc);
        if (length === 0) {
            pushLine(out, labelStr, `;ERREUR LENGTH=0 EN ${hex4(pc)}`, null, null);
            break;
        }

        // Si l'instruction "écraserait" une étiquette, on émet juste un
        // octet de donnée (bouchon entre routines, padding, etc.).
        if (labelInRange(pc + 1, pc + length)) {
            const b = memRead(pc);
            const trace = `${hex4(pc)}: ${hex2(b)}`;
            const info = `orphelin avant ${labels[pc + 1] || hex4(pc+1)}`;
            pushLine(out, labelStr, `.B ${fmtByte(hex2(b) + 'h')}`, info, trace);
            pc++;
            continue;
        }

        // Émission normale
        const { calm, extraComment, rawBytes } = transcodeLine(text, labels);
        const bytes = [];
        for (let i = 0; i < length; i++) bytes.push(hex2(memRead(pc + i)));

        // Mode "rawBytes" : le transcodeur n'a pas de mnémonique CALM 1re gen.
        // On émet tous les octets de l'instruction sur une seule ligne .B.
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

// ─── Génération table de dispatch RST 20h ──────────────────────────

function emitDispatchRST20H(out, from, to) {
    out.push('');
    out.push(';TABLE DE DISPATCH RST 20H : 104 ENTREES (CODES 00..67)');
    out.push(';CHAQUE .W EST L\'ADRESSE DU HANDLER POUR LE CODE CORRESPONDANT');
    out.push('');
    let code = 0;
    for (let pc = from; pc < to; pc += 2, code++) {
        const target = memRead(pc) | (memRead(pc + 1) << 8);
        const targetLabel = labels[target] || target.toString(8);
        const labelStr = labels[pc] || '';
        const callName = syscalls['E7' + hex2(code)] || '';
        const info = callName
            ? `CODE ${hex2(code)}H = ${callName}`
            : `CODE ${hex2(code)}H`;
        const trace = `${hex4(pc)}: ${hex2(memRead(pc))} ${hex2(memRead(pc+1))}`;
        pushLine(out, labelStr, `.W ${targetLabel}`, info, trace);
    }
}

// ─── En-tête du fichier ────────────────────────────────────────────

const HEADER = `\t.TITLE SYS.SR
\t.PROC Z80
\t.REF  FLO

\t;SYS-MON V2.2 — PARTIE SYSTEME / MONITEUR DU SMAKY 6
\t;ZONE 0000H..0FFFH (4 KO, ORIGINELLEMENT 4 EPROMS TMS2716)

\t;SOURCE RECONSTITUE PAR REVERSE-ENGINEERING DU BINAIRE SYS.SY,
\t;DANS LE CADRE DU TRAVAIL DE CONSERVATION DES SMAKY
\t;FINANCE PAR EPSITEC SA.

\t;AUTEUR PRINCIPAL DE SAMOS : ALAIN CAPT (CONTROLEUR FLOPPY,
\t;FILE SYSTEM ET BEAUCOUP D'AUTRES PARTIES).
\t;D'AUTRES CONTRIBUTEURS QUE NOUS CHERCHONS A IDENTIFIER.

\t;CETTE VERSION SUPPORTE LE DISQUE DUR (CONTROLEUR WD1002) ET
\t;LES DISQUETTES MICROPOLIS (NON COUVERTES PAR LE SIMULATEUR
\t;A CE STADE). VERSION 2.2 DE SYS COMPLEMENTEE PAR SAMOS 2.2
\t;EN ZONE 1000H..22FFH (FICHIER SAMOS.SR SEPARE).



;DEBUT DU CODE SYS-MON
;=====================

`;

// ─── Construction ──────────────────────────────────────────────────

const out = [HEADER];

function emitData(out, from, to) {
    for (let pc = from; pc < to; pc++) {
        const labelStr = labels[pc] || '';
        const b = memRead(pc);
        const trace = `${hex4(pc)}: ${hex2(b)}`;
        pushLine(out, labelStr, `.B ${fmtByte(hex2(b) + 'h')}`, null, trace);
    }
}

for (const region of regions) {
    if (region.kind === 'code') {
        emitCode(out, region.from, region.to);
    } else if (region.kind === 'data') {
        emitData(out, region.from, region.to);
    } else if (region.kind === 'ptr-table-rst20h') {
        emitDispatchRST20H(out, region.from, region.to);
    } else {
        out.push(`;TODO region ${region.kind} ${hex4(region.from)}..${hex4(region.to)}`);
    }
}

out.push('');
out.push('\t.END');
out.push('');

const dest = path.join(__dirname, 'SYS.SR');
fs.writeFileSync(dest, out.join('\n'), { encoding: 'utf8' });
console.log('Écrit', dest, ':', out.length, 'lignes,', fs.statSync(dest).size, 'octets',
            EMIT_TRACE ? '(avec trace)' : '(sans trace)');
