# Journal de bord — Portage Smaky 6 sur FPGA

> **Pour Claude (nouvelle session, notamment sous Zorin) :** lis ce fichier en entier — il
> contient l'état d'avancement et les commandes prêtes à l'emploi. La mémoire automatique
> de Claude ne suit PAS le dossier entre machines ; ce journal est le seul lien de contexte.

Dernière mise à jour : **2026-06-16** (depuis le PC Windows, avant transfert vers Zorin).

## Objectif
Smaky 6 (Z80, 1978) portable sur FPGA. Cible finale : carte **OneChipBook** (Cyclone I
EP1C12, commandée en Chine, en transit). En attendant, mise au point sur une **carte
d'entraînement** récupérée à l'atelier.

## Matériel d'entraînement
- **Altera Nios Development Board, Cyclone Edition** — FPGA **EP1C20F400C7ES** (Cyclone I).
- Alimentation : **9 V, broche centrale NÉGATIVE** (≠ la carte Cyclone II jumelle = 12–18 V).
  L'alim d'origine (660 mA) suffit pour la carte seule.
- Câble : **USB-Blaster original** (VID 09FB / PID 6001) sur le connecteur 10 broches
  « ByteBlaster » (= port JTAG).

## Brochage (extrait du netlist officiel `altera_nios_dev_board_cyclone_1c20`)
- Horloge 50 MHz → **PIN_K5** (entrée dédiée CLK0)
- LED D0…D7 → E14, E13, C14, D14, E12, F12, B3, B14 (allumées à l'état logique **1**)
- Poussoirs SW0…SW3 → W3, Y4, V4, W4 (**actifs bas** → parfaits pour un `reset_n`)

## État logiciel
- Cœur Z80 = **T80 original (freecores/OpenCores, Daniel Wallner)** dans `SM6FPGA/T80/`.
  Port d'horloge **`CLK_n`**, sans `CEN`/`OUT0`. **NE PAS** prendre le fork MiSTer (incompatible).
- Git : tout est **committé localement** (commit `e92452b`, « premier commit FPGA »), **non poussé**.
  `Blink-Nios1C20/` et ce journal sont **non committés** → ils voyagent par la clé USB.
- **`Blink-Nios1C20/`** = projet de test pour la carte d'entraînement (révision séparée pour
  ne PAS écraser la cible OneChipBook restée dans `Blink/`). Device EP1C20F400C7, `clk→K5`,
  `led1→E14`, source partagée `../Blink/blink.vhd`. Compilé OK sous Windows (`blink.sof`).
- `SM6FPGA/` compile sans erreur pour EP1C20.

## Pourquoi on est passé sous Linux (Zorin, 64 bits)
L'USB-Blaster original n'a qu'un pilote noyau **SHA-1** (certificat expiré, idem dans Quartus
9.1 et 16.1). Windows 11 + **Secure Boot** refuse de le charger → **code 39**. Aucun pilote
SHA-256 Intel pour ce câble, et le contournement (désactiver Secure Boot + test-signing)
abaisse la sécurité. Sous Linux, **aucun problème de signature** : une règle udev suffit.

