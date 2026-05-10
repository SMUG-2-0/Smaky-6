'use strict';
// ═══════════════════════════════════════════════════════════════════
// disasm_calm.js — transcodeur Zilog → CALM 1re génération (Smaky 6)
//
// Convertit la sortie de disasm.js (mnémoniques Zilog) en source CALM
// 1re gen tel qu'utilisé par l'assembleur du Smaky 6 (style horloge.sr).
//
// Conventions appliquées :
//  - LD     → LOAD       (ordre dest,source préservé)
//  - CP     → COMP       (avec ajout du A explicite : CP n → COMP A,n)
//  - JP/JR  → JUMP       (l'assembleur choisit l'encodage)
//  - DJNZ d → DECJ,NE B,d
//  - IN A,(n)  → LOAD A,$n_octal
//  - OUT (n),A → LOAD $n_octal,A
//  - SET n,A → OR  A,#B'mask    ;= SET n,A
//  - RES n,A → AND A,#B'mask    ;= RES n,A
//  - RRA/RLA → RR A / RL A      (forme avec opérande)
//  - EX DE,HL → EX HL,DE        (inversion d'opérandes)
//  - ADC/SBC → ADDC/SUBC
//  - Hex Zilog (XXh) → octal par défaut (1re gen) ou H'XX si > H'7F
//  - Adresses 16 bits : substitution par label si connu, sinon H'XXXX
//
// Sortie : { calm, comment } où comment peut contenir l'équivalent
// SET/RES/etc. pour permettre une substitution future.
// ═══════════════════════════════════════════════════════════════════

const { disasmAt } = require('../disasm.js');

// ─── Conversions de littéraux ──────────────────────────────────────

/** Convertit "XXh" Zilog en notation CALM 1re gen.
 *  Préfère l'octal pour les petites valeurs, hex H'XX pour les grandes.
 *  Si le contexte est immédiat (#), l'appelant ajoute le # devant. */
function fmtByte(zilogHex) {
    const n = parseInt(zilogHex.replace(/h$/i, ''), 16) & 0xFF;
    if (n <= 7) return n.toString();                       // 0..7 = octal sans ambiguïté
    if (n <= 63) return n.toString(8);                     // octal lisible
    // Sinon hex pour clarté
    return `H'${n.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Convertit "XXXXh" 16-bit en notation CALM 1re gen.
 *  Tente la substitution par symbole (labels), sinon H'XXXX. */
function fmtWord(zilogHex, labels) {
    const n = parseInt(zilogHex.replace(/h$/i, ''), 16) & 0xFFFF;
    if (labels && labels[n]) return labels[n];
    return `H'${n.toString(16).toUpperCase().padStart(4, '0')}`;
}

// ─── Mapping des conditions Zilog → CALM ───────────────────────────
// Zilog : NZ Z NC C PO PE P M
// CALM  : NE EQ CC CS PO PE PL MI  (LO/HS pour comparaison non signée)
const COND_MAP = {
    'NZ': 'NE', 'Z':  'EQ',
    'NC': 'CC', 'C':  'CS',
    'PO': 'PO', 'PE': 'PE',
    'P':  'PL', 'M':  'MI'
};

// ─── Transcodeur principal ─────────────────────────────────────────

/** Transcode une ligne Zilog en CALM 1re gen.
 *  Retourne { calm, extraComment } où extraComment ∈ string|null. */
