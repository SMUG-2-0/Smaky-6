# Protocole de la carte contrôleur FDC du Smaky 6

Reverse engineering du protocole de communication entre SAMOS et la carte
contrôleur de disquettes Micropolis, déduit du code SAMOS désassemblé. Cette
carte est une carte « maison », sans schéma disponible — toutes les
informations ci-dessous viennent de l'analyse du code qui la pilote.

Les références de lignes pointent vers `samos.ls` et `sys.ls` (listings
désassemblés) tels qu'ils sont à la rédaction de ce document. Si le
désassembleur est régénéré, les numéros de ligne peuvent bouger ; les
**adresses mémoire** (en octal, format SAMOS) restent stables.

## 1. Mapping des ports

La carte FDC occupe les ports `$18`–`$1B` (hex). En octal CALM (base par
défaut du source SAMOS) ce sont `$30`–`$33`.

Les noms officiels sont tirés de l'en-tête « CONTROLLER PERIPHERIC ADRESS »
du source SAMOS 1-E (transcription par PYR dans
`samos_disasm/extraits-samos-1-e.sr`). Le scan PDF est dans
`Simulateur-JS/SAMOS-1-E-sr.pdf`.

| Port hex | Port oct | Sens  | Symbole SAMOS | Rôle |
|----------|----------|-------|---------------|------|
| `$18`    | `$30`    | OUT   | `WRBYT`  | Bytes output (écriture des données vers le contrôleur) |
| `$19`    | `$31`    | OUT   | `CONTR`  | Registre de commande |
| `$19`    | `$31`    | IN    | (statut) | Statut principal |
| `$1A`    | `$32`    | IN    | `RDREQ`  | Read request flag — bit 7 = DRQ (octet prêt) |
| `$1A`    | `$32`    | OUT   | `STPCMD` | **Motor step command** (impulsion de pas du moteur) |
| `$1B`    | `$33`    | IN    | `RDBYT`  | Byte input (lecture des données depuis le contrôleur) |

Les ports `$1C`–`$1F` (`$34`–`$37` oct) ne sont touchés ni par SAMOS ni par
SYS — probablement non décodés par la carte.

