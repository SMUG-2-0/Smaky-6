// Test rapide du Z80 en Node.js
// Usage: node test_z80.js

const fs = require('fs');
const Z80 = require('./z80.js');

const cpu = new Z80();

// Charger la ROM
const rom = fs.readFileSync('../ROM18.bin');
for (let i = 0; i < rom.length && i < 65536; i++) cpu.mem[i] = rom[i];

// Callbacks I/O minimaux
cpu.onInput  = (port) => 0;
cpu.onOutput = (port, val) => {};

// Exécuter 100 instructions et afficher l'état
let ticks = 0;
for (let i = 0; i < 100; i++) {
    const pc = cpu.pc;
    cpu.ticksToStop = 4;
    cpu.run();
    ticks += 4;
}

const f = cpu.f;
const flags = [
    f&0x80?'S':'-', f&0x40?'Z':'-', f&0x20?'Y':'-', f&0x10?'H':'-',
    f&0x08?'X':'-', f&0x04?'P':'-', f&0x02?'N':'-', f&0x01?'C':'-'
].join('');

console.log(`Après 100 instructions :`);
console.log(`PC=${cpu.pc.toString(16).padStart(4,'0').toUpperCase()} SP=${cpu.sp.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`AF=${cpu.af.toString(16).padStart(4,'0').toUpperCase()} BC=${cpu.bc.toString(16).padStart(4,'0').toUpperCase()} DE=${cpu.de.toString(16).padStart(4,'0').toUpperCase()} HL=${cpu.hl.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`IX=${cpu.ix.toString(16).padStart(4,'0').toUpperCase()} IY=${cpu.iy.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`FLAGS: ${flags}`);
console.log(`IFF1=${cpu.iff1} IFF2=${cpu.iff2} IM=${cpu.im} HALTED=${cpu.halted}`);
console.log(`mem[0x0000..7]: ${Array.from(cpu.mem.slice(0,8)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);
console.log('Z80 OK');
