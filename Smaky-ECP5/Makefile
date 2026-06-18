# ===========================================================================
# Squelette de build ECP5 libre — Colorlight 5A-75B
#   GHDL (VHDL) -> Yosys (synth_ecp5) -> nextpnr-ecp5 -> ecppack -> openFPGALoader
# Tout vient de l'OSS CAD Suite (https://github.com/YosysHQ/oss-cad-suite-build).
# ===========================================================================

# ---- Projet ----
TOP       = top
VHDL_SRCS = top.vhd            # ajouter les fichiers VHDL dans l'ORDRE des dépendances
LPF       = colorlight_5a_75b.lpf

# ---- Cible ECP5 (LFE5U-25F-6BG256) ----
DEVICE    = 25k                # 25k | 45k | 85k
PACKAGE   = CABGA256
SPEED     = 6
VHDL_STD  = 08                 # VHDL-2008

# ---- Sonde de programmation (FT232H par défaut ; voir : openFPGALoader --list-cables) ----
CABLE     = ft232

# ---- Outils ----
YOSYS     = yosys
NEXTPNR   = nextpnr-ecp5
ECPPACK   = ecppack
OFL       = openFPGALoader

# ===========================================================================
all: $(TOP).bit

# 1) Analyse VHDL (GHDL) + synthèse (Yosys, plugin ghdl) -> netlist JSON
$(TOP).json: $(VHDL_SRCS)
	$(YOSYS) -m ghdl -p "ghdl --std=$(VHDL_STD) $(VHDL_SRCS) -e $(TOP); synth_ecp5 -top $(TOP) -json $@"

# 2) Placement / routage -> config texte
$(TOP)_out.config: $(TOP).json $(LPF)
	$(NEXTPNR) --$(DEVICE) --package $(PACKAGE) --speed $(SPEED) \
	           --json $(TOP).json --lpf $(LPF) --textcfg $@

# 3) Génération du bitstream
$(TOP).bit: $(TOP)_out.config
	$(ECPPACK) --compress $< $@

# ---- Programmation en SRAM (volatile, rechargé à chaque power-up) ----
prog: $(TOP).bit
	$(OFL) -c $(CABLE) $(TOP).bit

# ---- Écriture en flash SPI (démarrage autonome) ----
flash: $(TOP).bit
	$(OFL) -c $(CABLE) -f $(TOP).bit

# ---- Détection JTAG (vérifier que la sonde voit l'ECP5) ----
detect:
	$(OFL) -c $(CABLE) --detect

clean:
	rm -f $(TOP).json $(TOP)_out.config $(TOP).bit work-obj$(VHDL_STD).cf

.PHONY: all prog flash detect clean
