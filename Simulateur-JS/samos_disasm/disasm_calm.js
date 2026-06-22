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

/** Convertit "XXh" Zilog en notation CALM 1re gen (octal, base par défaut). */
function fmtByte(zilogHex) {
    const n = parseInt(zilogHex.replace(/h$/i, ''), 16) & 0xFF;
    return n.toString(8);
}

/** Convertit "XXXXh" 16-bit en notation CALM 1re gen (label si connu, sinon octal). */
function fmtWord(zilogHex, labels) {
    const n = parseInt(zilogHex.replace(/h$/i, ''), 16) & 0xFFFF;
    if (labels && labels[n]) return labels[n];
    return n.toString(8);
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
 *  Retourne { calm, extraComment, rawBytes? } où :
 *   - extraComment ∈ string|null
 *   - rawBytes : true → l'appelant doit émettre des .B à la place de calm
 *     (utilisé pour les mnémoniques 1re gen non encore élucidés). */
function transcodeLine(zilogText, labels) {
    const r = transcodeLineImpl(zilogText, labels);
    if (r.calm) {
        // CALM 1re gen : déplacement nul s'écrit (IX) et non (IX+0)
        r.calm = r.calm.replace(/\((IX|IY)\+0\)/g, '($1)');
        // CALM 1re gen : déplacement non-nul s'écrit (IX)+xx et non (IX+xx)
        // ET le nombre est en octal par défaut (sinon mettre suffixe ".").
        // Le désassembleur Zilog produit le déplacement en décimal, on
        // convertit donc en octal.
        r.calm = r.calm.replace(/\((IX|IY)([+-])(\d+)\)/g,
            (_, reg, sign, num) => `(${reg})${sign}${parseInt(num, 10).toString(8)}`);
    }
    return r;
}

function transcodeLineImpl(zilogText, labels) {
    const t = zilogText.trim();

    // Pseudo-instructions sans opérande
    if (t === 'NOP')   return { calm: 'NOP', extraComment: null };
    if (t === 'HALT')  return { calm: 'HALT', extraComment: null };
    if (t === 'EXX')   return { calm: 'EX BL', extraComment: null };
    if (t === 'DAA')   return { calm: 'DAA A', extraComment: null };
    // Rotations BCD nibble (ED 6F / ED 67) : pas de mnémonique 1re gen
    // connu. Émis en .B brut en attendant la documentation.
    if (t === 'RLD')   return { calm: null, rawBytes: true, extraComment: 'RLD (rotation nibble BCD A↔(HL)) — mnémonique 1re gen ?' };
    if (t === 'RRD')   return { calm: null, rawBytes: true, extraComment: 'RRD (rotation nibble BCD A↔(HL)) — mnémonique 1re gen ?' };
    // OTIR : opcode block-out répété (ED B3) — mnémonique 1re gen confirmé OUTIR
    if (t === 'OTIR')  return { calm: 'OUTIR', extraComment: null };
    if (t === 'OTDR')  return { calm: 'OUTDR', extraComment: '?? mnémonique 1re gen à confirmer' };
    // Mnémoniques 1re gen confirmés
    if (t === 'DI')    return { calm: 'IOF', extraComment: null };   // disable interrupts
    if (t === 'EI')    return { calm: 'ION', extraComment: null };   // enable interrupts
    if (t === 'SCF')   return { calm: 'SETC', extraComment: null };  // CF := 1 (et N=0, H=0)
    // CCF : pas de mnémonique 1re gen connu. Note : SAMOS utilisait
    // OR A,A pour CF:=0 (clear), pas pour toggle. Les 0x3F dans le
    // binaire sont peut-être de la donnée mal interprétée. Émis brut
    // pour permettre la compilation.
    if (t === 'CCF')   return { calm: '.B 77', extraComment: 'CCF (toggle CF) - mnémonique 1re gen ?' };
    if (t === 'CPL')   return { calm: 'CPL A', extraComment: null };
    if (t === 'NEG')   return { calm: 'NEG A', extraComment: null };
    if (t === 'RET')   return { calm: 'RET', extraComment: null };
    if (t === "EX AF,AF'") return { calm: 'EX AF', extraComment: null };
    if (t === 'EX DE,HL')  return { calm: 'EX HL,DE', extraComment: null };
    if (t === 'EX (SP),HL') return { calm: 'EX (SP),HL', extraComment: null };
    if (t === 'JP (HL)') return { calm: 'JUMP (HL)', extraComment: null };
    if (t === 'LD SP,HL') return { calm: 'LOAD SP,HL', extraComment: null };

    // Rotations 8080 (1 byte) — ATTENTION : la convention CALM est inversée
    // par rapport à Zilog. En CALM le "C" final = "through Carry" (avec
    // retenue) ; en Zilog le "C" = "Circular" (sans retenue).
    //   Zilog RLCA (07, circular) → CALM RL A  (sans C)
    //   Zilog RRCA (0F, circular) → CALM RR A  (sans C)
    //   Zilog RLA  (17, w/carry)  → CALM RLC A (avec C)
    //   Zilog RRA  (1F, w/carry)  → CALM RRC A (avec C)
    if (t === 'RLCA') return { calm: 'RL A',  extraComment: null };
    if (t === 'RRCA') return { calm: 'RR A',  extraComment: null };
    if (t === 'RLA')  return { calm: 'RLC A', extraComment: null };
    if (t === 'RRA')  return { calm: 'RRC A', extraComment: null };

    // Block ops (Z80 ED-prefixed) — gardés tels quels (OTIR/OTDR/RLD/RRD
    // sont traités plus haut)
    if (['LDIR','LDDR','LDI','LDD','CPIR','CPDR','CPI','CPD',
         'INIR','INDR','INI','IND','OUTI','OUTD',
         'RETI','RETN'].includes(t)) {
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

    // RST n → octal (base par défaut en CALM 1re gen)
    if (mnem === 'RST') {
        const m = args.match(/^([0-9A-F]+)h$/i);
        if (m) {
            const n = parseInt(m[1], 16) & 0xFF;
            return { calm: `RST ${n.toString(8)}`, extraComment: null };
        }
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

    // JP  → JUMP  [cond,]addr   (absolu, 3 octets)
    // JR  → JUMP. [cond,]addr   (relatif court, 2 octets — le "." force la
    // forme courte sur sauts en avant ; sur sauts en arrière l'assembleur
    // CALM 1re gen choisit déjà le relatif automatiquement, mais le "."
    // ne nuit pas et garde le mapping 1:1 avec le binaire source.)
    if (mnem === 'JP' || mnem === 'JR') {
        const suffix = (mnem === 'JR') ? '.' : '';
        const m2 = args.match(/^(NZ|Z|NC|C|PO|PE|P|M),([0-9A-F]+h)$/i);
        if (m2) {
            return { calm: `JUMP${suffix} ${COND_MAP[m2[1]]},${fmtWord(m2[2], labels)}`, extraComment: null };
        }
        const m3 = args.match(/^([0-9A-F]+h)$/i);
        if (m3) return { calm: `JUMP${suffix} ${fmtWord(m3[1], labels)}`, extraComment: null };
    }

    // DJNZ addr → DECJ,NE B,addr
    if (mnem === 'DJNZ') {
        return { calm: `DECJ,NE B,${fmtWord(args, labels)}`, extraComment: null };
    }

    // IN A,(n) → LOAD A,$n
    if (mnem === 'IN') {
        const m2 = args.match(/^A,\(([0-9A-F]+h)\)$/i);
        if (m2) return { calm: `LOAD A,$${fmtByte(m2[1])}`, extraComment: null };
        // IN (HL),(C) : forme non documentée Z80 (ED 70) qui ne stocke rien et
        // n'affecte que les flags. Le désassembleur l'émet ainsi car (HL) est
        // l'entrée R8[6] sans signification réelle. CALM 1re gen : TEST $(C).
        // Confirmé via OCR du source SAMOS 1-E (routine WRBL1/WRBL2, polling DRQ).
        if (args === '(HL),(C)') {
            return { calm: 'TEST $(C)', extraComment: '= IN F,(C) (Z80 undoc., ED 70)' };
        }
        // IN r,(C) — Z80 ED-prefix (documenté)
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

    // BIT n,r / SET n,r / RES n,r : CALM 1re gen utilise la syntaxe
    // « TEST/SET/CLR cible:n » où n est le RANG du bit (0..7), PAS le masque.
    // Confirmé via OCR du source SAMOS 1-E (TEST A:TBITAC, CLR (HL):TBITOP,
    // SET A:TBITAC) où les TBITxx sont définis par EQU avec des valeurs 0..7
    // (rang du bit), et confirmé par l'utilisateur (PYR).
    if (mnem === 'BIT' || mnem === 'SET' || mnem === 'RES') {
        const m2 = args.match(/^(\d+),(.+)$/);
        if (m2) {
            const bit = parseInt(m2[1], 10);
            const reg = m2[2];
            const calmMnem = mnem === 'BIT' ? 'TEST' : (mnem === 'RES' ? 'CLR' : 'SET');
            return {
                calm: `${calmMnem} ${reg}:${bit}`,
                extraComment: `= ${mnem} ${bit},${reg}`
            };
        }
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

    // Rotations Z80 CB-prefixed : RLC/RRC/RL/RR
    // Mapping CALM (rappel : "C" = through Carry en CALM, l'inverse de Zilog) :
    //   Zilog RLC r → CALM RL r   (CB 0X, circular)
    //   Zilog RRC r → CALM RR r   (CB 0X+8, circular)
    //   Zilog RL r  → CALM RLC r  (CB 1X, through carry)
    //   Zilog RR r  → CALM RRC r  (CB 1X+8, through carry)
    // Pour A en forme CB-prefixed (Z80, 2 bytes), il faut préfixer Z, sinon
    // CALM choisit la forme 8080 courte (1 byte). Note (4) de Z80.DOK.
    const ROT_SWAP = { RLC: 'RL', RL: 'RLC', RRC: 'RR', RR: 'RRC' };
    if (mnem in ROT_SWAP) {
        const calmMnem = ROT_SWAP[mnem];
        if (args === 'A') {
            return { calm: `Z${calmMnem} A`, extraComment: null };
        }
        return { calm: `${calmMnem} ${args}`, extraComment: null };
    }
    // Shifts CALM 1re gen — convention :
    //   suffixe `C` = Clear (insère 0 dans le bit libéré)
    //   préfixe `A` = Arithmetic (préserve signe, uniquement utile à droite)
    //   Validé via SMILE par PYR le 14/05/2026 :
    //     Zilog SLA r → CALM SLC r  (CB 2X, shift left, 0 → bit 0)
    //     Zilog SRA r → CALM ASR r  (CB 2X+8, préserve bit 7)
    //     Zilog SRL r → CALM SRC r  (CB 3X+8, 0 → bit 7)
    //   `ASL r` n'existe PAS (CALM élimine la redondance : aucun bit de signe
    //   à préserver lors d'un shift left, donc un seul mnémonique = SLC).
    //   `SLL r` (Zilog undoc., 1 → bit 0) : pas de mnémonique CALM connu → .B brut.
    if (mnem === 'SLA') return { calm: `SLC ${args}`, extraComment: null };
    if (mnem === 'SRA') return { calm: `ASR ${args}`, extraComment: null };
    if (mnem === 'SRL') return { calm: `SRC ${args}`, extraComment: null };
    if (mnem === 'SLL') return { calm: null, rawBytes: true, extraComment: `SLL ${args} (Z80 undoc., CB 3X) — pas de mnémonique 1re gen connu` };

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
