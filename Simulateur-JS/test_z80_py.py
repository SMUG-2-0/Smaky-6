"""
Comparaison Python z80 vs JS Z80 (via execjs ou subprocess).
Ici : exécute 100 instructions avec la lib Python et affiche l'état,
pour servir de référence à valider manuellement vs le test JS.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import z80

cpu = z80.Z80Machine()
cpu.set_input_callback(lambda p: 0)
cpu.set_output_callback(lambda p, v: None)

with open('../ROM18.bin', 'rb') as f:
    cpu.set_memory_block(0, f.read())

# Exécuter 100 instructions pas-à-pas
for _ in range(100):
    cpu.ticks_to_stop = 4
    cpu.run()

f = cpu.f
flags = ''.join([
    'S' if f&0x80 else '-', 'Z' if f&0x40 else '-',
    'Y' if f&0x20 else '-', 'H' if f&0x10 else '-',
    'X' if f&0x08 else '-', 'P' if f&0x04 else '-',
    'N' if f&0x02 else '-', 'C' if f&0x01 else '-',
])
print(f"Après 100 instructions :")
print(f"PC={cpu.pc:04X} SP={cpu.sp:04X}")
print(f"AF={cpu.af:04X} BC={cpu.bc:04X} DE={cpu.de:04X} HL={cpu.hl:04X}")
print(f"IX={cpu.ix:04X} IY={cpu.iy:04X}")
print(f"FLAGS: {flags}")
iff1 = cpu._Z80State__iff1[0]
iff2 = cpu._Z80State__iff2[0]
im   = cpu._Z80State__int_mode[0]
print(f"IFF1={iff1} IFF2={iff2} IM={im} HALTED={cpu.halted}")
print(f"mem[0..7]: {' '.join(f'{cpu.memory[i]:02X}' for i in range(8))}")
