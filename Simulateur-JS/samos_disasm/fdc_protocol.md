# Protocole de la carte contrôleur FDC du Smaky 6

Reverse engineering du protocole de communication entre SAMOS et la carte
contrôleur de disquettes Micropolis, déduit du code SAMOS désassemblé et
validé par implémentation dans le simulateur (`smaky.js`). Cette carte est
une carte « maison », sans schéma disponible — toutes les informations
ci-dessous viennent de l'analyse du code qui la pilote, et de
l'observation empirique du comportement de SAMOS face à chaque variation
d'état du simulateur.

Les références de lignes pointent vers `samos.ls` et `sys.ls` (listings
désassemblés) tels qu'ils sont à la rédaction de ce document. Si le
désassembleur est régénéré, les numéros de ligne peuvent bouger ; les
**adresses mémoire** (en octal, format SAMOS) restent stables.

État au 14/05/2026 : **Lots 1, 2a, 2b, 3 implémentés et validés**.
Lecture, jeux qui tournent depuis disquette, copie de fichier (XFER vers
DX1:) fonctionnelle (vérifiée avec SMILE). Persistance disque restant à
faire (les modifications vivent en RAM seulement).

## 1. Mapping des ports

La carte FDC occupe les ports `$18`–`$1B` (hex). En octal CALM (base par
défaut du source SAMOS) ce sont `$30`–`$33`.

Noms officiels tirés de l'en-tête « CONTROLLER PERIPHERIC ADRESS » du
source SAMOS 1-E (transcrit dans `samos_disasm/extraits-samos-1-e.sr`,
PDF dans `Simulateur-JS/SAMOS-1-E-sr.pdf`).

| Port hex | Port oct | Sens   | Symbole SAMOS | Rôle |
|----------|----------|--------|---------------|------|
| `$18`    | `$30`    | OUT    | `WRBYT`  | Bytes output (data → contrôleur, write sector) |
| `$18`    | `$30`    | IN     | (DRQ-write) | Bit 7 = prêt à recevoir un byte (write) |
| `$19`    | `$31`    | OUT    | `CONTR`  | Registre de commande |
| `$19`    | `$31`    | IN     | (statut) | Statut principal |
| `$1A`    | `$32`    | IN     | `RDREQ`  | Bit 7 = DRQ (octet prêt en lecture) |
| `$1A`    | `$32`    | OUT    | `STPCMD` | Motor step / calibrate command |
| `$1B`    | `$33`    | IN     | `RDBYT`  | Byte input (data ← contrôleur, read sector) |

Les ports `$1C`–`$1F` (`$34`–`$37` oct) ne sont touchés ni par SAMOS ni
par SYS — non décodés par la carte.

`$1A` n'est **pas** un miroir de `$19`. C'est un port à double fonction :
en lecture le DRQ-read, en écriture les impulsions de step moteur. Et de
même `$18` est un port à double fonction : en écriture les data du write
sector, en lecture le DRQ-write.

## 2. Statut du registre $19 en lecture

Bits identifiés via les `BIT n,A` (Zilog) / `TEST A:n` (CALM 1re gen) qui
suivent chaque `LOAD A,$31` :

