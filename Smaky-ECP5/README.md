# Squelette ECP5 libre — base pour porter les Smaky (Colorlight 5A-75B)

Chaîne **100 % libre**, scriptable, sans licence :

```
GHDL (VHDL) → Yosys (synth_ecp5) → nextpnr-ecp5 → ecppack → openFPGALoader
```

Cible : **Colorlight 5A-75B** (ECP5 `LFE5U-25F`, CABGA256, 25 k LUT, SDRAM intégrée).
Esprit « fils en l'air » : les connecteurs HUB75 exposent des dizaines de GPIO 3,3 V.

---

## 1. Installer les outils

**OSS CAD Suite** (contient Yosys, GHDL, le plugin ghdl-yosys, nextpnr-ecp5,
ecppack, etc.) — un seul téléchargement :

- https://github.com/YosysHQ/oss-cad-suite-build/releases
- Décompresser, puis : `source <chemin>/oss-cad-suite/environment` (ajoute tout au PATH).

**openFPGALoader** (programmateur) — souvent dans l'OSS CAD Suite ; sinon paquet
distribution ou compilation depuis https://github.com/trabucayre/openFPGALoader

---

## 2. La sonde JTAG

Le 5A-75B n'a **pas** de programmateur USB intégré : on relie une sonde externe
aux pads JTAG de la carte (TCK, TMS, TDI, TDO, GND).

Sondes bon marché supportées par openFPGALoader :
- **Raspberry Pi Pico** sous **DirtyJTAG** (`-c dirtyJtag`) — ~5 €, **GPIO 3,3 V** =
  niveau JTAG de l'ECP5, donc **aucun adaptateur de niveau** (le défaut du Makefile)
- module **FT232H** (`-c ft232`) — simple, plus rapide
- **FT2232H** (`-c ft2232`) — double canal (JTAG + UART)
- Raspberry Pi (GPIO), J-Link, etc.

Liste complète : `openFPGALoader --list-cables`. Sélection via `CABLE=` (Makefile ou ligne de commande).

### Pi Pico + DirtyJTAG (sonde par défaut)

1. **Flasher le firmware** : maintiens **BOOTSEL** en branchant l'USB (le Pico monte
   comme une clé USB), puis glisse le **`.uf2`** de DirtyJTAG (port RP2040) dessus.
2. **Câbler** Pico ↔ pads JTAG de la Colorlight : **TCK, TMS, TDI, TDO, GND**.
   ⚠️ Le mapping GPIO (quel `GPx` = quel signal) est **défini dans le firmware**
   (typiquement GP0–GP4) — vérifie le README/config du firmware flashé.
3. Plus lent qu'un FT2232H, mais largement suffisant pour un bitstream ECP5-25.

Vérifier la connexion :
```bash
make detect                    # CABLE par défaut = dirtyJtag
make detect CABLE=ft232        # (ou une autre sonde)
# doit afficher l'IDCODE de l'ECP5
```

---

## 3. Compiler et programmer

```bash
make               # construit top.bit (le blinky de validation)
make prog          # charge en SRAM (volatile) -> la LED de test clignote ~0,75 Hz
make flash         # écrit en flash SPI (démarrage autonome)
make clean
```

Câble une LED + résistance (~330 Ω) sur la broche `led` (et GND) pour voir le clignotement.

---

## 4. ⚠️ Vérifier les broches

`colorlight_5a_75b.lpf` contient l'horloge **25 MHz sur P6** (stable v7.0/v8.0) et
une sortie `led` sur une broche **à confirmer**. Les broches varient selon la
révision de carte. Sources faisant autorité :

- **litex-boards** : `litex_boards/platforms/colorlight_5a_75b.py`
- **openFPGALoader** : board `colorlight-5a-75b`
- rétro-ingénierie communautaire (pinouts HUB75 / RJ45 / SDRAM par version)

Identifie ta version (sérigraphie « V6.1 / V7.0 / V8.0 ») et reporte les broches.

---

## 5. Porter le Smaky

1. Ajoute tes sources VHDL à `VHDL_SRCS` (dans l'ordre des dépendances) :
   T80 (ou fx68k pour le 68k), contrôleur SDRAM, VRAM, char-gen, sd_spi, ps2…
   - Le VHDL passe par GHDL ; le SystemVerilog (fx68k) par le frontend slang de Yosys.
2. Adapte le contrôleur SDRAM au timing/brochage de la puce SDRAM Colorlight.
3. Mappe VGA (1 bit `video` + sync), micro-SD, PS/2 sur des GPIO HUB75 dans le `.lpf`.
4. Pour un vrai ECP5-**85** (grosse marge), vise la carte **ULX3S 85F** ou ton PCB :
   il suffit de changer `DEVICE=85k` et le `.lpf`.