**Important** : `$1A` n'est **pas** un miroir de `$19`. C'est un port à
double fonction (typique des contrôleurs disque de l'époque) :
- en lecture, on y trouve le flag DRQ (bit 7) ;
- en écriture, c'est un registre séparé `STPCMD` qui pilote directement
  les impulsions de pas du moteur du lecteur.

Cela explique pourquoi `DO_INIFLO` écrit la même valeur sur `$19` puis
sur `$1A` (souvent 6 fois sur `$1A`) : sur `$19` c'est la commande de
sélection drive/opération, sur `$1A` ce sont des **impulsions de step
moteur** pour positionner la tête. Les bits de la valeur écrite sur
`STPCMD` codent probablement la direction du pas et le drive sélectionné
(à confirmer par lecture du source 1-E).

## 2. Bits du registre $19 en lecture

Déduits des instructions `BIT n,A` (encodées en `.B 313, ...` faute de
mnémonique CALM 1re gen) qui suivent chaque `LOAD A,$31` :

| Bit | Test SAMOS | Signification déduite |
|-----|-----------|------------------------|
| 7   | `BIT 7,A` à `samos.ls:2467` (`017041 313 177`) | drive prêt / présent |
| 6   | `BIT 6,A` à `samos.ls:2657` et `2704`           | drive busy — `0` = prêt, `1` = absent ou occupé |
| 5   | `BIT 5,A` à `samos.ls:2921` (`020232 313 157`)  | system ready (testé en attente principale) |
| 4   | `BIT 4,A` à `samos.ls:3072`                      | busy interne (SAMOS attend qu'il retombe à 0) |
| 0–3 | `AND A,#17` à `samos.ls:3052` et `3110`         | code de cause IT / drive# / status post-opération |

## 3. Bit 7 du registre $1A en lecture — RDREQ / DRQ

Le source 1-E nomme ce port `RDREQ` (Read REQuest). Bit 7 = « octet prêt
à transférer » (Data Request, terminologie générique).

SAMOS ne lit pas `$1A` avec un `LOAD A,$32` mais avec l'instruction Z80
**undocumented `IN F,(C)`** (opcode `ED 70`, encodée en `.B 355, 160`) qui
lit le port pointé par `C` en n'affectant que les flags. Dans toute la zone
de transfert, `C = #30` (port `$30`) est utilisé pour `OUTI`, mais `IN F,(C)`
avec `C = #32` n'a pas été observé ; en pratique SAMOS lit `$1A` en
positionnant `C = #32` (à confirmer en relisant `L_2169`).

Pattern de polling du DRQ (extrait de `samos.ls:3076`) :
```
L_218B:
 020613 .B 355, 160  ;IN F,(C) — lit le port C
 020615 JUMP PL,L_218B  ;tant que bit 7 = 0 (PL = positive), on attend
```

## 4. Format des commandes sur $19

Les commandes encodent **drive** (bits 6-7) + **opération** (bits 0-3) :

```
  bit  7  6  5  4  3  2  1  0
       │  │           └──┴──┴──┴── code opération (0–F)
       │  │
       └──┴── drive# (mask : 01=HD via $20, 10=drive#1 via $40, 11=drive#2 via $80)
              en fait SAMOS utilise un seul bit set : $20, $40, $80
```

Codes opération identifiés (lus dans le code à partir des `ADD A,#nn` puis `LOAD $31,A`) :

| Code  | Source | Signification probable |
|-------|--------|-------------------------|
| `+$00` | `samos.ls:2655` (`LOAD $31,A` direct) | sélection drive, lecture statut |
| `+$02` | `samos.ls:2671`                       | wait ready |
| `+$0A` | `samos.ls:3237` (`ADD A,#12`)         | seek track 0 / autre |
| `+$0C` | `samos.ls:3302` (`ADD A,#14` dans `L_22B4`) ; `samos.ls:2754` (read) | read sector |
| `+$0E` | `samos.ls:3067` (`ADD A,#16` dans `L_2169` — mode lecture) ; `samos.ls:2767` (write) | write sector |
| `+$0F` | `samos.ls:3119` (`ADD A,#17`)         | reset / ack IT |
| `+$12` | `samos.ls:2660` (`ADD A,#22` — init)  | calibration / restore |

Les commandes `init` envoyées dans `DO_INIFLO` envoient une valeur sur `$19`
(`CONTR`, sélection drive + opération) puis la même valeur **plusieurs fois
sur `$1A`** (`STPCMD`, motor step command) — typiquement 6 répétitions via
la routine `L_2272` à `samos.ls:3239` appelée avec `B=6`. Ces écritures sur
`STPCMD` génèrent **6 impulsions de pas** au moteur du lecteur. Les bits de
la valeur écrite codent vraisemblablement la direction et le drive
sélectionné (à confirmer en lisant la section pilote moteur du source 1-E).

## 5. Mécanisme d'interruption

### 5.1 Vecteurs RST en bas de mémoire

Chaque RSTn est un trampoline de 6 octets (`sys.ls:38–93`) qui saute vers
une adresse stockée en RAM. Cela permet à SAMOS d'installer dynamiquement
des handlers.

| Adresse | Label   | Pointeur RAM | Installé par |
|---------|---------|--------------|--------------|
| `$08`   | RST08H (RST 1) | `mem[$A862]` (= `42542` oct) | `?IRST1` (code `07h`) |
| `$10`   | RST10H (RST 2) | `mem[$A864]` (= `42544` oct) | `?IRST2` (code `08h`) |
| `$28`   | RST28H (RST 5) | `mem[$A868]` (= `42550` oct) | `?IRST5` (code `0Ah`) |
| `$30`   | RST30H (RST 6) | `mem[$A86A]` (= `42552` oct) | `?IRST6` (code `0Bh`) |
| `$38`   | RST38H (RST 7) | `mem[$A866]` (= `42546` oct) | `?IRST7` (code `09h`) |

Code typique d'un trampoline (RST08H, `sys.ls:38`) :
```
PUSH HL ; LOAD HL,42542 ; EX (SP),HL ; RET
```
Effet : le PC saute à l'adresse pointée, en restaurant HL. Les autres
registres ne sont pas sauvés — c'est au handler de le faire.

### 5.2 Z80 en mode 0

Les RSTn sont déclenchés par les interruptions matérielles : la carte FDC
met `INT` à 0, et pendant l'INTACK fournit sur D0-D7 l'opcode RST
correspondant. SAMOS s'attend à recevoir :

- `$CF` (= `RST 08H` = RST 1) du **FDC** pour signaler fin de transfert
- `$D7` (= `RST 10H` = RST 2) du **FDC** pour signaler événement init/calibration
- Autres vecteurs (RST 5, 6, 7) probablement pour timer, clavier, série

Les syscalls `?IRSTn` (`sys.ls:575–597`) sont triviaux : `LOAD 4254x,HL ; RET` —
ils stockent juste l'adresse du handler dans le slot mémoire approprié.

### 5.3 Pattern de transfert avec attente IT

Routine `DO_RODWIB` (Read sector — IN buffer), `samos.ls:2745` :
```
DO_RODWIB:
 017643  LOAD A,25610          ; A := drive courant
 017646  COMP A,#40            ; si HD ($20 hex) → branche vers le code WD1002
 017650  JUMP. EQ,L_1FD5
 017652  CALL L_2072           ; setup transfert
 017655  RET CS                ; erreur → retour
 017656  LOAD HL,#20407        ; HL := handler RST 1 = $2107
 017661  .W ?IRST1             ; install handler RST 1
 017663  LOAD A,25610
 017666  ADD A,#14             ; A := drive + $0C (commande "read sector")
 017670  LOAD $31,A            ; OUT $19 ← cmd  ── LANCE l'opération
L_1FBA:
 017672  JUMP. L_1FBA          ; ←──── boucle infinie en attente IT
```

Quand l'IT arrive, RST 1 est exécuté via le trampoline `RST08H` et atterrit
sur le handler à `$2107`.

### 5.4 Handler RST 1 « post-transfert » à $2107

`samos.ls:2990` :
```
 020407  LOAD A,#22
 020411  LOAD 20640,A          ; flag "transfert en cours" ?
 020414  CALL L_2169           ; routine de lecture (transfert via $30/$33)
 020417  JUMP. CC,L_211B       ; OK → suite
 020421  CALL L_2226
 020424  LOAD A,#33            ; code erreur $1B
 020426  JUMP. CC,L_2128
L_2118:
 020430  POP HL                ; **clé** : dépile le PC de retour (= L_1FBA)
 020431  JUMP. L_20FC          ; → handler erreur (ne reviendra pas dans la boucle)
```

Le `POP HL` à `020430` est essentiel : il **jette l'adresse de retour de
l'IT** (qui était dans la boucle infinie `L_1FBA`), de sorte qu'au RET
final on retombe directement chez l'appelant de `DO_RODWIB`.

### 5.5 Handler RST 1 « dispatch par cause » à $21B8

Installé par `DO_RIBWOD` (`samos.ls:2765`). `samos.ls:3109` :
```
 020670  LOAD A,$31            ; lit statut FDC
 020672  AND A,#17             ; isole bits 0-3 = source IT
 020674  LOAD E,A
 020675  CALL L_223C           ; lookup table par bits 0-3
 020700  AND A,(HL)
 020701  JUMP. EQ,L_2211       ; pas notre événement → ignore
 ...                            ; sinon transfert + maj pointeurs
```

Les **bits 0-3 du registre $19** servent donc de code de cause IT (drive
ready, sector trouvé, fin de transfert, erreur CRC, etc.).

## 6. Trace de boot décodée

Logs observés sur le simulateur actuel (qui ne génère pas d'IT) :

```
OUT $19 ← 40H     drive#1 : LOAD $31,C        (samos.ls:2655)
IN  $19 → 00H     test bit 6 — drive présent
OUT $19 ← 52H     drive# + $12 (init/calibrate)
OUT $1A ← 52H ×7  6 répétitions via L_2272 B=6
OUT $19 ← 42H     drive# + 2 (wait ready)
OUT $1A ← 42H ×7  polling 79 fois max
OUT $19 ← 80H     drive#2 (SLA C → $80)
... idem pour drive#2 ...
OUT $19 ← 00H     XOR A,A puis LOAD $31,A : fin DO_INIFLO (samos.ls:2698)

OUT $19 ← 4AH     L_2257 (samos.ls:3222) : 25610+$0A+C(=0) = $4A — seek
IN  $19 → 00H
OUT $19 ← 4CH     L_22B4 (samos.ls:3300) : 25610+$0C = $4C — read sector
                  ← BLOQUE ICI : SAMOS attend une IT qui ne vient jamais
```

## 7. Implémentation côté simulateur

État actuel (`smaky.js:824–894`) : stub minimal qui retourne `00H` sur `$19`
et `80H` sur `$1A` quand une image floppy est chargée. Ne génère aucune IT.

Pour faire avancer l'émulation, il faut au minimum :

1. **Modèle de commandes sur `$19`** : décoder la commande à chaque OUT
   (drive# en bits 6-7, opération en bits 0-3) et maintenir un état
   interne (drive sélectionné, position track/sector, opération en cours).
2. **Statut cohérent sur lecture de `$19`** : bit 6 = 0 quand drive
   présent et idle ; bits 0-3 = code de cause IT après une opération.
3. **Génération d'IT FDC** : quand une opération (read/write/seek) est
   « terminée » (immédiatement ou après quelques µs simulées), générer
   une IT qui fournira `$CF` (RST 1) pendant l'INTACK.
4. **Mécanisme INT ACK dans le CPU émulé** : le simulateur a déjà un
   mécanisme d'IT (timer 50 Hz, `smaky.js:381`) — il faut vérifier qu'il
   gère bien l'opcode mis sur le bus en mode 0, et l'étendre pour la
   source FDC.
5. **Transfert via `$1B` (read) et `$18` (write)** : le bit 7 de `$1A`
   doit suivre le rythme du transfert. Pour un read sector :
   - DRQ = 1 → SAMOS lit `$1B` (consomme un octet)
   - quand SAMOS fait `IN F,(C)` avec C=$32 → on retourne DRQ
   - après le dernier octet, IT pour signaler fin

## 8. Références code

| Adresse oct | Adresse hex | Label / rôle |
|-------------|-------------|--------------|
| `010143`    | `$1063`     | Code installé par `DO_INIFLO` comme handler RST 2 (rôle exact à confirmer — semble être un dispatcher inline-byte, peut-être pour neutraliser RST 2 pendant l'init) |
| `017412`    | `$1F0A`     | `DO_INIFLO` — séquence d'init des 2 drives floppy |
| `017643`    | `$1FA3`     | `DO_RODWIB` — Read sector (Read OUT, Write IN Buffer) |
| `017674`    | `$1FBC`     | `DO_RIBWOD` — Write sector (Read IN Buffer, Write OUT Data) |
| `020407`    | `$2107`     | Handler RST 1 « post-transfert » installé par `DO_RODWIB` |
| `020551`    | `$2169`     | `L_2169` — routine de lecture sector (transfert via OUTI / `$30`) |
| `020670`    | `$21B8`     | Handler RST 1 « dispatch par cause » installé par `DO_RIBWOD` |
| `021046`    | `$2226`     | `L_2226` — gestion erreur post-IT |
| `021061`    | `$2231`     | `L_2231` — calcul d'index dans table par drive |
| `021074`    | `$223C`     | `L_223C` — lookup table de cause IT (indexée par bits 0-3 de `$19`) |
| `021127`    | `$2257`     | `L_2257` — envoi commande seek/track |
| `021162`    | `$2272`     | `L_2272` — `LOAD $32,A` + boucle de retransmission |
| `021223`    | `$2293`     | `L_2293` — décodage drive# vers offset table |
| `021255`    | `$22AD`     | `L_22AD` — divers |
| `021264`    | `$22B4`     | `L_22B4` — `LOAD A,25610 ; ADD A,#14 ; LOAD $31,A` (commande +$0C) |

Variables RAM clés :
| Adresse oct | Adresse hex | Rôle |
|-------------|-------------|------|
| `25610`     | `$2D88`     | drive courant (mask `$20`/`$40`/`$80`) |
| `25615`–`25617` | `$2D8D`–`$2D8F` | état des 3 drives (HD + 2 floppies) |
| `25621`–`25624` | `$2D91`–`$2D94` | pointeurs de buffer |
| `25634`     | `$2D9C`     | drive demandé par l'appelant |
| `25637`     | `$2D9F`     | adresse de continuation post-IT |
| `25641`     | `$2DA1`     | sauvegarde de continuation |
| `42542`–`42552` | `$A862`–`$A86A` | slots des handlers RST 1, 2, 5, 6, 7 |
