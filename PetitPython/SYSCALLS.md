# Appels système Samos dans Petit Python

**Auteur** : Pierre-Yves Rochat (PYR), avec Claude
**Date** : 22 mai 2026
**Statut** : 13 builtins — système et graphique

---

## 1. Principe

Les appels système Samos sont exposés comme des **fonctions
intégrées à nom nu**, exactement comme `print` ou `range` :

```python
cls()
gotoxy(2, 5)
beep()
k = getkey()
delay(1000)
```

Aucun `import`, aucun préfixe. Les noms Samos (`?SETCURS`) et les
vecteurs (`0x20E7`) restent invisibles à l'utilisateur.

Décisions de design : noms anglais, `≤ 8 caractères` (limite des
identificateurs Python). Tout builtin **pousse une valeur** sur la
pile (0 par défaut) ; un appel utilisé comme instruction est suivi
d'un `POP`, comme un appel de fonction.

---

## 2. Mécanisme d'implémentation

```
  source .PY            PS.SR (parser)            VM.SR (exécution)
  ----------            --------------            -----------------
  gotoxy(2,5)   ──>   BLTLK trouve "gotoxy"   ──>  BCSYS dans OPTBL
                      arité vérifiée               ──> VMSYS
                      émet  BCSYS 01                   ──> SYSTBL[1]
                                                           ──> SCGOXY
                                                               .W ?SETCURS
```

- **`BLTTBL`** (PS.SR) : table `.ASCIZ "nom" / .B nargs, index`.
- **`BLTLK`** (PS.SR) : lookup ; rend `CC + A=index, B=nargs`.
- **`PSCAL`** (PS.SR) : teste d'abord les builtins, sinon les
  fonctions utilisateur. Pour un builtin : vérifie l'arité et émet
  `BCSYS <index>` (opcode `12` octal, suivi de 1 octet).
- **`VMSYS`** (VM.SR) : lit l'index, dispatche via `SYSTBL`.
- **`SYSTBL` + stubs `SCxxx`** (VM.SR) : chaque stub dépile ses
  arguments de la VSTACK, exécute le vecteur Samos, pousse un
  résultat.

L'index, l'arité et le compteur d'arguments transitent par la pile
Z80 pendant le parsing : les appels imbriqués dans les arguments
(`gotoxy(getkey(), 0)`) ne corrompent rien.

---

## 3. Fiches des builtins

Spécifications extraites de `../Simulateur-JS/samos_disasm/SYS.SR`.

### cls() — index 0

| | |
|---|---|
| Rôle | efface l'écran alpha |
| Arguments | aucun |
| Vecteur Samos | `?CLEAR` (code 0x52) |
| Entrée | — |
| Sortie | aucune (pousse 0) |
| Détail | envoie le caractère de contrôle 2 à l'écran |

### gotoxy(ligne, colonne) — index 1

| | |
|---|---|
| Rôle | place le curseur alpha |
| Arguments | `ligne` 0–19, `colonne` 0–63 |
| Vecteur Samos | `?SETCURS` (code 0x20) |
| Entrée | `H` = ligne, `L` = colonne |
| Sortie | aucune (pousse 0) |
| Détail | l'écran fait 20 lignes × 64 colonnes ; la ligne est repliée modulo 20 |

### beep() — index 2

| | |
|---|---|
| Rôle | bip sonore court |
| Arguments | aucun |
| Vecteur Samos | `?BEEP` (code 0x3E) |
| Entrée | `A` = valeur (le stub utilise `0x83`, bip standard) |
| Sortie | aucune (pousse 0) |
| Détail | `?BEEP` réactive les interruptions en sortie ; le stub fait `IOF` pour restaurer l'état de la VM |

### getkey() — index 3

| | |
|---|---|
| Rôle | attend et lit une touche |
| Arguments | aucun |
| Vecteur Samos | `?GETCAR` (code 0x01) |
| Entrée | — |
| Sortie | entier = code de la touche |
| Détail | bloquant |

### delay(n) — index 4

