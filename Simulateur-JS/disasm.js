'use strict';
// ═══════════════════════════════════════════════════════════════════
// Désassembleur Z80 — port de pyrz80desass.py
// disasmAt(memRead, pc) → { text, length }
//   memRead : (addr) => byte
// ═══════════════════════════════════════════════════════════════════

function disasmAt(memRead, pc) {
    const pc0 = pc & 0xFFFF;

    const u8  = (a) => memRead(a & 0xFFFF) & 0xFF;
    const s8  = (x) => { x &= 0xFF; return x & 0x80 ? x - 256 : x; };
    const u16 = (a) => u8(a) | (u8(a+1) << 8);
    const fmtN  = (x) => ((x & 0xFF).toString(16).toUpperCase().padStart(2,'0')) + 'h';
    const fmtNN = (x) => ((x & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')) + 'h';
    const fmtD  = (d) => { d = s8(d); return d >= 0 ? `+${d}` : `${d}`; };

    const R8  = ['B','C','D','E','H','L','(HL)','A'];
    const RP  = ['BC','DE','HL','SP'];
    const RP2 = ['BC','DE','HL','AF'];
    const CC  = ['NZ','Z','NC','C','PO','PE','P','M'];
    const ALU = ['ADD A,','ADC A,','SUB ','SBC A,','AND ','XOR ','OR ','CP '];
    const ROT = ['RLC','RRC','RL','RR','SLA','SRA','SLL','SRL'];

    function decodeCB(prefReg, base) {
        const op = u8(base), x = (op>>6)&3, y = (op>>3)&7, z = op&7;
        let reg = R8[z];
        if (prefReg !== null) {
            if (reg === '(HL)') reg = `(${prefReg})`;
            else if (reg === 'H' || reg === 'L') reg = '?';
        }
        if (x === 0) return [`${ROT[y]} ${reg}`, 1];
        if (x === 1) return [`BIT ${y},${reg}`, 1];
        if (x === 2) return [`RES ${y},${reg}`, 1];
        return [`SET ${y},${reg}`, 1];
    }

    function decodeDDFD(prefReg, base) {
        const op = u8(base);
        if (op === 0xCB) {
            const d = u8(base+1), op2 = u8(base+2);
            const x = (op2>>6)&3, y = (op2>>3)&7, z = op2&7;
            const reg = z === 6 ? `(${prefReg}${fmtD(d)})` : R8[z];
            if (x === 0) return [`${ROT[y]} ${reg}`, 3];
            if (x === 1) return [`BIT ${y},${reg}`, 3];
            if (x === 2) return [`RES ${y},${reg}`, 3];
            return [`SET ${y},${reg}`, 3];
        }
        if (op === 0x21) return [`LD ${prefReg},${fmtNN(u16(base+1))}`, 3];
        if (op === 0x22) return [`LD (${fmtNN(u16(base+1))}),${prefReg}`, 3];
        if (op === 0x2A) return [`LD ${prefReg},(${fmtNN(u16(base+1))})`, 3];
        if (op === 0xE5) return [`PUSH ${prefReg}`, 1];
        if (op === 0xE1) return [`POP ${prefReg}`, 1];
        if (op === 0xE9) return [`JP (${prefReg})`, 1];
        if (op === 0xF9) return [`LD SP,${prefReg}`, 1];
        if (op === 0xE3) return [`EX (SP),${prefReg}`, 1];
        if (op === 0x23) return [`INC ${prefReg}`, 1];
        if (op === 0x2B) return [`DEC ${prefReg}`, 1];

        if (op === 0x34 || op === 0x35 || op === 0x36) {
            const d = u8(base+1);
            if (op === 0x34) return [`INC (${prefReg}${fmtD(d)})`, 2];
            if (op === 0x35) return [`DEC (${prefReg}${fmtD(d)})`, 2];
            return [`LD (${prefReg}${fmtD(d)}),${fmtN(u8(base+2))}`, 3];
        }
        if (op >= 0x40 && op <= 0x7F && op !== 0x76) {
            const y = (op>>3)&7, z = op&7;
            let dst = R8[y], src = R8[z], d = null, size = 1;
            if (dst === '(HL)' || src === '(HL)') {
                d = u8(base+1); size = 2;
                if (dst === '(HL)') dst = `(${prefReg}${fmtD(d)})`;
                if (src === '(HL)') src = `(${prefReg}${fmtD(d)})`;
            }
            if (dst === 'H') dst = prefReg + 'H';
            else if (dst === 'L') dst = prefReg + 'L';
            if (src === 'H') src = prefReg + 'H';
            else if (src === 'L') src = prefReg + 'L';
            return [`LD ${dst},${src}`, size];
        }
        if ((op & 0xC7) === 0x46) { const y=(op>>3)&7, d=u8(base+1); return [`LD ${R8[y]},(${prefReg}${fmtD(d)})`, 2]; }
        if ((op & 0xC7) === 0x70) { const y=(op>>3)&7, d=u8(base+1); return [`LD (${prefReg}${fmtD(d)}),${R8[y]}`, 2]; }
        if ([0x09,0x19,0x29,0x39].includes(op)) { return [`ADD ${prefReg},${RP[(op>>4)&3]}`, 1]; }
        // ALU XYh/XYl (undocumented)
        if (op >= 0x80 && op <= 0xBF) {
            const y=(op>>3)&7, z=op&7;
            let src = R8[z];
            if (src === 'H') src = prefReg+'H';
            else if (src === 'L') src = prefReg+'L';
            return [`${ALU[y]}${src}`, 1];
        }
        return [`DB ${op.toString(16).toUpperCase().padStart(2,'0')}h`, 1];
    }

    const op = u8(pc0);

    // Préfixes
    if (op === 0xCB) { const [t,s] = decodeCB(null, pc0+1); return {text:t, length:s+1}; }
    if (op === 0xDD) { const [t,s] = decodeDDFD('IX', pc0+1); return {text:t, length:s+1}; }
    if (op === 0xFD) { const [t,s] = decodeDDFD('IY', pc0+1); return {text:t, length:s+1}; }
    if (op === 0xED) {
        const op2 = u8(pc0+1);
        const LD_nn_rr = {0x43:'BC',0x53:'DE',0x63:'HL',0x73:'SP'};
        const LD_rr_nn = {0x4B:'BC',0x5B:'DE',0x6B:'HL',0x7B:'SP'};
        if (LD_nn_rr[op2]) return {text:`LD (${fmtNN(u16(pc0+2))}),${LD_nn_rr[op2]}`, length:4};
        if (LD_rr_nn[op2]) return {text:`LD ${LD_rr_nn[op2]},(${fmtNN(u16(pc0+2))})`, length:4};
        const blk = {0xB0:'LDIR',0xB8:'LDDR',0xB1:'CPIR',0xB9:'CPDR',0xB2:'INIR',0xBA:'INDR',0xB3:'OTIR',0xBB:'OTDR',0xA0:'LDI',0xA8:'LDD',0xA1:'CPI',0xA9:'CPD',0xA2:'INI',0xAA:'IND',0xA3:'OUTI',0xAB:'OUTD'};
        if (blk[op2]) return {text:blk[op2], length:2};
        const misc = {0x57:'LD A,I',0x5F:'LD A,R',0x47:'LD I,A',0x4F:'LD R,A',0x67:'RRD',0x6F:'RLD',0x44:'NEG',0x45:'RETN',0x4D:'RETI'};
        if (misc[op2]) return {text:misc[op2], length:2};
        if ((op2&0xC7)===0x40) return {text:`IN ${R8[(op2>>3)&7]},(C)`, length:2};
        if ((op2&0xC7)===0x41) return {text:`OUT (C),${R8[(op2>>3)&7]}`, length:2};
        if ((op2&0xCF)===0x42) return {text:`SBC HL,${RP[(op2>>4)&3]}`, length:2};
        if ((op2&0xCF)===0x4A) return {text:`ADC HL,${RP[(op2>>4)&3]}`, length:2};
        const imMode = {0x46:0,0x4E:0,0x56:1,0x5E:2,0x66:0,0x6E:0,0x76:1,0x7E:2};
        if (imMode[op2] !== undefined) return {text:`IM ${imMode[op2]}`, length:2};
        return {text:`ED ${op2.toString(16).toUpperCase().padStart(2,'0')}h`, length:2};
    }

    // Instructions simples (par ordre de fréquence dans le ROM Smaky)
    if ((op&0xC7)===0x04) return {text:`INC ${R8[(op>>3)&7]}`, length:1};
    if ((op&0xC7)===0x05) return {text:`DEC ${R8[(op>>3)&7]}`, length:1};
    if (op===0x00) return {text:'NOP', length:1};
    if (op===0x07) return {text:'RLCA', length:1};
    if (op===0x0F) return {text:'RRCA', length:1};
    if (op===0x17) return {text:'RLA', length:1};
    if (op===0x1F) return {text:'RRA', length:1};
    if (op===0x76) return {text:'HALT', length:1};
    if (op===0xF3) return {text:'DI', length:1};
    if (op===0xFB) return {text:'EI', length:1};
    if (op===0xEB) return {text:'EX DE,HL', length:1};
    if (op===0x08) return {text:"EX AF,AF'", length:1};
    if (op===0xD9) return {text:'EXX', length:1};
    if (op===0xE9) return {text:'JP (HL)', length:1};
    if (op===0xF9) return {text:'LD SP,HL', length:1};
    if (op===0xE3) return {text:'EX (SP),HL', length:1};
    if (op===0x27) return {text:'DAA', length:1};
    if (op===0x2F) return {text:'CPL', length:1};
    if (op===0x37) return {text:'SCF', length:1};
    if (op===0x3F) return {text:'CCF', length:1};

    if ([0x09,0x19,0x29,0x39].includes(op)) return {text:`ADD HL,${RP[(op>>4)&3]}`, length:1};
    if ((op&0xCF)===0x03) return {text:`INC ${RP[(op>>4)&3]}`, length:1};
    if ((op&0xCF)===0x0B) return {text:`DEC ${RP[(op>>4)&3]}`, length:1};

    if ((op&0xC7)===0x06) { const y=(op>>3)&7; return {text:`LD ${R8[y]},${fmtN(u8(pc0+1))}`, length:2}; }
    if (op>=0x40&&op<=0x7F&&op!==0x76) { const y=(op>>3)&7,z=op&7; return {text:`LD ${R8[y]},${R8[z]}`, length:1}; }
    if ((op&0xCF)===0x01) { const p=(op>>4)&3; return {text:`LD ${RP[p]},${fmtNN(u16(pc0+1))}`, length:3}; }

    const ld1 = {0x02:'LD (BC),A',0x12:'LD (DE),A',0x0A:'LD A,(BC)',0x1A:'LD A,(DE)'};
    if (ld1[op]) return {text:ld1[op], length:1};

    if ([0x22,0x2A,0x32,0x3A].includes(op)) {
        const nn = fmtNN(u16(pc0+1));
        const t = {0x22:`LD (${nn}),HL`,0x2A:`LD HL,(${nn})`,0x32:`LD (${nn}),A`,0x3A:`LD A,(${nn})`};
        return {text:t[op], length:3};
    }

    // Sauts relatifs
    if ([0x18,0x20,0x28,0x30,0x38].includes(op)) {
        const d = u8(pc0+1), target = (pc0+2+s8(d))&0xFFFF;
        if (op===0x18) return {text:`JR ${fmtNN(target)}`, length:2};
        const c = {0x20:'NZ',0x28:'Z',0x30:'NC',0x38:'C'}[op];
        return {text:`JR ${c},${fmtNN(target)}`, length:2};
    }
    if (op===0x10) { const d=u8(pc0+1),t=(pc0+2+s8(d))&0xFFFF; return {text:`DJNZ ${fmtNN(t)}`, length:2}; }

    // Sauts absolus
    if (op===0xC3) return {text:`JP ${fmtNN(u16(pc0+1))}`, length:3};
    if ((op&0xC7)===0xC2) return {text:`JP ${CC[(op>>3)&7]},${fmtNN(u16(pc0+1))}`, length:3};
    if (op===0xCD) return {text:`CALL ${fmtNN(u16(pc0+1))}`, length:3};
    if ((op&0xC7)===0xC4) return {text:`CALL ${CC[(op>>3)&7]},${fmtNN(u16(pc0+1))}`, length:3};
    if (op===0xC9) return {text:'RET', length:1};
    if ((op&0xC7)===0xC0) return {text:`RET ${CC[(op>>3)&7]}`, length:1};

    // PUSH / POP
    if ((op&0xCF)===0xC1) return {text:`POP ${RP2[(op>>4)&3]}`, length:1};
    if ((op&0xCF)===0xC5) return {text:`PUSH ${RP2[(op>>4)&3]}`, length:1};

    // RST
    if ([0xC7,0xCF,0xD7,0xDF,0xE7,0xEF,0xF7,0xFF].includes(op)) return {text:`RST ${(op&0x38).toString(16).toUpperCase().padStart(2,'0')}h`, length:1};

    // ALU registre / immédiat
    if (op>=0x80&&op<=0xBF) return {text:`${ALU[(op>>3)&7]}${R8[op&7]}`, length:1};
    if ([0xC6,0xCE,0xD6,0xDE,0xE6,0xEE,0xF6,0xFE].includes(op)) return {text:`${ALU[(op>>3)&7]}${fmtN(u8(pc0+1))}`, length:2};

    // IN / OUT
    if (op===0xDB) return {text:`IN A,(${fmtN(u8(pc0+1))})`, length:2};
    if (op===0xD3) return {text:`OUT (${fmtN(u8(pc0+1))}),A`, length:2};

    return {text:`DB ${op.toString(16).toUpperCase().padStart(2,'0')}h`, length:1};
}

if (typeof module !== 'undefined') module.exports = { disasmAt };
else window.disasmAt = disasmAt;
