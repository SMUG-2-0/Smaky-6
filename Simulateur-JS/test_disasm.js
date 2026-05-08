// Test du désassembleur Z80
// Usage: node test_disasm.js

'use strict';
const fs = require('fs');
const { disasmAt } = require('./disasm.js');

const rom = fs.readFileSync('../ROM18.bin');
const memRead = (a) => rom[a & 0xFFFF] ?? 0;

// Désassembler les 16 premières instructions depuis 0x0000
let pc = 0x0000;
console.log('Désassemblage ROM18.bin depuis 0x0000 :');
for (let i = 0; i < 16; i++) {
    const { text, length } = disasmAt(memRead, pc);
    const bytes = Array.from({length}, (_, j) => memRead(pc+j).toString(16).padStart(2,'0')).join(' ');
    console.log(`${pc.toString(16).padStart(4,'0').toUpperCase()}  ${bytes.padEnd(12)}  ${text}`);
    pc += length;
}

// Vérifications attendues pour les premiers octets F3 31 00 46 C3 3B 00 00
const expected = [
    { pc: 0x0000, text: 'DI',          length: 1 },
    { pc: 0x0001, text: 'LD SP,4600h', length: 3 },
    { pc: 0x0004, text: 'JP 003Bh',    length: 3 },
];

console.log('\nVérifications :');
let ok = true;
for (const e of expected) {
    const r = disasmAt(memRead, e.pc);
    const pass = r.text === e.text && r.length === e.length;
    console.log(`  ${pass ? 'OK' : 'FAIL'} ${e.pc.toString(16).padStart(4,'0').toUpperCase()}: got "${r.text}" len=${r.length}, expected "${e.text}" len=${e.length}`);
    if (!pass) ok = false;
}
console.log(ok ? '\ndisasm OK' : '\ndisasm FAILED');
