// Test rapide de smaky.js
// Usage: node test_smaky.js

'use strict';
const fs = require('fs');
const { Smaky } = require('./smaky.js');

const sim = new Smaky();
sim.loadROM(fs.readFileSync('../ROM18.bin'));

// Simuler 100 instructions pas-à-pas
const cpu = sim.cpu;
for (let i = 0; i < 100; i++) {
    cpu.ticksToStop = 4;
    cpu.run();
}

const st = sim.getCpuState();
console.log('Après 100 instructions :');
console.log(`PC=${st.pc.toString(16).padStart(4,'0').toUpperCase()} SP=${st.sp.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`AF=${st.af.toString(16).padStart(4,'0').toUpperCase()} BC=${st.bc.toString(16).padStart(4,'0').toUpperCase()}`);
const f = st.flags;
const fStr = [f.S?'S':'-',f.Z?'Z':'-',f.Y?'Y':'-',f.H?'H':'-',f.X?'X':'-',f.P?'P':'-',f.N?'N':'-',f.C?'C':'-'].join('');
console.log(`FLAGS: ${fStr}`);

// Vérification
const ok = st.pc === 0x00FD && st.sp === 0x45FE && st.af === 0x0044 && st.bc === 0xA200 && !f.S && f.Z && !f.H && f.P && !f.N && !f.C;
console.log(ok ? 'smaky.js OK' : 'smaky.js FAILED');

// Test désassemblage depuis l'état courant
console.log('\nDésassemblage à PC courant :');
let pc = st.pc;
for (let i = 0; i < 5; i++) {
    const { text, length } = sim.disasmAt(pc);
    const bytes = Array.from({length}, (_, j) => sim.memRead(pc+j).toString(16).padStart(2,'0')).join(' ');
    console.log(`  ${pc.toString(16).padStart(4,'0').toUpperCase()}  ${bytes.padEnd(12)}  ${text}`);
    pc = (pc + length) & 0xFFFF;
}

// Test écran texte (doit être vide/zéros après boot)
const screen = sim.getTextScreen();
const firstRow = screen[0].map(c => c.ch).join('');
console.log(`\nLigne 0 écran: "${firstRow.slice(0, 32)}"...`);
