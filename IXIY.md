# Refactoring IX/IY + DECJ NE,B — avant/après

Ce fichier mesure le code de Petit-Python avant et après le refactoring
qui dédie IX au pointeur de pile VM (VSP) et systematise l'usage de
DECJ NE,B (DJNZ) pour les boucles.

## Comptage des lignes par fichier

Date de référence avant : commit `b409292` (tag `v0.2-fn2`).
Date de référence après : ce commit.

| Fichier      | Avant | Après | Δ |
|--------------|-------|-------|---|
| LX.SR        |  755  |  755  |  0 |
| PS.SR        | 1364  | 1358  | -6 |
| VM.SR        |  937  |  929  | -8 |
| DSM.SR       |  185  |  184  | -1 |
| PYTHON.SR    |  232  |  231  | -1 |
| **Total composants PYTHON.SM** | **3473** | **3457** | **-16** |

Réduction modeste en lignes (~0.5%), mais le gain en **octets compilés** est
plus visible :

- VPUSH : 13 → 11 octets (-2).
- VPOP  : 12 → 10 octets (-2).
- 11 boucles `DEC B; JUMP NE` → `DECJ NE,B` (-2 octets chacune) = -22 octets.
- Suppression de la variable VSP en RAM (2 octets BSS) et des `LOAD VSP,HL` /
  `LOAD HL,VSP` (3 octets chacun) qui ne sont plus nécessaires.

**Estimation totale : ~30 octets de code compilé en moins**, et le chemin chaud
(VPUSH, VPOP) est plus rapide grâce à l'absence de `LOAD HL,(VSP)` /
`LOAD (VSP),HL` à chaque appel.

## Changements effectués

### IX = VSP (dédié à la pile VM)

- Suppression de la variable `VSP` en mémoire (libère 2 octets BSS).
- `VMINIT` initialise IX directement : `LOAD IX,#VSTOP`.
- `VPUSH` simplifié : `DEC IX; LOAD (IX),H; DEC IX; LOAD (IX),L; RET` (5 instr.
  au lieu de 9, dont 2 `EX HL,DE` éliminés).
- `VPOP` simplifié : `LOAD L,(IX); INC IX; LOAD H,(IX); INC IX; RET` (5 instr.
  au lieu de 8).
- Convention : IX préservé à travers tous les handlers VM et tous les
  syscalls Samos (confirmé par PYR).

### DECJ NE,B (DJNZ) pour les boucles

Boucles converties de `DEC B; JUMP NE,label` (4 octets) en `DECJ NE,B,label`
(2 octets) :

- **VM.SR** : VMC_AL, VMC_FL, VMF_LP.
- **PS.SR** : PSSYCL, PSSYCP, PSSYP1, FNAD_CP, FNAD_PP, FNCMP.
- **PYTHON.SR** : CPLP.
- **DSM.SR** : DISML.

Total : 11 boucles, gain de ~22 octets.

### Autres petits ajustements

- VMF_LP : sortie du `XOR A,A` de la boucle (économise 4 cycles par
  itération).
- VMC_FL : suppression du `PUSH AF` / `POP AF` autour de `CALL VPOP` (le
  compteur B est préservé par VPOP, plus besoin de sauvegarder AF).
- Réutilisation de A comme compteur pour VMC_AL : convertit `LOAD A,CALLNA;
  ...; LOAD B,A` en un seul transfert (le compteur final est dans B pour DECJ).

### Pourquoi pas IY = FP ?

Hypothèse initialement séduisante (accès indexé direct aux slots de frame
via `LD r,(IY+d)`), mais `IY+d` utilise un déplacement constant 8 bits ; pour
le slot variable de BCLDL/BCSTL, il faut quand même calculer `IY+slot*2`
manuellement (via `ADD IY,DE`) en sauvegardant/restaurant IY. Le coût en
octets (3 octets par accès indexé vs 1 pour HL) annule le gain — VM_LDL
avec IY est même légèrement plus gros qu'avec HL.

Décision : laisser FP, LSP, BCIP en mémoire. IY reste libre pour un usage
futur si on trouve un cas où il paie clairement.

## Leçon Z80 mémorable

Le bug FN2 (boucle infinie dans VMC_FL) venait de l'utilisation de A comme
compteur dans une boucle où A était écrasé par les écritures de bytes via
`LD (DE),A`. Le pattern Z80 idiomatique est **B + DECJ NE,B** : B est le
compteur 8 bits naturel, DJNZ tient sur 2 octets, et les autres registres
sont libres pour la logique de boucle. Adopté systématiquement dans ce
refactoring.
