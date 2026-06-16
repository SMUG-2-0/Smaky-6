# Contraintes de timing — SM6FPGA sur Nios Development Board (EP1C20F400C7)
# Horloge de la carte : oscillateur 50 MHz sur CLK0 (PIN_K5) -> periode 20.000 ns
# (Le Smaky d'origine tourne a 21.47727 MHz ; ici on tourne directement a 50 MHz,
#  ce qui accelere le clignotement d'un facteur 50/21.47 ~ 2.33x -> ~2 Hz, bien visible.)

create_clock -name clk -period 20.000 [get_ports clk]
