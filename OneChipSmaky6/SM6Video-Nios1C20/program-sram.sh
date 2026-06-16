#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export PATH=/opt/altera9.1/quartus/bin:$PATH
quartus_cpf -c -q 6.0MHz -g 3.3 -n p SM6Video.sof SM6Video.svf >/dev/null
openocd -f openocd-blaster.cfg -c "svf -tap ep1c20.tap -progress SM6Video.svf" -c "shutdown"
echo ">> Terminé."
