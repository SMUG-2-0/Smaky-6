# Refactoring IX/IY — état initial (avant)

Ce fichier mesure le code de Petit-Python AVANT le refactoring qui dédiera
les registres IX et IY aux pointeurs VM (VSP et FP). On comparera la taille
APRÈS pour évaluer le gain.

## Comptage des lignes par fichier

Date de référence : 2026-05-19, après le fix VMC_FL (commit qui suit).

| Fichier      | Lignes | Rôle |
|--------------|--------|------|
| LX.SR        |   755  | Lexer (tokens) |
| PS.SR        |  1364  | Parser + émetteur bytecode |
| VM.SR        |   937  | Interpréteur bytecode (cœur VM) |
| DSM.SR       |   185  | Désassembleur bytecode |
| PYTHON.SR    |   232  | Programme principal `PYTHON.SM` |
| **Total composants PYTHON.SM** | **3473** |  |
| HELLO.SR     |   113  | Programme de démo |
| LXTEST.SR    |   267  | Driver de test lexer |
| PSTEST.SR    |   381  | Driver de test parser |
| **Total général** | **4234** |  |

## Cible du refactoring

Dédier IX et IY aux pointeurs VM les plus utilisés :

- **IX = VSP** (pile d'expressions VM). Cible : VPUSH, VPOP, et tous les
  handlers VM (VM_PSHI, VM_ADD, VM_SUB, ..., VM_PRTI, VM_POP) qui appellent
  VPUSH/VPOP. Gain estimé majeur car VPUSH/VPOP sont sur le chemin chaud.

- **IY = FP** (frame pointer). Cible : VM_LDL, VM_STL (accès aux locaux par
  slot), VM_CALL (calcul du nouveau FP), VM_RETN (rewind frame). Les
  instructions `LD r,(IY+d)` et `LD (IY+d),r` permettent l'accès indexé direct
  aux slots de la frame, supprimant le calcul `HL := FP + slot*2`.

## Convention syscalls

PYR a confirmé que les appels système Samos préservent IX et IY. Donc on peut
dédier ces registres sans précaution particulière autour des syscalls (?DICAR,
?TEXTIM, ?GETCAR, ?AFOHL, etc.).

## Autres notes (à appliquer pendant le refactoring)

- Utiliser `DECJ NE,B` (= DJNZ) plutôt que `DEC B; JUMP NE,...` (économise
  1 octet et 1 cycle par occurrence). B est le compteur 8 bits naturel du Z80.
  Note : le bug FN2 (boucle infinie dans VMC_FL) venait précisément de
  l'utilisation de A comme compteur — A était écrasé par les écritures de bytes.
  Avec B et DECJ NE,B, le piège disparaît.

- Vérifier la taille des routines clés (VPUSH, VPOP, VM_LDL, VM_STL, VM_CALL,
  VM_RETN, VM_FRAME) avant/après et noter les économies octet par octet.

## Suite

Une fois le refactoring fait, ce fichier sera complété avec les nouvelles
mesures (lignes et octets compilés), et le diff sera commit avec un tag
`v0.2-ixiy`.
