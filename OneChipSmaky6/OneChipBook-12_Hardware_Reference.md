# OneChipBook-12 — Référence Hardware

**FPGA :** Altera Cyclone EP1C12Q240C8N  
**Logic Elements :** 12 060 LEs  
**Block RAM interne :** 239 616 bits (~29 kB)  
**RAM externe :** 32 MB SDRAM  
**Horloge principale :** 21,47727 MHz (cristal X1)  
**PCB :** 4 couches  
**Document source :** Technical Reference Rev 1.01

---

## 1. VGA / Vidéo

L'écran LCD interne (1024×768, ex iPad2) reçoit le signal VGA directement — aucune gestion LCD requise par l'utilisateur. Un switch sur la carte sélectionne LCD interne ou sortie VGA externe. S-Video et CVBS partagent les mêmes canaux R/G/B via multiplexage.

Le D/A est réalisé par un réseau de résistances (R-2R) sur 6 bits par couleur.

| Signal  | Broche FPGA |
|---------|:-----------:|
| HSYNC   | 75          |
| VSYNC   | 74          |
| VR5 (MSB rouge) | 104 |
| VR4     | 101         |
| VR3     | 100         |
| VR2     | 99          |
| VR1     | 98          |
| VR0     | 95          |
| VG5 (MSB vert)  | 94  |
| VG4     | 93          |
| VG3     | 88          |
| VG2     | 87          |
| VG1     | 86          |
| VG0     | 85          |
| VB5 (MSB bleu)  | 84  |
| VB4     | 83          |
| VB3     | 82          |
| VB2     | 79          |
| VB1     | 78          |
| VB0     | 77          |

---

## 2. Clavier PS/2

Le clavier intégré est contrôlé par un MCU STC (Keyboard MCU) qui génère les scan codes PS/2. Il est connecté en parallèle avec le port PS/2 externe. La combinaison FN+4 bascule entre clavier interne et externe.

| Signal | Broche FPGA |
|--------|:-----------:|
| CLK    | 68          |
| DATA   | 67          |

---

## 3. Audio

D/A réalisé par réseau R-2R sur 6 bits par canal. Amplificateur PAM8403 pour les haut-parleurs.

| Signal       | Broche FPGA |
|--------------|:-----------:|
| SR5 (MSB R)  | 120         |
| SR4          | 119         |
| SR3          | 118         |
| SR2          | 117         |
| SR1          | 116         |
| SR0          | 115         |
| SL5 (MSB L)  | 114         |
| SL4          | 113         |
| SL3          | 108         |
| SL2          | 107         |
| SL1          | 106         |
| SL0          | 105         |

---

## 4. SDRAM (32 MB)

Composant : Samsung K4S561632E (ou équivalent).

### Données
| Signal | Broche FPGA |   | Signal | Broche FPGA |
|--------|:-----------:|---|--------|:-----------:|
| D0     | 181         |   | D8     | 222         |
| D1     | 182         |   | D9     | 219         |
| D2     | 183         |   | D10    | 218         |
| D3     | 184         |   | D11    | 217         |
| D4     | 185         |   | D12    | 216         |
| D5     | 186         |   | D13    | 215         |
| D6     | 187         |   | D14    | 214         |
| D7     | 188         |   | D15    | 213         |

### Adresses
| Signal | Broche FPGA |   | Signal | Broche FPGA |
|--------|:-----------:|---|--------|:-----------:|
| A0     | 203         |   | A7     | 228         |
| A1     | 206         |   | A8     | 227         |
| A2     | 207         |   | A9     | 226         |
| A3     | 208         |   | A10    | 202         |
| A4     | 235         |   | A11    | 225         |
| A5     | 234         |   | A12    | 224         |
| A6     | 233         |   |        |             |

### Contrôle
| Signal | Broche FPGA |
|--------|:-----------:|
| RAS#   | 196         |
| CAS#   | 195         |
| CS#    | 197         |
| WE#    | 194         |
| CKE    | 39          |
| CLK    | 38          |
| LDQM   | 193         |
| UDQM   | 223         |
| BA0    | 200         |
| BA1    | 201         |

---

## 5. Carte SD

Interface SPI (4 fils de données + CLK + CMD).

| Signal | Broche FPGA |
|--------|:-----------:|
| DAT0   | 62          |
| DAT1   | 61          |
| DAT2   | 66          |
| DAT3   | 65          |
| CLK    | 63          |
| CMD    | 64          |

---

## 6. DIP Switches (8 interrupteurs)

SW1 et SW2 servent de terminaux de contrôle pour le générateur de balayage VGA. Les autres sont connectés librement au FPGA.

| Switch | Broche FPGA |
|--------|:-----------:|
| SW1    | 53          |
| SW2    | 54          |
| SW3    | 55          |
| SW4    | 56          |
| SW5    | 57          |
| SW6    | 58          |
| SW7    | 59          |
| SW8    | 60          |

Logique : DIP ON = 0 (actif bas).

---