## Prochaines étapes sous Zorin
1. **Installer Quartus free Linux** (le `.tar` « free » ; 9.0 ou 9.1 — les deux supportent le
   Cyclone I, sans licence). Version confirmée ici : **Quartus II 9.1** (Internal Build 222,
   21-10-2009), dans `/home/pyr/Téléchargements/91_quartus_free_linux/quartus_free`.
   **Installé ici dans `/opt/altera9.1/`** → binaires dans `/opt/altera9.1/quartus/bin/`
   (`quartus` = GUI, `quartus_sh`, `quartus_pgm`…). **Toujours lancer via le wrapper
   `bin/quartus`** : un `ldd` sur `quartus/linux/quartus` montre des dizaines de libs
   « not found » (`libccl_*`, `libddb_*`, son propre Qt4) — c'est **normal**, ce sont les
   libs internes que le wrapper résout via `LD_LIBRARY_PATH`. PATH pratique :
   `export PATH=/opt/altera9.1/quartus/bin:$PATH`.

   L'installeur est **32 bits** (binaires fournis `gtar`/`gzip`/`compare` = ELF i386) **et**
   le script `install` est un **C-shell** (`#!/bin/csh`) → il faut **`tcsh`** ET le multiarch i386 :
   ```bash
   sudo dpkg --add-architecture i386 && sudo apt update
   sudo apt install tcsh \
                    libc6:i386 libx11-6:i386 libxext6:i386 libxau6:i386 \
                    libxdmcp6:i386 libfontconfig1:i386 libfreetype6:i386 \
                    libstdc++6:i386
   # puis, dans le dossier extrait :  chmod +x install && ./install
   ```
   - **Sans `tcsh`, `./install` échoue** (« bad interpreter : csh »). C'était le piège manquant.
   - L'installeur lance une **GUI X11** → être dans une session graphique.
   - **`libncurses5:i386` n'existe plus** sur Zorin 18 / Ubuntu **noble (24.04)** : remplacé par
     `libncurses6:i386` (déjà installé). Ne pas l'inclure dans l'`apt install` (erreur « Impossible
     de trouver le paquet »). Si un binaire Quartus réclame l'ancien *soname* `libncurses.so.5`
     ou `libtinfo.so.5`, créer des liens de compat (version-agnostique) :
     ```bash
     cd /usr/lib/i386-linux-gnu
     sudo ln -sf libncurses.so.6 libncurses.so.5
     sudo ln -sf libtinfo.so.6  libtinfo.so.5
     ```
     (Alternative : récupérer les `.deb` `libncurses5`/`libtinfo5` i386 d'Ubuntu focal 20.04.)

   **Faire démarrer la GUI Quartus sur Zorin 18 (séquence réellement nécessaire ici) :**
   - Libs X11 32 bits manquantes au 1er lancement → `quartus: error while loading shared
     libraries: libSM.so.6`. Installer :
     ```bash
     sudo apt install -y libsm6:i386 libice6:i386 libxrender1:i386 libxt6:i386
     ```
   - Ensuite : `libXrender.so.1: undefined symbol: _XGetRequest`. Cause : Quartus 9.1 **embarque
     ses propres vieilles libs X11 (2007)** dans `/opt/altera9.1/quartus/linux/` qui entrent en
     conflit avec les libs i386 système. Fix = **écarter les deux libs embarquées** (le wrapper
     prendra alors les libs système) :
     ```bash
     sudo mv /opt/altera9.1/quartus/linux/libX11.so.6  /opt/altera9.1/quartus/linux/libX11.so.6.bak
     sudo mv /opt/altera9.1/quartus/linux/libuuid.so.1 /opt/altera9.1/quartus/linux/libuuid.so.1.bak
     ```
     Réversible (les `.bak` restent en place).
   - Au lancement, des `warning: direct reference to protected function … may break pointer
     equality` (vieux Qt4 + linker récent) s'affichent : **bénins**, la GUI démarre quand même. ✅

2. **Règle udev** `/etc/udev/rules.d/51-altera-usb-blaster.rules` :
   ```
   SUBSYSTEM=="usb", ATTR{idVendor}=="09fb", ATTR{idProduct}=="6001", MODE="0666"
   SUBSYSTEM=="usb", ATTR{idVendor}=="09fb", ATTR{idProduct}=="6010", MODE="0666"
   SUBSYSTEM=="usb", ATTR{idVendor}=="09fb", ATTR{idProduct}=="6810", MODE="0666"
   ```
   puis `sudo udevadm control --reload-rules && sudo udevadm trigger`, rebrancher le câble.
   - Vérif : `lsusb | grep 09fb` → `09fb:6001 Altera Blaster`, et le device node passe à
     `crw-rw-rw-` (0666). **Astuce collage** : le terminal de Zorin casse les commandes longues
     / heredocs (vrais retours-ligne injectés) → écrire la règle dans un fichier puis
     `sudo cp ~/altera-blaster.rules /etc/udev/rules.d/51-altera-usb-blaster.rules`.
3. **Compiler** : `cd Blink-Nios1C20 && <quartus>/bin/quartus_sh --flow compile blink`
   → en 9.1 sur Zorin : **OK** (GUI ou ligne de commande). La compilation n'a aucun problème.

### ⛔ BLOCAGE MAJEUR : le `jtagd` de Quartus 9.1 ne voit pas l'USB-Blaster sur noyau récent
Diagnostic confirmé par strace (2026-06-16, noyau **6.17**) : quand `jtagconfig`/`quartus_pgm`
interrogent le démon, `jtagd` ouvre **`/proc/bus/usb/devices`** (ancien *usbfs*) → `ENOENT`.
Il **n'utilise jamais** `/dev/bus/usb`. Or `usbfs` n'est **plus dans `/proc/filesystems`**
(support `CONFIG_USB_DEVICEFS` retiré du noyau Linux en 2012) → **impossible à monter**.
⇒ `quartus_pgm -l` / `jtagconfig` répondent **« No JTAG hardware available »**, et c'est
**irréparable côté 9.1** (la règle udev est pourtant correcte, le câble est bien en 0666).

**La compilation reste en 9.1 ; seule la PROGRAMMATION passe par un outil moderne (libusb-1.0).**

### ✅ SOLUTION RETENUE & VALIDÉE (2026-06-16) : OpenOCD + SVF
La LED D0 clignote — toute la chaîne marche : **compile 9.1 → SVF (`quartus_cpf`) → flash OpenOCD**.
1. Installer OpenOCD : `sudo apt install -y openocd` (0.12.0 sur Zorin 18).
2. Générer le SVF depuis le `.sof` (⚠️ l'option d'opération est obligatoire, sinon
   « Programming option … is missing ») :
   ```bash
   cd Blink-Nios1C20
   /opt/altera9.1/quartus/bin/quartus_cpf -c -q 6.0MHz -g 3.3 -n p blink.sof blink.svf
   ```
3. Programmer avec la config **`Blink-Nios1C20/openocd-blaster.cfg`** (versionnée à côté) :
   ```bash
   openocd -f openocd-blaster.cfg -c "svf_program"     # flash
   openocd -f openocd-blaster.cfg -c "shutdown"        # juste lire l'IDCODE (valider le câble)
   ```
   - Driver `usb_blaster`, `vid_pid 0x09fb 0x6001`, TAP `irlen 10`. La config tolère l'IDCODE
     réel (voir ci-dessous) via `-ignore-version`.
   - L'erreur `Translation from khz to adapter speed not implemented` (issue du `FREQUENCY` du
     SVF) est **bénigne** : l'USB-Blaster a une vitesse fixe, OpenOCD continue. Le SVF va à 100 %.
   - La config SRAM est **volatile** (perdue à l'extinction) et **non destructive** : un bitstream
     qui ne colle pas échoue proprement, sans risque → on peut tester sans crainte.

**Device réel : IDCODE lu = `0x020840dd`.** La table standard donne EP1C12 = `0x020840dd`,
EP1C20 = `0x020850dd`. Or le bitstream **EP1C20 configure quand même la carte** (LED OK) ⇒ c'est
bien l'**EP1C20F400C7ES** annoncé, mais en **Engineering Sample** dont l'IDCODE est un proto
(`0x2084` au lieu de `0x2085`). À garder en tête pour `SM6FPGA` : viser EP1C20, ignorer l'IDCODE.

Note : si c'est Quartus 9.0, il réécrira les lignes `*_QUARTUS_VERSION` des `.qsf` à
l'ouverture — sans conséquence.
