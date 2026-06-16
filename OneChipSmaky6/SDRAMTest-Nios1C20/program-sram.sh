#!/usr/bin/env bash
# Programmation SRAM (volatile) de l'autotest SDRAM via OpenOCD + USB-Blaster.
set -e
cd "$(dirname "$0")"
export PATH=/opt/altera9.1/quartus/bin:$PATH
quartus_cpf -c -q 6.0MHz -g 3.3 -n p SDRAM.sof SDRAM.svf >/dev/null
echo ">> Programmation SRAM via OpenOCD"
openocd -f openocd-blaster.cfg -c "svf -tap ep1c20.tap -progress SDRAM.svf" -c "shutdown"
echo ">> Terminé."