| Bit | Test SAMOS | Signification | Notre simu |
|-----|-----------|----------------|-------------|
| 7   | `BIT 7,A` (`L_1E17`, samos.ls:2467)  | Drive **non** protégé en écriture (= TAB WP non détecté) | `1` quand drive ready |
| 6   | `BIT 6,A` (`samos.ls:2657`, `2704`) | Drive busy : `0` = prêt, `1` = absent ou occupé | `0` quand drive ready |
| 5   | `BIT 5,A` (`L_2095`, samos.ls:2921) | System ready (testé en attente principale) | `0` (toujours ready) |
| 4   | `BIT 4,A` (`L_2183`, samos.ls:3072) | Busy interne (SAMOS attend qu'il retombe à 0) | `0` (jamais busy) |
| 0–3 | `AND A,#17`                          | Code de cause IT / drive index pour les handlers | dynamique (cf §6) |

Notre simu retourne :
- `$80` (bit 7 set, autres à 0) quand drive ready et pas en transfert
- `$80 \| E` (bits 0-3 = position du 1er bit set du masque sectors-voulus
  16-bit) pendant un read/write/verify, où E ∈ {0..15}
- `$FF` quand drive absent ou non sélectionné

## 3. Commandes sur $19 en écriture

Format : `bits 6-7 = drive_mask, bits 0-4 = opcode`.

```
  bit  7  6  5  4  3  2  1  0
       │  │           └──┴──┴──┴── opcode (0..1F)
       └──┴── drive : $20=HD (via WD1002), $40=FD1, $80=FD2
```

Opcodes identifiés :

| Opcode | Routine source | Signification | Notre simu |
|--------|----------------|----------------|-------------|
| `$00` | `samos.ls:2655` | Sélection drive seule (lecture statut) | tracke `_fdcDrive` |
| `$02` | `samos.ls:2671` | Wait ready (polling après init) | rien (statut toujours ready) |
| `$0A` | `L_22AD` (samos.ls:3294) | Head load + system ready trigger | rien |
| `$0C` | `L_22B4` (samos.ls:3300), DO_RODWIB | **Read sector** (cf §7) | déclenche read |
| `$0E` | DO_RIBWOD (samos.ls:2767) | **Write sector** (cf §8) | marque `_fdcWritePending` |
| `$0F` | Handler `$21B8` (samos.ls:3119) | Reset / ack IT après statut lu | écrit le buffer write |
| `$12` | DO_INIFLO (samos.ls:2660) | Init / calibrate (= aller à track 0) | reset compteur step |
| `$1A` | `L_2257` (samos.ls:3222) | Step in setup (sera pulsé sur `$1A`) | rien sur `$19` |

L'opcode `$1A` sur **port `$1A`** = step pulse (cf §4 ci-dessous) ; ne pas
confondre avec l'opcode `$1A` sur le **port `$19`** qui n'est qu'un setup
de la commande à pulser.

## 4. STPCMD (port $1A en écriture) — pilote moteur

Format identique à `$19` (bits 6-7 = drive). Trois opcodes observés :

| Opcode | Sens | Effet sur la position de la tête |
|--------|------|------------------------------------|
| `$12` | calibrate / init | Force la tête à track 0 (compteur reset à 0) |
| `$0A` | step out         | 1 pulse = -1 track (vers track 0) |
| `$1A` | step in          | 1 pulse = +1 track (vers track haute) |
| `$02` | wait             | Pas de mouvement |

Validation : `bloc 0 = 0 pulses`, `bloc 32 = 2 pulses` (= track 2),
`bloc 128 = 8 pulses` (= track 8). Confirme **1 pulse = 1 track** et
**16 secteurs par track** (vs 32 secteurs/track sur le HD WD1002).

DO_INIFLO envoie 6× `$12` puis 1× `$02` au démarrage : calibration de
chaque drive à la mise sous tension.

## 5. Géométrie disquette Micropolis

- **256 octets par secteur**
- **16 secteurs par track** (numérotés 0..15 dans le masque ; cf §7)
- **77 tracks** max (= ~315 Ko)
- Image `.dsk` au format LBA brut : `image[bloc * 256 + offset]`
- Conversion `bloc ↔ (track, sector)` : `bloc = track × 16 + sector`

## 6. Mécanisme d'interruption

### 6.1 Vecteurs RST en bas de mémoire

Chaque RSTn est un trampoline de 6 octets (`sys.ls:38–93`) qui saute vers
une adresse stockée en RAM. SAMOS installe dynamiquement ses handlers via
les syscalls `?IRSTn`.

| Adresse | Label | Pointeur RAM | Syscall installeur |
|---------|-------|--------------|--------------------|
| `$08` | RST08H (RST 1) | `mem[$4562]` (= `42542` oct) | `?IRST1` (code `07h`) |
| `$10` | RST10H (RST 2) | `mem[$4564]` (= `42544` oct) | `?IRST2` (code `08h`) |
| `$28` | RST28H (RST 5) | `mem[$4568]` (= `42550` oct) | `?IRST5` (code `0Ah`) |
| `$30` | RST30H (RST 6) | `mem[$456A]` (= `42552` oct) | `?IRST6` (code `0Bh`) |
| `$38` | RST38H (RST 7) | `mem[$4566]` (= `42546` oct) | `?IRST7` (code `09h`) |

Code typique d'un trampoline (RST08H, `sys.ls:38`) :
```
PUSH HL ; LOAD HL,42542 ; EX (SP),HL ; RET
```
Effet : le PC saute à l'adresse pointée, en restaurant HL. Les autres
registres ne sont pas sauvés — c'est au handler de le faire.

### 6.2 Z80 en mode 0

Les RSTn sont déclenchés par les interruptions matérielles : la carte FDC
met `INT` à 0, et pendant l'INTACK fournit sur D0-D7 l'opcode RST
correspondant. Vecteurs SAMOS :

- **`$CF` (= RST 08H = RST 1)** : émis par le **FDC** pour signaler
  fin de transfert ou événement de validation (read & write)
- `$D7` (RST 2) : initialement supposé pour init/calib FDC, mais on
  observe que DO_INIFLO ne reçoit aucune IT (polling actif sous IOF) ;
  RST 2 sert probablement à autre chose
- RST 5, 6, 7 : timer 50 Hz (RST 7 = `$FF`), clavier, série

Notre simu émule ça via `cpu.intVector` (extension du Z80 émulé,
`z80.js`). Le périphérique pose son opcode RST avant d'appeler
`cpu.handleActiveInt()` ; en mode 0, le CPU exécute l'équivalent de RST
(adresse cible = `intVector & 0x38`).

### 6.3 IT pending

Notre `cpu.handleActiveInt()` ignore les appels quand `iff1 = 0` (= déjà
dans un autre handler). Pour ne pas perdre une IT FDC déclenchée pendant
un autre handler, on a un flag `_fdcIntPending` testé par la run loop
entre chaque chunk de T-states. Quand IFF1 redevient 1 (ION final du
handler en cours), l'IT pending est délivrée.

## 7. Read sector

### 7.1 Lancement

`DO_RODWIB` (samos.ls:2745) :
```
LOAD HL,#20407    ; HL := handler RST 1 = $2107
.W ?IRST1         ; install handler
LOAD A,25610      ; drive courant ($40 ou $80)
ADD A,#14         ; +$0C
LOAD $31,A        ; OUT $19 ← cmd_read
JUMP $            ; boucle d'attente IT
```

### 7.2 Masque "sectors voulus" 16-bit

SAMOS prépare un mot 16-bit en RAM dans `mem[$2B9F..$2BA0]` (= 25637 oct)
avec un bit set par sector demandé :
- bits 0-7 dans `mem[$2B9F]` (low byte)
- bits 8-15 dans `mem[$2BA0]` (high byte)

Pour le directory (3 blocs) le masque est `$0007`. Pour des fichiers le
masque peut être n'importe quoi jusqu'à `$FFFF` (= 16 secteurs voulus =
toute une track). Le bit `n` set ↔ sector physique `n` de la track
courante voulu.

`L_223C` (samos.ls:3203) extrait :
- A := `mem[$244F + (E sans bit 3)]` où `mem[$244F..$2456] = [1,2,4,8,16,32,64,128]`
- HL := `$2B9F` si bit 3 de E = 0, sinon `$2BA0`

`L_2169` (samos.ls:3050) teste alors `A AND mem[HL]` ≠ 0 pour valider
que SAMOS veut bien le sector identifié par E.

### 7.3 Format du transfert (259 octets)

```
buf[0]       : pré-data (lu sans test DRQ ; ignoré)
buf[1]       : marker = numéro de track physique. Comparé via
               COMP A,(HL) où HL pointe sur mem[$2B8C+drive_offset]
               (calculé par L_2293, qui retourne aussi A := drive).
               Notre simu sert `track & 0xFF` (= n° de step pulses
               cumulés).
buf[2..257]  : 256 octets de data. SAMOS les écrit en RAM via
               LD (DE),A à chaque tour (DE initialisé par L_2231 ;
               valeur indexée par E dans la table mem[$2BA3+]).
               Note : le désassembleur affiche cette instruction
               comme LD B,(HL) à samos.ls:3090 — c'est probablement
               une mauvaise lecture, l'observation confirme LD (DE),A.
buf[258]     : checksum = somme modulo 256 des 256 data bytes
               (running sum accumulée dans H par ADD A,H ; LD H,A
               à chaque tour, comparée au byte final).
```

### 7.4 Sémantique de E (bits 0-3 du statut $19)

Notre simu calcule E = position du 1er bit set du masque 16-bit, en
relisant ce masque dynamiquement à chaque `IN $19`. SAMOS clear le bit
correspondant au transfert en fin de `L_2169` (lignes 020660-020666),
donc à la prochaine IT le 1er bit set sera celui du sector suivant.

L'offset physique servi par notre buffer = `(track × 16 + E) × 256` dans
l'image `.dsk` brute.

## 8. Write sector

### 8.1 Lancement et flow

`DO_RIBWOD` (samos.ls:2758) lance la séquence :
```
LOAD HL,#20670    ; HL := handler RST 1 = $21B8
.W ?IRST1         ; install handler
LOAD A,25610      ; drive
ADD A,#16         ; +$0E
LOAD $31,A        ; OUT $19 ← cmd_write
JUMP $1FD3        ; boucle d'attente IT
```

Notre simu marque `_fdcWritePending` et déclenche IT.

Handler `$21B8` (samos.ls:3109) :
1. Lit statut `$19` → on retourne `$80 | E` (E = 1er bit du masque)
2. Valide via `L_223C` → `A AND mem[$2B9F..$2BA0]` ≠ 0
3. **Clear** le bit `1<<E` du masque (lignes 020703-020705)
4. `OUT $19 ← drive+$0F` (ack) — notre simu prépare alors le buffer collecteur
5. Boucle 300× `OUT $18` envoyée (cf format ci-dessous)
6. `L_2211` : si masque = 0 → restaure depuis backup (`mem[$2BA1]`),
   ré-installe handler à `$212A` ; sinon ION+RET

### 8.2 Format du transfert (300 octets)

```
buf[0..39]   : 40× $28 — préambule de synchronisation
buf[40]      : 1×  $FF — marker début bloc data
buf[41]      : 1×  D   — byte secondaire (lu de mem[$2BA3+2*E+1] dans
                         L_2231, semble être l'octet haut du buffer)
buf[42..297] : 256 data via OUTI (LD A,(HL); INC HL; OUT (C),A)
buf[298]     : checksum = somme modulo 256 des 256 data
buf[299]     : 1×  $00 — terminateur
```

Notre simu collecte les 300 octets, extrait `buf[42..297]` (= 256 data
réelles) et écrit dans l'image à offset `(track × 16 + E) × 256`. Le
préambule, marker, D, checksum et terminateur sont ignorés (notre
"hardware" simulé n'a pas besoin de validation).

### 8.3 DRQ pour write

Le handler attend la disponibilité avec `TEST $(C)` où `C = $30` =
**port `$18` en lecture**. `JUMP PL` boucle tant que bit 7 = 0. Notre
simu retourne `$80` sur `IN $18` quand `_fdcWriteActive` et buffer non
plein, `$FF` sinon (= toujours prêt par défaut).

## 9. Read-after-write (vérification)

Quand un write se termine avec masque vidé, `L_2211` (samos.ls:3166) :
1. Restaure le masque depuis `mem[$2BA1]` (backup initial)
2. Ré-installe le handler RST 1 à `$212A` (samos.ls:020452)
3. ION + RET

Le handler `$212A` est minimal : il appelle `L_22B4` (= `OUT $19 ←
drive+$0C` → notre simu prépare un read), puis ré-installe à son tour
le handler à `$2135` (samos.ls:020465), puis ION+RET.

`$2135` est le **handler de read de vérification** : il appelle `L_2169`
(qui lit 1 bloc et clear son bit dans le masque), puis :
- Si masque ≠ 0 : ION + RET (= attend la prochaine IT)
- Si masque = 0 : sortie via `L_2118` → `L_20FC` → RET final

Différence cruciale avec le handler read normal `$2107` : `$2135` ne fait
**pas** de `CALL L_22B4` après chaque bloc lu. Donc pas de re-issue
spontané de `OUT $19 ← cmd_read` pour le bloc suivant — c'est notre simu
qui doit déclencher l'IT pour chaque bloc, via le flag
`_fdcReadVerifyMode`.

## 10. État machine simulé (`smaky.js`)

### 10.1 Variables d'état

```javascript
_fdcDrive          // 0 = FD1, 1 = FD2, -1 = aucun (bits 6-7 du dernier OUT $19)
_fdcStepPulses[2]  // position physique de la tête, par drive (0..76)
_fdcXferBuf,       // read sector : buffer 259 + curseur + flag actif
_fdcXferPos,
_fdcXferActive
_fdcXferE          // bit du masque servi pour ce transfert
_fdcWriteBuf,      // write sector : collecteur 300 + curseur
_fdcWritePos,
_fdcWriteActive    // collection en cours
_fdcWritePending   // OUT $19 ← $0E reçu, attend l'ack $0F pour préparer
_fdcWriteOffset    // offset cible dans l'image
_fdcWriteDrive     // drive cible
_fdcReadVerifyMode // après un write avec masque vidé, on entre dans
                   // ce mode pour gérer les IT du read de vérif
_fdcIntPending     // IT FDC à délivrer dès que IFF1 = 1
```

### 10.2 Bug fix critique IT fantômes

Le re-issue intra-`L_2169` (`OUT $19 ← cmd` ligne 020577) marque
`_fdcIntPending = true`. Si le dernier sector vide le masque, SAMOS sort
via `L_2118` → `L_20FC` → RET **sans ION**, et le pending résiduel
survit. Plus tard, sur le premier `EI` quelconque, l'IT fantôme
déclenche un handler `L_2169` qui fait `POP HL` sur une stack non
préparée → corruption → reboot. **Fix** : à la fin de chaque transfert,
on force `_fdcIntPending = false` puis on le re-set seulement si nécessaire.

### 10.3 Bug fix IT fin de read-verify

À la fin d'un transfert read, `L_2169` clear le bit du sector courant
**après** notre finalize. Si on teste `wantMask` directement, on voit
encore le bit set et on déclenche une IT en trop quand le masque va en
fait passer à 0. On calcule donc :
```
remainingMask = wantMask & ~(1 << _fdcXferE)
```
pour décider si une IT suivante est nécessaire.

## 11. Limitations actuelles et restant à faire

### 11.1 Persistance disque

Les modifications d'image (writes) vivent en RAM seulement. Au
redémarrage du simulateur, les changements sont perdus. À ajouter :
callback `onFloppyChanged(index, buffer)` exposée par `smaky.js`,
captée par `index.html` / `main.js` pour ré-écrire le `.dsk`.

### 11.2 Step out limité par compteur

Le compteur `_fdcStepPulses[drive]` est saturé à 0 (pas de valeur
négative) : si SAMOS demande un step out alors qu'on est à track 0,
on ignore. C'est probablement le comportement hardware (= la tête
butte sur le track 0 sensor) mais à valider.

### 11.3 Lancement de DX1:ER.SY

Le scénario `SMILE DX1:ER.SY` (= lancer le fichier de messages erreur
ER.SY comme un programme exécutable, ce qui n'a pas de sens
fonctionnel) plante. Le directory est lu correctement, le bloc 44 (=
contenu de ER.SY) est servi avec des data lisibles, mais SAMOS rejette
quelque part. À investiguer si on en trouve un cas d'usage réel. Pour
les programmes habituels (jeux, utilitaires), tout fonctionne.

### 11.4 Bit 0 du marker

Pour les disquettes simple-face le marker observé = `track`. On
soupçonne que **bit 0 du marker** code la face (head) en double-face,
mais on n'a pas testé. Notre simu ignore et sert `track & 0xFF`, ce qui
correspond à face 0 toujours.

## 12. Références code clés

| Adresse oct | Adresse hex | Label / rôle |
|-------------|-------------|--------------|
| `017412`    | `$1F0A`     | `DO_INIFLO` — séquence d'init des 2 drives floppy |
| `017643`    | `$1FA3`     | `DO_RODWIB` — Read sector (Read OUT, Write IN Buffer) |
| `017674`    | `$1FBC`     | `DO_RIBWOD` — Write sector (Read IN Buffer, Write OUT Data) |
| `020407`    | `$2107`     | Handler RST 1 read normal (installé par DO_RODWIB) |
| `020452`    | `$212A`     | Handler RST 1 chaînon (re-installe `$2135`, lance read via L_22B4) |
| `020465`    | `$2135`     | Handler RST 1 read-after-write (read sans re-issue) |
| `020551`    | `$2169`     | `L_2169` — boucle de lecture sector + clear bit du masque |
| `020670`    | `$21B8`     | Handler RST 1 write (clear bit + 300× OUT $18) |
| `021046`    | `$2226`     | `L_2226` — gestion erreur post-IT |
| `021061`    | `$2231`     | `L_2231` — calcul DE = mem[$2BA3 + 2*E] (table par E) |
| `021074`    | `$223C`     | `L_223C` — A := bit_de(E) ; HL := $2B9F+(bit3_de_E) |
| `021127`    | `$2257`     | `L_2257` — calcule différence de track + envoie cmd seek/step |
| `021162`    | `$2272`     | `L_2272` — `LOAD $32,A` + boucle de retransmission STPCMD |
| `021223`    | `$2293`     | `L_2293` — A := drive courant ; HL pointe sur état drive |
| `021255`    | `$22AD`     | `L_22AD` — `LOAD A,drive ; ADD A,#0A ; LOAD $31,A` (head load) |
| `021264`    | `$22B4`     | `L_22B4` — `LOAD A,drive ; ADD A,#14 ; LOAD $31,A` (re-issue read) |

Variables RAM clés (toutes en zone système Smaky 6) :

| Adresse oct | Adresse hex | Rôle |
|-------------|-------------|------|
| `25610`     | `$2B88`     | Drive courant (mask `$20`/`$40`/`$80`) |
| `25614`     | `$2B8C`     | Marker attendu pour FD1 (= track physique) |
| `25615`     | `$2B8D`     | Marker attendu pour FD2 (idem) |
| `25615`–`25617` | `$2B8D`–`$2B8F` | États des 3 drives (HD + 2 floppies) |
| `25621`–`25624` | `$2B91`–`$2B94` | Pointeurs de buffer / paramètres opération |
| `25634`     | `$2B9C`     | Drive demandé par l'appelant |
| `25635`–`25636` | `$2B9D`–`$2B9E` | DE backup (16-bit) |
| `25637`–`25640` | `$2B9F`–`$2BA0` | **Masque "sectors voulus" 16-bit** (bits 0-7 + bits 8-15) |
| `25641`–`25642` | `$2BA1`–`$2BA2` | Sauvegarde du masque (restaurée par L_2211) |
| `25643`–`25662` | `$2BA3`–`$2BB6` | Table 16 entrées × 2 octets (DE par bit du masque) |
| `42542`–`42552` | `$4562`–`$456A` | Slots des handlers RST 1, 2, 5, 6, 7 |