## 7. LEDs de statut (×9)

| LED   | Broche FPGA |
|-------|:-----------:|
| LED1  | 43          |
| LED2  | 44          |
| LED3  | 45          |
| LED4  | 46          |
| LED5  | 47          |
| LED6  | 48          |
| LED7  | 49          |
| LED8  | 50          |
| LED9  | 240         |

---

## 8. Ports DB9 (Joystick / Série)

### 1#DB9
| Broche DB9 | Broche FPGA |
|:----------:|:-----------:|
| 1          | 1           |
| 2          | 2           |
| 3          | 3           |
| 4          | 4           |
| 5          | 5           |
| 6          | 6           |
| 7          | 7           |
| 8          | GND         |
| 9          | VCC         |

### 2#DB9
| Broche DB9 | Broche FPGA |
|:----------:|:-----------:|
| 1          | 8           |
| 2          | 11          |
| 3          | 12          |
| 4          | 13          |
| 5          | 14          |
| 6          | 15          |
| 7          | 16          |
| 8          | GND         |
| 9          | VCC         |

---

## 9. USB

| Signal | Broche FPGA |
|--------|:-----------:|
| DP2    | 239         |
| DN2    | 238         |

---

## 10. Slot d'expansion externe (50 broches)

42 I/O FPGA + 1 RESET (actif bas) + alimentations.

| Broche slot | Broche FPGA / Signal | Broche slot | Broche FPGA / Signal |
|:-----------:|:--------------------:|:-----------:|:--------------------:|
| 1           | 122 (IO)             | 2           | 123 (IO)             |
| 3           | 124 (IO)             | 4           | 125 (IO)             |
| 5           | 126 (IO)             | 6           | 127 (IO)             |
| 7           | 128 (IO)             | 8           | 131 (IO)             |
| 9           | 132 (IO)             | 10          | 133 (IO)             |
| 11          | 134 (IO)             | 12          | 135 (IO)             |
| 13          | 136 (IO)             | 14          | 137 (IO)             |
| 15          | **153 (RESET#)**     | 16          | 138 (IO)             |
| 17          | 139 (IO)             | 18          | 140 (IO)             |
| 19          | 141 (IO)             | 20          | 143 (IO)             |
| 21          | 156 (IO)             | 22          | 158 (IO)             |
| 23          | 159 (IO)             | 24          | 160 (IO)             |
| 25          | 161 (IO)             | 26          | 162 (IO)             |
| 27          | 163 (IO)             | 28          | 164 (IO)             |
| 29          | 165 (IO)             | 30          | 166 (IO)             |
| 31          | 167 (IO)             | 32          | 168 (IO)             |
| 33          | 169 (IO)             | 34          | 170 (IO)             |
| 35          | 173 (IO)             | 36          | 174 (IO)             |
| 37          | 175 (IO)             | 38          | 176 (IO)             |
| 39          | 177 (IO)             | 40          | 178 (IO)             |
| 41          | GND                  | 42          | 144 (IO)             |
| 43          | GND                  | 44          | 179 (IO)             |
| 45          | +5V                  | 46          | 180 (IO)             |
| 47          | +5V                  | 48          | +12V                 |
| 49          | Audio-L              | 50          | -12V                 |

---

## 11. Slot d'expansion interne (50 broches)

Identique au slot externe, **sauf broche 4 = FPGA 121** (au lieu de 125).  
Dimensions carte d'extension interne : 120,40 × 74,00 mm.

---

## 12. Interface de programmation Active Serial (ASP)

Connecteur 10 broches sur le panneau avant. Utiliser un USB Blaster (mode Active Serial).  
Recommandé : Intel FPGA Download Cable (PL-USB-BLASTER-RCN).

| Broche | Signal    | Broche | Signal   |
|:------:|:---------:|:------:|:--------:|
| 1      | DCLK      | 2      | GND      |
| 3      | C_DONE    | 4      | NC       |
| 5      | n_CONFIG  | 6      | n_CE     |
| 7      | DATA_in   | 8      | n_CS     |
| 9      | DATA_out  | 10     | GND      |

---

## 13. Fonctions Fn (contrôle système via MCU)

| Combinaison | Fonction                                              |
|-------------|-------------------------------------------------------|
| FN+1        | Basculer entre LCD interne et VGA externe             |
| FN+3        | Rétroéclairage clavier ON/OFF                        |
| FN+4        | Basculer entre clavier interne et PS/2 externe        |
| FN+F3       | OSD — Configuration des scan codes personnalisés      |
| FN+F4       | OSD — Menu LCD                                        |
| FN+F5       | OSD — Menu statut système                             |
| FN+R        | Assertion du signal RESET (actif bas, broche 153)     |

---

## 14. Références logicielles

- Outil de synthèse : **Quartus II 13.1** (dernière version supportant le Cyclone I)
- Références : Cyclone FPGA Family Data Sheet, Quartus II Handbook v9.0
- Site fabricant : [www.8086cpu.com](http://www.8086cpu.com)