| | |
|---|---|
| Rôle | pause |
| Arguments | `n` = durée |
| Vecteur Samos | `?HLDEL` (code 0x5B) |
| Entrée | `HL` = nombre d'itérations |
| Sortie | aucune (pousse 0) |
| Détail | `n` ≈ millisecondes (approximatif, dépend de l'horloge Z80). **`?DELAY` n'est pas utilisé** : il lit son délai depuis l'argument de la ligne de commande, pas depuis un registre. C'est `?HLDEL` qui délaie selon `HL`. |

### inkey() — index 5

| | |
|---|---|
| Rôle | lit le clavier sans attendre (non bloquant) |
| Arguments | aucun |
| Vecteur Samos | `?IFCAR` (code 0x0D) |
| Entrée | — |
| Sortie | code de la touche, ou **0** si aucune touche n'attend |
| Détail | `?IFCAR` rend la touche avec carry clair, ou carry positionné si le tampon clavier est vide. Indispensable pour les programmes temps réel (jeux). À comparer à `getkey()` qui, lui, bloque. |

### putc(code) — index 6

| | |
|---|---|
| Rôle | affiche un seul caractère, sans saut de ligne |
| Arguments | `code` = code ASCII du caractère |
| Vecteur Samos | `?DICAR` (code 0x00) |
| Entrée | `A` = code (octet bas de l'argument) |
| Sortie | aucune (pousse 0) |
| Détail | complément de `print`, qui termine toujours par un saut de ligne. `putc` + `gotoxy` permettent de dessiner à l'écran sans effet de bord. |

### Builtins graphiques

L'écran graphique du Smaky 6 fait **256 × 120 pixels**, VRAM
`0x4600`–`0x54FF`, superposé en OU à l'écran texte. Les routines
de dessin ne sont pas des appels `?xxx` : ce sont des entrées
d'une table de sauts à `0x0600` (`SETP`, `CLRP`, `CMOD`, `SEGA`…),
appelées par un `CALL` direct. `graph`/`text` écrivent le registre
vidéo `LAMODI` et le port `$0`.

### graph() — index 7

| | |
|---|---|
| Rôle | active l'affichage graphique (superposé au texte, pixels gros 2×2) |
| Arguments | aucun |
| Mécanisme | `LAMODI` : b2=1 graphique, b3=0 alpha visible, b1=0 gros ; recopié au port `$0` |
| Sortie | aucune (pousse 0) |

### text() — index 8

| | |
|---|---|
| Rôle | revient à l'affichage alphanumérique seul |
| Arguments | aucun |
| Mécanisme | `LAMODI` &= masque (b2=0, b3=0) ; recopié au port `$0` |
| Sortie | aucune (pousse 0) |

### gcls() — index 9

| | |
|---|---|
| Rôle | efface l'écran graphique |
| Arguments | aucun |
| Vecteur Samos | `?CGRA` (code 0x19) |
| Sortie | aucune (pousse 0) |

### plot(x, y) — index 10

| | |
|---|---|
| Rôle | allume un pixel |
| Arguments | `x` 0–255, `y` 0–119 |
| Routine | `SETP` (table 0x0600) ; entrée `D` = y, `E` = x |
| Sortie | aucune (pousse 0) |

### clrp(x, y) — index 11

| | |
|---|---|
| Rôle | éteint un pixel |
| Arguments | `x` 0–255, `y` 0–119 |
| Routine | `CLRP` (table 0x0603) ; entrée `D` = y, `E` = x |
| Sortie | aucune (pousse 0) |

### line(x1, y1, x2, y2, m) — index 12

| | |
|---|---|
| Rôle | trace un segment de droite |
| Arguments | extrémités `(x1,y1)`–`(x2,y2)` ; `m` = mode : 0 efface, 1 fin, 2 gras |
| Routine | `CMOD` (0x060C) règle le mode, puis `SEGA` (0x060F) ; un point = octet haut `y`, octet bas `x` |
| Sortie | aucune (pousse 0) |

---

## 4. Ajouter un nouvel appel système

1. Lire le handler dans `SYS.SR` ou `SAMOS.SR` : registres
   d'entrée, registre de sortie, convention d'erreur (le carry
   signale les erreurs sur Samos).
2. **PS.SR** : ajouter une ligne à `BLTTBL` —
   `.ASCIZ "nom"` puis `.B nargs, index`.
3. **VM.SR** : ajouter le pointeur du stub dans `SYSTBL`, puis
   écrire le stub `SCxxx` (dépile les args, `.W ?VECTEUR`, pousse
   un résultat). Vérifier que le vecteur préserve `IX` (= VSP).
4. **DSM.SR** : rien à faire — `BCSYS` est déjà listé par `/L`.

Coût d'un appel supplémentaire : 1 ligne de table + ~6 lignes de
stub.

---

## 5. Limites connues

- Un builtin ne peut pas (encore) être masqué par un `def` du même
  nom : le builtin est prioritaire.
- Les erreurs Samos (carry) ne sont pas encore remontées ; le
  premier lot ne contient que des appels sans échec. Les appels
  fichiers, à venir, retourneront un code testable.