function transcodeLine(zilogText, labels) {
    const t = zilogText.trim();

    // Pseudo-instructions sans opérande
    if (t === 'NOP')   return { calm: 'NOP', extraComment: null };
    if (t === 'HALT')  return { calm: 'HALT', extraComment: null };
    if (t === 'EXX')   return { calm: 'EXX', extraComment: null };
    if (t === 'DAA')   return { calm: 'DAA', extraComment: null };
    // Mnémoniques 1re gen confirmés
    if (t === 'DI')    return { calm: 'IOF', extraComment: null };   // disable interrupts
    if (t === 'EI')    return { calm: 'ION', extraComment: null };   // enable interrupts
    if (t === 'SCF')   return { calm: 'SETC', extraComment: null };  // CF := 1 (et N=0, H=0)
    // CCF : pas de mnémonique 1re gen connu. Note : SAMOS utilisait
    // OR A,A pour CF:=0 (clear), pas pour toggle. Les 0x3F dans le
    // binaire sont peut-être de la donnée mal interprétée. Émis brut
    // pour permettre la compilation.
    if (t === 'CCF')   return { calm: ".B H'3F", extraComment: 'CCF (toggle CF) - mnémonique 1re gen ?' };
    if (t === 'CPL')   return { calm: 'CPL A', extraComment: null };
    if (t === 'NEG')   return { calm: 'NEG A', extraComment: null };
    if (t === 'RET')   return { calm: 'RET', extraComment: null };
    if (t === "EX AF,AF'") return { calm: "EX AF,AF'", extraComment: null };
    if (t === 'EX DE,HL')  return { calm: 'EX HL,DE', extraComment: null };
    if (t === 'EX (SP),HL') return { calm: 'EX (SP),HL', extraComment: null };
    if (t === 'JP (HL)') return { calm: 'JUMP (HL)', extraComment: null };
    if (t === 'LD SP,HL') return { calm: 'LOAD SP,HL', extraComment: null };

    // Rotations sans opérande (8080-style) → forme CALM avec opérande
    if (t === 'RLCA') return { calm: 'RLC A', extraComment: null };
    if (t === 'RRCA') return { calm: 'RRC A', extraComment: null };
    if (t === 'RLA')  return { calm: 'RL A', extraComment: null };
    if (t === 'RRA')  return { calm: 'RR A', extraComment: null };

    // Block ops (Z80 ED-prefixed) — gardés tels quels
    if (['LDIR','LDDR','LDI','LDD','CPIR','CPDR','CPI','CPD',
         'INIR','INDR','INI','IND','OTIR','OTDR','OUTI','OUTD',
         'RRD','RLD','RETI','RETN'].includes(t)) {
        return { calm: t, extraComment: null };
    }
    if (/^IM \d$/.test(t)) return { calm: t, extraComment: null };

    // Mnémonique + opérandes
    const m = t.match(/^([A-Z]+)\s+(.*)$/);
    if (!m) return { calm: `;??? ${t}`, extraComment: null };
    const mnem = m[1];
    const args = m[2];

    // RET cond
    if (mnem === 'RET' && /^(NZ|Z|NC|C|PO|PE|P|M)$/.test(args)) {
        return { calm: `RET ${COND_MAP[args]}`, extraComment: null };
    }

    // RST n → garde tel quel pour l'instant (peut être reconnu comme syscall en amont)
    if (mnem === 'RST') {
        return { calm: `RST ${args}`, extraComment: null };
    }

    // CALL [cond,]addr
    if (mnem === 'CALL') {
        const m2 = args.match(/^(NZ|Z|NC|C|PO|PE|P|M),([0-9A-F]+h)$/i);
        if (m2) {
            return { calm: `CALL ${COND_MAP[m2[1]]},${fmtWord(m2[2], labels)}`, extraComment: null };
        }
        const m3 = args.match(/^([0-9A-F]+h)$/i);
        if (m3) return { calm: `CALL ${fmtWord(m3[1], labels)}`, extraComment: null };
    }

    // JP/JR [cond,]addr → JUMP [cond,]addr
    if (mnem === 'JP' || mnem === 'JR') {
        const m2 = args.match(/^(NZ|Z|NC|C|PO|PE|P|M),([0-9A-F]+h)$/i);
        if (m2) {
            return { calm: `JUMP ${COND_MAP[m2[1]]},${fmtWord(m2[2], labels)}`, extraComment: null };
        }
        const m3 = args.match(/^([0-9A-F]+h)$/i);
        if (m3) return { calm: `JUMP ${fmtWord(m3[1], labels)}`, extraComment: null };
    }

    // DJNZ addr → DECJ,NE B,addr
    if (mnem === 'DJNZ') {
        return { calm: `DECJ,NE B,${fmtWord(args, labels)}`, extraComment: null };
    }

    // IN A,(n) → LOAD A,$n
    if (mnem === 'IN') {
        const m2 = args.match(/^A,\(([0-9A-F]+h)\)$/i);
        if (m2) return { calm: `LOAD A,$${fmtByte(m2[1])}`, extraComment: null };
        // IN r,(C) — Z80 ED-prefix
        const m3 = args.match(/^(\w+),\(C\)$/);
        if (m3) return { calm: `LOAD ${m3[1]},$(C)`, extraComment: '?? IN r,(C) — vérifier syntaxe CALM' };
    }
    // OUT (n),A → LOAD $n,A
    if (mnem === 'OUT') {
        const m2 = args.match(/^\(([0-9A-F]+h)\),A$/i);
        if (m2) return { calm: `LOAD $${fmtByte(m2[1])},A`, extraComment: null };
        const m3 = args.match(/^\(C\),(\w+)$/);
        if (m3) return { calm: `LOAD $(C),${m3[1]}`, extraComment: '?? OUT (C),r — vérifier syntaxe CALM' };
    }

    // SET n,A | RES n,A → OR/AND avec masque (équivalent fonctionnel)
    // SET n,r autre que A : pas d'équivalent simple en 1re gen → TODO
    if (mnem === 'SET' || mnem === 'RES') {
        const m2 = args.match(/^(\d+),(.+)$/);
        if (m2) {
            const n = parseInt(m2[1], 10);
            const target = m2[2];
            if (target === 'A') {
                const mask = mnem === 'SET'
                    ? (1 << n) & 0xFF
                    : (~(1 << n)) & 0xFF;
                const op = mnem === 'SET' ? 'OR ' : 'AND';
                return {
                    calm: `${op} A,#B'${mask.toString(2).padStart(8, '0')}`,
                    extraComment: `= ${mnem} ${n},A`
                };
            }
            // Pour (HL), B, C, etc. : pas de raccourci mnémonique CALM 1re gen.
            // Forme habituelle : passage par A (3 instructions).
            return {
                calm: `;TODO ${mnem} ${n},${target}`,
                extraComment: `LOAD A,${target} ; OR/AND A,#mask ; LOAD ${target},A`
            };
        }
    }
    if (mnem === 'BIT') {
        // BIT n,r teste le bit sans modifier r ; pas d'équivalent direct.
        return {
            calm: `;TODO BIT ${args}`,
            extraComment: 'tester bit sans modifier r (équivalent : AND avec mask sur copie A)'
        };
    }

    // LD avec différents cas
    if (mnem === 'LD') {
        return transcodeLD(args, labels);
    }

    // CP n → COMP A,n  (Zilog CP n = CP A,n)
    if (mnem === 'CP') {
        const arg = transformImmOrReg(args, labels);
        return { calm: `COMP A,${arg}`, extraComment: null };
    }

    // ADD HL,rr / ADD IX,rr / ADD IY,rr : 16-bit add, garder tel quel
    if (mnem === 'ADD' && /^(HL|IX|IY),/.test(args)) {
        return { calm: `ADD ${args}`, extraComment: null };
    }
    // ADC HL,rr / SBC HL,rr (Z80 ED-prefixed) : 16-bit, idem
    if ((mnem === 'ADC' || mnem === 'SBC') && /^HL,/.test(args)) {
        return { calm: `${mnem === 'ADC' ? 'ADDC' : 'SUBC'} ${args}`, extraComment: null };
    }

    // ADC, SBC, ADD, SUB, AND, OR, XOR sur A : traduire opérandes
    if (['ADD', 'SUB', 'AND', 'OR', 'XOR'].includes(mnem)) {
        return { calm: `${mnem} ${transcodeAluArgs(args, labels)}`, extraComment: null };
    }
    if (mnem === 'ADC') return { calm: `ADDC ${transcodeAluArgs(args, labels)}`, extraComment: null };
    if (mnem === 'SBC') return { calm: `SUBC ${transcodeAluArgs(args, labels)}`, extraComment: null };

    // INC, DEC : juste passer le registre
    if (mnem === 'INC' || mnem === 'DEC') {
        return { calm: `${mnem} ${args}`, extraComment: null };
    }

    // Rotations (Z80 CB-prefixed) : RLC, RRC, RL, RR
    if (['RLC','RRC','RL','RR'].includes(mnem)) {
        return { calm: `${mnem} ${args}`, extraComment: null };
    }
    // Shift/rotate CALM 1re gen : SL, SLC, RL, RLC (et SR, SRC, RR, RRC).
    // Mapping confirmé/déduit :
    //   Zilog SLA → CALM SL  (shift left arithmétique, LSB := 0)
    //   Zilog SLL → CALM SLC (undocumented, shift left "carry-fill" / circular)
    //   Zilog SRA → CALM SR  (shift right arithmétique, MSB préservé)  — À CONFIRMER
    //   Zilog SRL → CALM SRC (shift right logique, MSB := 0)            — À CONFIRMER
    if (mnem === 'SLA') return { calm: `SL ${args}`,  extraComment: null };
    if (mnem === 'SLL') return { calm: `SLC ${args}`, extraComment: null };
    if (mnem === 'SRA') return { calm: `SR ${args}`,  extraComment: '?? CALM 1re gen à confirmer' };
    if (mnem === 'SRL') return { calm: `SRC ${args}`, extraComment: '?? CALM 1re gen à confirmer' };

    // PUSH, POP : registre seul
    if (mnem === 'PUSH' || mnem === 'POP') {
        return { calm: `${mnem} ${args}`, extraComment: null };
    }

    // EX (cas non-canoniques)
    if (mnem === 'EX') {
        return { calm: `EX ${args}`, extraComment: null };
    }

    // DB nn — donnée brute
    if (mnem === 'DB') {
        return { calm: `.B ${fmtByte(args)}`, extraComment: null };
    }

    // Fallback : recopier brut avec marqueur
    return { calm: `;??? ${t}`, extraComment: null };
}

