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
- **Configuration de la carte** : CPLD **MAX 7000A `EPM7128AETC100-7`** à côté de la flash =
  **contrôleur de config** (lit la flash parallèle → configure le Cyclone en *passive serial*
  au power-on). **Pas d'EPCS série.** Le MAX n'est **pas** sur la chaîne JTAG du câble
  (`scan_chain` OpenOCD ne voit qu'**un seul TAP** = le Cyclone). ⇒ Le mode **permanent** sur
  cette carte = écrire l'image dans la flash parallèle via les outils Nios II (dépendants du
  jtagd cassé) : mini-projet à part, faible intérêt sur une carte d'entraînement. **On reste en
  SRAM ici** ; le permanent se fera proprement sur le OneChipBook (EP1C12, config dédiée).

## Brochage (extrait du netlist officiel `altera_nios_dev_board_cyclone_1c20`)
- Horloge 50 MHz → **PIN_K5** (entrée dédiée CLK0)
- LED D0…D7 → E14, E13, C14, D14, E12, F12, B3, B14 (allumées à l'état logique **1**)
- Poussoirs SW0…SW3 → W3, Y4, V4, W4 (**actifs bas** → parfaits pour un `reset_n`)

## Architecture mémoire (Nios vs OneChipBook) — décisif pour la suite
Objectif à terme : émuler aussi les Smaky modernes (100–400, jusqu'à **4 MB de RAM**), pas
seulement le Smaky 6 (64 kB). **Point commun des deux cartes = SDRAM standard JEDEC** (mêmes
signaux A/BA/RAS/CAS/CS/WE/CKE/CLK/DQ/DQM) :
- **Carte Nios** : SDRAM **32 bits** (~16 MB) + SRAM async **1 MB / 32 bits** + flash CFI.
- **OneChipBook** : **uniquement** SDRAM **16 bits**, 32 MB (Samsung **K4S561632E**).
⇒ Stratégie : **un contrôleur SDRAM paramétrable** (`DATA_WIDTH` 32→Nios / 16→OneChipBook),
présentant au CPU une mémoire octet plate. 64 kB = petite fenêtre ; passe à l'échelle 4 MB ;
portage = remap broches + largeur. La **SRAM async 1 MB** de la Nios est simple mais **absente
du OneChipBook = impasse** : à n'utiliser que pour un bring-up rapide jetable, pas pour la map
mémoire Smaky définitive.

## Avancement — M3 « Smaky 6 à l'écran (VGA) » ✅✅✅ (2026-06-16)
**Le Smaky 6 affiche son boot sur un moniteur VGA** : « ROM de chargement rev 1-8 » puis
« Disque souple ». Boucle complète : Z80 réel + SDRAM + interruption 50 Hz + sortie VGA.
Projet **`SM6Video-Nios1C20/`** (`sm6video.vhd` = `sm6boot` + vidéo).

### Sortie VGA — raccord fait main sur la carte Nios
La carte Nios n'a pas de VGA. Raccord sur le connecteur prototypage **J11** (= PROTO1, via
bus-switches toujours actifs) — broches trouvées avec l'outil **`PinFinder-Nios1C20/`** (pull-up
internes + pull-down externe → la LED s'allume). Câble VGA DE-15 fait maison :
- **VIDEO** : J11 pin 4 = **FPGA C19** → résistance ~300 Ω → VGA R+G+B (blanc, monochrome 1 bit).
- **HSYNC** : J11 pin 6 = **FPGA D19** ⚠️ *mais câble inversé* → assigné à **D20** dans le `.qsf`.
- **VSYNC** : J11 pin 8 = **FPGA D20** ⚠️ inversé → assigné à **D19**.
- **GND** : J11 pin 2 → VGA pins 5/6/7/8/10.
(Note : HSYNC=D20 / VSYNC=D19 dans le qsf à cause de l'inversion physique du câble.)

### Contrôleur vidéo (`sm6video.vhd` + `common/vram.vhd` + `char_rom.vhd`)
- **VGA 640×480@60**, pixel clock 25 MHz (50/2 par toggle). Zone texte **64×20 cellules 8×16**,
  centrée (h:64..575, v:80..399). Synchros actives bas.
- **Générateur de caractères** : `chargen_rom.h` de **Marcel Prisi** (TMS2716, 128 car × 16 o,
  bit0 = pixel gauche) → `char_rom.vhd` (bloc-RAM). Code char = bits 0-6, **bit7 = vidéo inverse**.
- **RAM vidéo double-port** `common/vram.vhd` (2 Ko, zone 0x4000-0x47FF) : le CPU y écrit par
  **SNOOP** (toute écriture CPU en 0x4000-0x47FF est copiée en VRAM, le CPU continue d'utiliser
  la SDRAM) ; le contrôleur VGA lit le port B. Pas de conflit SDRAM.
- Pipeline 2 étages (VRAM puis char_rom) aligné par registres `cx1/cx2`, `it1/it2`, `iv1`.

### Étape 1 (mire VGA) validée séparément : **`VGATest-Nios1C20/`** (mire grille + test char-gen).

### ▶ SUITE : émuler le **WD1002** (contrôleur disque dur)
Le boot teste le WD1002 (ports **$20–$27**), le trouve absent → « Disque souple ». À implémenter
d'après `../Simulateur-JS/smaky.js` (`_wd1002In`/`_wd1002Out`, `hdEnabled`) : registres style
WD1010, secteur 256 o, 32 sect/piste, LBA=((cyl*heads)+head)*sect+sec. **Contenu disque fixe**
dispo dans **`../Simulateur-JS/HD0.JS`** (16 MB, ~270 ko utiles) → charger en SDRAM (on a 16 MB).
NB : récupérer la version à jour du simulateur depuis `github.com/SMUG-2-0/Smaky-6` (le local
`Simulateur-JS-old` est périmé ; fait via `git checkout origin/master -- Simulateur-JS`).

## Avancement — M2 « Smaky 6 boote sur SDRAM » ✅✅ (2026-06-16)
**Le Smaky 6 démarre sur le FPGA** : Z80 (T80) exécutant `ROM18.bin` depuis 64 kB de SDRAM,
écrit **"ROM de chargement"** en mémoire écran (0x4000) → confirmé matériellement (détection
de `R`,`O`,`M` en 0x4000 = LED clignotent). Projet **`SM6Boot-Nios1C20/`** (`sm6boot.vhd`).

### Composants
- **Bootstrap loader** : remplit toute la RAM (64 kB) à 0, puis recopie `ROM18.bin` (1995 o,
  `common/boot_rom.vhd`, bloc-RAM) en SDRAM dès 0, puis relâche le Z80.
- **`common/T80s_ce.vhd`** : T80s modifié avec **CLOCK-ENABLE (CEN)** — voir leçon ci-dessous.
- **Accès octet SDRAM** : contrôleur étendu avec `ben` (byte-enable → masque `DQM`).
  Adresse mot = A[15:2], octet = A[1:0], donnée répliquée sur 4 voies.
- **Timer + interruption 50 Hz** : le Smaky est **piloté par interruption** (IM 0 → RST 38h →
  ISR 0x0106). Compteur 50 MHz/1e6 = 50 Hz, gaté par `eni50` (`OUT(0)` bit0), `INT_n` acquitté
  au cycle INTA (M1+IORQ) où on présente **0xFF** sur le bus (= RST 38h en IM 0).

### Carte I/O du Smaky 6 (décodée depuis le simulateur `../Simulateur-JS/smaky.js`)
- **Port $0** : IN = clavier (caractère`|0x80`, sinon touches super-shift, **0 au repos**) ;
  OUT bit0 = `eni50` (valide timer), bits1-3 = contrôle graphique.
- **Port $1** : IN bit2 = strobe clavier, **bit3 = tick timer 50 Hz** ; OUT bit3 = acquitte.
- **Écran** à partir de **0x4000** (octal 040000), effacé avec le **caractère SPACE 0x20**.
  Pile à SP=0x4600. Vecteurs RST en page 0 (RST18→011C efface l'écran, RST38→0106=ISR).

### ⚠️ LEÇONS DE DEBUG (toutes coûteuses — à ne pas réapprendre)
1. **RAM non-initialisée = boot aléatoire.** La SDRAM est aléatoire au power-up ; le boot lit
   de la RAM → comportement non déterministe. **Fix : le loader remplit toute la RAM à 0.**
   (Symptôme : valeur écran « statique mais différente à chaque power-cycle ».)
2. **Le boot EXIGE l'interruption 50 Hz.** Sans elle il boucle avant l'affichage (pas de `EI`
   atteint). Implémenter timer + `INT_n` + RST38 via 0xFF sur INTA.
3. **🔑 BUG MAJEUR — écritures consécutives via `WAIT_n` mid-cycle.** Caler le T80 avec `WAIT_n=0`
   en T2 laisse fuiter le pipeline interne : sur 2 écritures rapprochées (ex. les 2 PUSH d'un
   `CALL`), la 2ᵉ capture l'**adresse ET la donnée de la 1ʳᵉ** (les 2 PUSH écrivaient à 0x45FF
   au lieu de 0x45FF/0x45FE) → pile corrompue → `RET` part en vrille. **Fix = CLOCK-ENABLE
   (CEN)** : geler le cœur T80 **et** sa logique bus ensemble (`T80s_ce`) ⇒ adresse/donnée/MREQ
   en lockstep, 100 % stables pendant l'accès SDRAM. **Ne jamais revenir au WAIT_n mid-cycle.**
4. **SDRAM fiable, pas besoin de PLL** : l'aléatoire venait de la RAM non-init (leçon 1), pas du
   timing SDRAM. `sdram_clk <= not clk` suffit à 50 MHz. (Tentative PLL `altpll` Cyclone
   abandonnée : se fait classer « enhanced PLL », emplacements refusés ; `common/sdram_pll.vhd`
   laissé en réserve mais NON utilisé.)
5. **Débogueur matériel** (dans `sm6boot.vhd`) très efficace : gel auto au 1er fetch hors ROM
   (`derail_to`/`derail_from`), `max_pc`, sondes d'adresse/donnée, le tout lisible octet par
   octet sur les 8 LED via SW2/SW3. **À réutiliser.**

### Suite
- **Voir le texte pour de vrai** : implémenter le **contrôleur vidéo** (DMA écran Smaky, schémas
  dispo) → sortie VGA de la carte Nios, lisant la zone 0x4000+. (Le boot s'arrête après l'affichage
  car il tente ensuite de charger depuis un disque absent — normal.)
- Nettoyer `sm6boot.vhd` (retirer les sondes de debug une fois l'écran en place).

## Avancement mémoire — M1 « SDRAM vivante » ✅ (2026-06-16)
Contrôleur SDRAM autonome **`common/sdram_ctrl.vhd`** (mono-accès, auto-precharge, CL2,
timings généreux @ 50 MHz, init + auto-refresh) + autotest **`SDRAMTest-Nios1C20/`**
(`sdram_test.vhd` : écrit un motif sur 1024 adresses, relit, compare → **D7 clignote = OK**).
**Validé sur la carte.** Chip Nios = **MT48LC4M32B2** (16 MB, 32 bits) ; horloge SDRAM
`sdram_clk = not clk` sur PIN_L13. Brochage SDRAM extrait du netlist (FPGA=U60) — voir le `.qsf`.
- **Leçon de debug** : un handshake `req` en **impulsion 1 cycle** est perdu si un auto-refresh
  (prioritaire dans `S_IDLE`) tombe au même cycle → blocage. Fix = `req` **maintenu en niveau**
  jusqu'au `done`, + état `S_DEASSERT` qui attend le relâchement avant d'accepter l'accès suivant.
- LED de l'autotest : succès = D7 seul ; échec = D6 + adresse ; bloqué = D2..D0 = n° d'état,
  D3 = init_done, D4 = ready, D7 = heartbeat (mode diagnostic conservé).
- Couverture actuelle limitée (banque 0, lignes basses) → à étendre en march-test complet.
- **Suite M2** : glisser ce contrôleur derrière le bus T80 (WAIT_n pendant la latence), charger
  la vraie ROM Smaky, faire booter le Smaky 6 sur 64 kB de SDRAM réelle.

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
