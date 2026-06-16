#!/usr/bin/env bash
# Programmation SRAM (volatile) du FPGA via OpenOCD + USB-Blaster.
# Régénère le SVF depuis le .sof courant, puis le charge dans le FPGA.
# Usage : ./program-sram.sh            (utilise SM6FPGA.sof du dossier courant)
#         ./program-sram.sh autre.sof
set -e
cd "$(dirname "$0")"
export PATH=/opt/altera9.1/quartus/bin:$PATH

SOF="${1:-SM6FPGA.sof}"
SVF="${SOF%.sof}.svf"

if [ ! -f "$SOF" ]; then echo "Introuvable : $SOF (compiler d'abord)"; exit 1; fi

echo ">> Génération du SVF depuis $SOF"
quartus_cpf -c -q 6.0MHz -g 3.3 -n p "$SOF" "$SVF" >/dev/null

echo ">> Programmation SRAM (volatile) via OpenOCD"
openocd -f openocd-blaster.cfg -c "svf -tap ep1c20.tap -progress $SVF" -c "shutdown"

echo ">> Terminé. (Configuration perdue à l'extinction.)"