// ─── Transcodage spécifique LD ─────────────────────────────────────

function transcodeLD(args, labels) {
    // Cas LD r1,r2 (purement registres, pas de translation)
    if (/^[A-Z]{1,3}('|),[A-Z]{1,3}('|)$/.test(args.replace(/'/g, ''))) {
        return { calm: `LOAD ${args}`, extraComment: null };
    }

    // LD (HL),imm   ou   LD r,imm
    let m = args.match(/^([A-Z]+|\([A-Z]+\)|\([A-Z]+[+-]\d+\)),([0-9A-F]+h)$/i);
    if (m) {
        const dst = m[1], imm = m[2];
        const n = parseInt(imm.replace(/h$/i, ''), 16);
        // Si destination est un registre 8 bits ou (HL), c'est immédiat 8 bits
        // Si destination est un pair 16 bits, c'est immédiat 16 bits (et peut être un label)
        if (['BC','DE','HL','SP','IX','IY'].includes(dst)) {
            // Immédiat 16 bits (peut référencer un label)
            const v = fmtWord(imm, labels);
            return { calm: `LOAD ${dst},#${v}`, extraComment: null };
        }
        return { calm: `LOAD ${dst},#${fmtByte(imm)}`, extraComment: null };
    }

    // LD r,(REG)  ou  LD (REG),r
    m = args.match(/^([A-Z]+),\(([A-Z]+)\)$/);
    if (m) return { calm: `LOAD ${m[1]},(${m[2]})`, extraComment: null };
    m = args.match(/^\(([A-Z]+)\),([A-Z]+)$/);
    if (m) return { calm: `LOAD (${m[1]}),${m[2]}`, extraComment: null };

    // LD r,(addr16) ou LD (addr16),r — adresse mémoire absolue, pas de parens en CALM 1re gen
    m = args.match(/^([A-Z]+),\(([0-9A-F]+h)\)$/i);
    if (m) return { calm: `LOAD ${m[1]},${fmtWord(m[2], labels)}`, extraComment: null };
    m = args.match(/^\(([0-9A-F]+h)\),([A-Z]+)$/i);
    if (m) return { calm: `LOAD ${fmtWord(m[1], labels)},${m[2]}`, extraComment: null };

    // LD r,(IX+d) / (IY+d)
    m = args.match(/^([A-Z]+),\(([IXY]{2})([+-]\d+)\)$/);
    if (m) return { calm: `LOAD ${m[1]},(${m[2]}${m[3]})`, extraComment: null };
    m = args.match(/^\(([IXY]{2})([+-]\d+)\),(.+)$/);
    if (m) return { calm: `LOAD (${m[1]}${m[2]}),${m[3]}`, extraComment: null };

    // Fallback
    return { calm: `LOAD ${args}`, extraComment: '?? cas LD non reconnu' };
}

// ─── Transcodage des opérandes ALU (ADD A,r ; OR n ; etc.) ─────────
// Zilog : ALU [A,]r  OU  ALU n
// CALM : ALU A,r  ou  ALU A,#n  (ajoute A explicite si manquant)
function transcodeAluArgs(args, labels) {
    // "A,r" -> "A,r"
    // "r"  -> "A,r"
    // "n"   (Zilog hex) -> "A,#n_octal"
    if (/^A,/.test(args)) {
        // Déjà avec A explicite, on ajuste le reste
        const rest = args.substring(2);
        return `A,${transformImmOrReg(rest, labels)}`;
    }
    return `A,${transformImmOrReg(args, labels)}`;
}

function transformImmOrReg(arg, labels) {
    // hex byte → #octal ou #H'XX
    let m = arg.match(/^([0-9A-F]+h)$/i);
    if (m) return `#${fmtByte(m[1])}`;
    // sinon, c'est un registre ou (HL), on garde
    return arg;
}

// ─── Module export ─────────────────────────────────────────────────

module.exports = { transcodeLine, fmtByte, fmtWord, COND_MAP };
