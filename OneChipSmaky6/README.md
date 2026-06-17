# OneChipSmaky6 — Smaky 6 sur FPGA

Portage du **Smaky 6** (ordinateur suisse à Z80, 1978) sur FPGA (carte Altera Nios
Development Board, Cyclone EP1C20, puis cible OneChipBook EP1C12).

À notre connaissance, **c'est le premier Smaky 6 jamais implémenté sur FPGA** : le Smaky 6
d'origine utilisait un Z80 en boîtier DIL 40 broches. Le cœur Z80 utilisé ici est le **T80**
de Daniel Wallner (OpenCores).

État actuel (`SM6Disk-Nios1C20/`) : le Smaky 6 **boote depuis le disque dur émulé (WD1002)**,
charge SYS.SY (SAMOS) puis CLI.SY, et affiche la liste des fichiers — sortie VGA, SDRAM,
contrôleur WD1002 avec contenu disque embarqué.

---

## ⚠️ Bug trouvé et corrigé dans le cœur Z80 « T80 » (block I/O : INI/IND/OUTI/OUTD)

En portant ce Smaky 6 sur FPGA, nous avons exposé un **vrai bug du cœur T80 v0242**
(Daniel Wallner, OpenCores, 2002) qui n'avait apparemment jamais été corrigé.

**Symptôme** : les instructions de bloc d'entrée/sortie **INI, IND, INIR, INDR, OUTI, OUTD,
OTIR, OTDR n'incrémentent (ni ne décrémentent) jamais le registre HL**. Le pointeur reste
figé : un `INIR` écrit ses N octets tous à la même adresse au lieu de remplir le tampon.
(Le changelog du fichier le laissait présager : `0214 : ... only the block instructions now
fail the zex regression test`.)

**Cause** (`T80_MCode.vhd`, microcode de INI/IND/OUTI/OUTD, MCycle 3) :

```vhdl
-- BUGGÉ :
if IR(3) = '0' then IncDec_16 <= "0010";   -- bit 2 = 0
else                IncDec_16 <= "1010";
```

Or le write-back du registre 16 bits incrémenté (`T80.vhd`, lignes ~788 et ~813) est
**conditionné à `IncDec_16(2) = '1'`**. Avec le bit 2 à 0, le registre n'est jamais réécrit —
HL n'est donc pas mis à jour. Tous les autres INC/DEC 16 bits du cœur (INC HL, PUSH/POP,
INC IX…) utilisent bien `"0110"/"1110"` (bit 2 = 1).

**Correction** :

```vhdl
-- CORRIGÉ :
if IR(3) = '0' then IncDec_16 <= "0110";   -- bit 2 = 1 -> write-back HL++
else                IncDec_16 <= "1110";   --              write-back HL--
```

Le fichier corrigé est `common/T80_MCode.vhd` (le `SM6FPGA/T80/` d'origine est laissé
intact). Ce bug est **indépendant du mécanisme d'horloge** (CEN/clock-enable ou WAIT_n) : la
condition de write-back exige bit 2 = 1 dans tous les cas. Le simulateur JavaScript du Smaky
(basé sur une bibliothèque Z80 dérivée de Python) ne présente pas ce bug — c'est bien le cœur
T80 qui était fautif.

> Mots-clés : T80 Z80 core bug, INIR INI OUTI INIR HL not incremented, block I/O instruction,
> IncDec_16, Daniel Wallner T80 v0242 OpenCores, zex block instructions fail.

---

## Structure

- `SM6Disk-Nios1C20/` — version courante : boot disque dur (WD1002) + VGA + SDRAM.
- `SM6Video-Nios1C20/`, `SM6Boot-Nios1C20/`, `Blink-Nios1C20/` — étapes intermédiaires.
- `common/` — cœur T80 patché, contrôleur SDRAM, ROM de boot, VRAM, etc.
- `SM6FPGA/T80/` — cœur T80 v0242 d'origine (non modifié).
- `JOURNAL-FPGA.md` — journal de bord détaillé du portage.
