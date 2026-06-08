# Petit-Python pour Smaky 6 — Design v0.1

**Auteur** : Pierre-Yves Rochat (PYR), avec Claude
**Date** : 17 mai 2026 (mis à jour avec réponses PYR)
**Statut** : **v0.1 verrouillée**, prêt pour le codage

---

## 1. Workflow utilisateur

```
TEST.PY  ──[EPRO.SM]──>  fichier source édité
                              │
                              ▼
                       PYTHON             (commande Samos, sans argument)
                              │
                              ▼
                       PYTHON.SM exécuté :
                          1) charge TEST.PY en RAM (nom hardcodé en v0.1)
                          2) lex + parse + emit bytecode
                          3) exécute le bytecode dans la VM
                          4) retour Samos
```

`PYTHON.SR` (source CALM, multi-fichiers via `.INS`) → AS.SM → `PYTHON.SM` (exécutable).

**v0.1 — nom de fichier hardcodé** : `TEST.PY`. PYR n'a pas la doc du mécanisme d'argument de ligne de commande Samos sous la main (au bureau Epsitec). On la récupèrera pour v0.2 et on rendra la commande `PYTHON <fichier>` dynamique. Tant que ce n'est pas le cas, l'utilisateur édite **toujours** `TEST.PY` avec EPRO.

---

## 2. Layout mémoire (octal sauf indication)

```
000000 ┌─────────────────────────────────┐
       │  Système (SAMOS + SYS + écrans) │
       │  (en-dessous de 53000)          │
053000 ├─────────────────────────────────┤  ◄── début zone PYTHON.SM
       │  Code PYTHON.SM                 │
       │  (estimé 5–7 Ko)                │
   ??? ├─────────────────────────────────┤
       │  Variables internes (.BLKB)     │
       │  - table des variables Python   │
       │  - pile bytecode (VM stack)     │
       │  - tampon source (buffer .PY)   │
       │  - tampon bytecode              │
       │  - tampon ligne (édition err)   │
   ??? ├─────────────────────────────────┤
       │  Zone libre / heap futur (v0.2+)│
       │       ↓                         │
       │       ↑                         │
       │  Pile Z80 (descend)             │
177777 └─────────────────────────────────┘
```

**Budgets indicatifs v0.1** (à ajuster) :

| Zone | Taille | Notes |
|------|--------|-------|
| Code PYTHON.SM | ~5–7 Ko | lex + parse + emit + VM |
| Table variables | 64 entrées × 12 octets = 1 Ko | 8 car. nom + 2 oct. valeur + 2 réserve |
| Pile VM | 64 cellules × 2 octets = 200 oct. | cellules 16 bits |
| Buffer source `.PY` | 4 Ko | limite v0.1, à augmenter |
| Buffer bytecode | 2 Ko | bytecode plus dense que source |
| Pile indentation lex | 16 niveaux × 1 octet = 20 oct. | INDENT/DEDENT |
| Divers tampons | ~500 oct. | ligne courante, message err |
| **Total** | **~13–14 Ko** | sur 43,5 Ko disponibles |

Reste ~30 Ko pour la pile Z80 et l'expansion future. Marge confortable.

---

## 2 bis. Conventions CALM Smaky 6 — règles dures

### ⚠️ Symboles : unicité sur 6 premiers caractères

L'assembleur AS.SM ne prend en compte **que les 6 premiers caractères significatifs** des labels et symboles. Mais la longueur totale du symbole reste libre — on peut écrire `?GETCAR` plutôt que `?GETCA` si c'est plus lisible, **à condition qu'aucun autre symbole ne commence par les mêmes 6 caractères** (`?GETCA`).

**Règle pratique** :
- Longueur totale libre → privilégier la lisibilité (`?GETCAR`, `LXNEXT`, `PARSEXPR`).
- **Mais** : auditer chaque label pour unicité sur ses 6 premiers caractères.
- Donc `PARSEXPR` et `PARSEXTRA` collisionnent (`PARSEX` partagé) → un seul est valide.
- `PARSE_EXPR` et `PARSE_TERM` collisionnent (`PARSE_`) → renommer en `PSEXPR` et `PSTERM` par exemple.

Préfixes courts privilégiés : `LX` (lexer), `PS` (parser), `VM`, `IO`, `TB`. Mais on peut ouvrir plus long quand ça aide.

**Discipline** : avant chaque commit, audit visuel des labels susceptibles de collision sur 6 caractères.

### Directives utiles confirmées

- `.TITLE`, `.PROC Z80`, `.REF FLO`, `.END label` — entête / pied standard
- **`.LOC adresse`** — origine du code en mémoire. **Obligatoire** avant tout usage de RAM (validé HELLO.SR : `.LOC 53000` pour la zone utilisateur Smaky 6)
- `.INS <nom>` — inclut un fichier source (multi-fichiers OK)
- `.IF cond` / `.ENDIF` — assemblage conditionnel (utile pour code de debug)
- `.W val,val,...` — émet des mots 16 bits (little-endian)
- `.B val,val,...` — émet des octets
- `.BW val,val` — un octet puis un mot (utilisé par `?JUMPCAR` pour les tables de dispatch)
- `.BLKB n` — réserve n octets
- `.ASCIZ "texte"` — chaîne null-terminée. **Astuce** : `<CR>` dans la chaîne est traduit en caractère CR (`H'0D`) par l'assembleur — évite de chaîner un `?RETURN` séparé après l'affichage. Ex : `.ASCIZ "ERREUR<CR>"`
- Voir `../Simulateur-JS/samos_disasm/SAMOS.SR` et `../Simulateur-JS/horloge.sr` pour exemples complets

### Nombres dans le source

- `123` → octal par défaut (CALM 1re gen)
- `123.` → décimal
- `H'12` → hexadécimal (**pas d'apostrophe fermante**)
- `B'1010` → binaire (idem)
- `$nn` → port I/O (pas une adresse mémoire)

### Indirect et conditions

- `(HL)`, `(DE)`, `(IX+d)` — parens, jamais d'accolades
- `JUMP NE,LABEL` — espace puis virgule pour les conditions
- `LOAD A,(HL)` — ordre **dest, source** (Zilog-style)
- `LOAD` jamais `MOVE`

---

## 3. Lexique du langage

### Caractères acceptés

- ASCII 7 bits.
- Lettres latines `A-Z`, `a-z` ; **pas d'accents** (cohérent avec usage Smaky d'époque).
- Chiffres `0-9`.
- Underscores `_`.
- Opérateurs : `+ - * / // % == != < > <= >= = ( ) : ,`
- Espaces et tabulations significatives en début de ligne (indentation).

### Identificateurs

- 1 à 8 caractères (cohérent avec Samos 8.2) — *cf. question ouverte ci-après*.
- Premier caractère : lettre ou `_`.
- Caractères suivants : lettres, chiffres, `_`.
- Sensibles à la casse.

### Nombres littéraux

- Décimal uniquement en v0.1 : `0`, `42`, `-17` (signe géré par opérateur unaire).
- Plage : −32768 à +32767 (entier 16 bits signé).
- Pas de notation hex/oct/binaire en v0.1 (faisable v0.2).

### Indentation (CPython-like)

- Pile de niveaux d'indentation. À chaque ligne :
  - Compter espaces/tabs en début (1 tab = 8 espaces, ou rejet si tab+espaces mélangés).
  - Si plus profond que sommet → émission `INDENT` + push.
  - Si moins profond → émission `DEDENT` autant que nécessaire jusqu'à retrouver le niveau (sinon erreur).
  - Si égal → rien.
- Lignes blanches et commentaires ignorés pour l'indentation.
- Commentaire : `#` jusqu'à fin de ligne.

### Mots-clés v0.1

```
and   break   continue   elif   else   if   not   or   pass   print   while
```

`print` est traité comme un mot-clé en v0.1 (pas une fonction de bibliothèque, pour éviter d'introduire le mécanisme d'appel). Devient fonction en v0.2 quand `def` arrive.

---

## 4. Grammaire v0.1 (EBNF compact)

```ebnf
programme   = { instruction } EOF .
instruction = simple NL | composée .

simple      = affectation | print | pass | break | continue .
affectation = NOM "=" expr .
print       = "print" "(" [ expr { "," expr } ] ")" .

composée    = if | while .
if          = "if" expr ":" bloc { "elif" expr ":" bloc } [ "else" ":" bloc ] .
while       = "while" expr ":" bloc .
bloc        = NL INDENT { instruction } DEDENT .

expr        = ou .
ou          = et { "or" et } .
et          = non { "and" non } .
non         = "not" non | comparaison .
comparaison = somme [ relop somme ] .
relop       = "==" | "!=" | "<" | ">" | "<=" | ">=" .
somme       = terme { ("+"|"-") terme } .
terme       = unaire { ("*"|"/"|"//"|"%") unaire } .
unaire      = ["-"|"+"] facteur .
facteur     = NOMBRE | NOM | "(" expr ")" .
```

Précédence (du plus faible au plus fort) : `or`, `and`, `not`, comparaisons, `+ -`, `* / // %`, unaire, primaire.

---

## 5. Représentation des valeurs (v0.1)

**Un seul type** : entier 16 bits signé (complément à 2). Pas de tag.

- Valeur dans la VM = mot 16 bits sur la pile bytecode.
- Booléens = entiers : 0 = faux, ≠0 = vrai (`and`/`or` retournent un opérande, façon Python).
- v0.2 introduira un tag de type (1 octet) pour chaînes + autres.

---

## 6. Jeu de bytecodes v0.1

Format général : 1 octet opcode, suivi d'opérandes inline si nécessaire.

| Code | Mnémo | Opérandes | Effet |
|------|-------|-----------|-------|
| H'00 | `HALT`     | — | fin d'exécution, retour Samos |
| H'01 | `PUSHI`    | w (2 oct LE) | empile la constante 16 bits |
| H'02 | `LOAD`     | b (1 oct) | empile la variable n° b |
| H'03 | `STORE`    | b (1 oct) | dépile et range dans la variable n° b |
| H'10 | `ADD`      | — | NOS + TOS |
| H'11 | `SUB`      | — | NOS − TOS |
| H'12 | `MUL`      | — | NOS × TOS |
| H'13 | `DIV`      | — | NOS / TOS (entière, // Python) |
| H'14 | `MOD`      | — | NOS mod TOS |
| H'15 | `NEG`      | — | unaire − |
| H'20 | `EQ`       | — | NOS == TOS → 0/1 |
| H'21 | `NE`       | — | |
| H'22 | `LT`       | — | |
| H'23 | `LE`       | — | |
| H'24 | `GT`       | — | |
| H'25 | `GE`       | — | |
| H'30 | `NOT`      | — | logique : 0 → 1, ≠0 → 0 |
| H'31 | `AND`      | — | court-circuit géré au niveau parse (jump) |
| H'32 | `OR`       | — | idem |
| H'40 | `JUMP`     | w (offset signé) | saut relatif |
| H'41 | `JZ`       | w | dépile, saute si zéro |
| H'42 | `JNZ`      | w | dépile, saute si non zéro |
| H'50 | `PRINTI`   | — | dépile TOS, affiche en décimal |
| H'51 | `PRINTSP`  | — | affiche un espace séparateur |
| H'52 | `PRINTNL`  | — | affiche un saut de ligne (CR LF) |
| H'53 | `POP`      | — | dépile et jette (pour expressions-statements) |

**~20 opcodes pour v0.1.** Codes en H' pour clarté ; on garde 16 codes de marge par groupe pour extension future.

**Note sur `print(a, b, c)`** : compilé en séquence
```
<eval a>  PRINTI  PRINTSP
<eval b>  PRINTI  PRINTSP
<eval c>  PRINTI  PRINTNL
```

**Note sur `and`/`or` court-circuit** : compilés sans opcode `AND`/`OR`, en utilisant `JZ`/`JNZ` pour skip si déjà décidé. Les opcodes H'31/H'32 sont réservés pour le cas non-court-circuit (peu probable, mais on les garde).

---

## 7. Conventions Z80 / registres

| Registre | Usage principal |
|----------|-----------------|
| `IP`     | (= `IX` ou variable mémoire) pointeur instruction VM |
| `SP_VM`  | (= `IY` ou variable mémoire) sommet pile bytecode |
| `HL`     | scratch principal pour valeurs et adresses |
| `DE`     | scratch secondaire, opérandes arithmétiques |
| `BC`     | compteurs, valeurs auxiliaires |
| `AF`     | tests et résultats 8 bits |
| `SP`     | pile Z80 native, pour appels CALM internes uniquement |

**Décision pile VM** : pile séparée en RAM (pas confondue avec pile Z80) pour pouvoir manipuler facilement TOS/NOS et déboguer. Pointée par variable mémoire `SPVM` ou par registre dédié (probablement `IY`, peu utilisé ailleurs).

**Décision IP** : variable mémoire `IPVM` (16 bits). On la charge dans `HL` au début de chaque cycle fetch-decode-execute. Plus simple que de dédier `IX`.

---

## 8. Modules CALM — organisation `.SR` confirmée

Multi-fichiers via `.INS` (confirmé par PYR). Structure :

```
PYTHON.SR    ; module principal, point d'entrée, header .TITLE/.PROC/.REF
             ; contient les .INS pour les autres modules
   .INS TB   ; tables (mots-clés, opcodes, messages d'erreur)
   .INS IO   ; wrappers syscalls Samos
   .INS LX   ; lexer (tokenizer + indentation)
   .INS PS   ; parser + émetteur de bytecode
   .INS VM   ; fetch-decode-execute
   .INS RT   ; runtime (table des variables, pile VM)
.END START   ; point d'entrée
```

Fichiers à créer (noms Samos 8.2) :
- `PYTHON.SR` — point d'entrée + `.INS` des autres
- `TB.SR` — tables statiques
- `IO.SR` — wrappers Samos
- `LX.SR` — lexer
- `PS.SR` — parser/codegen
- `VM.SR` — interpréteur bytecode
- `RT.SR` — runtime/données

Tous résident dans `C:\Users\pyr\Documents\Smaky-6\MicroPythonSmaky6\`, transférés via le simulateur sur le Smaky pour assemblage.

---

## 9. Syscalls Samos utilisés (confirmés par PYR)

Liste verrouillée pour v0.1. Détails (registres in/out) tirés directement de PYR ; en cas de doute, source de vérité = `../Simulateur-JS/samos_disasm/SAMOS.SR` et `SYS.SR`.

### Écran alpha

| Syscall | Usage | Registres |
|---------|-------|-----------|
| `?DICAR`   | Affiche un caractère | IN: A = char |
| `?RETURN`  | Saut de ligne (CR) | — |
| `?SPACE`   | Affiche un espace | — |
| **`?DITEXT`** | Affiche texte 0-terminé (correction PYR : pas `?TEXT`) | IN: HL = adresse |
| `?TEXTIM`  | Affiche texte 0-terminé inline après l'appel | (texte suit le `.W ?TEXTIM`) |
| `?SETCURS` | Place curseur sur écran alpha | IN: HL = x-y |

### Clavier

| Syscall | Usage | Registres |
|---------|-------|-----------|
| `?GETCAR`  | Lit un caractère (bloquant ?) | OUT: A = char |
| `?IFCAR`   | Test caractère pressé (non-bloquant) | OUT: CC + A si oui, CS sinon |

### Fichiers (lecture byte)

| Syscall | Usage | Registres |
|---------|-------|-----------|
| `?OPEN`    | Ouvre en lecture byte | IN: DE = nom — OUT: **CS** + A=err si erreur, CC + A=canal sinon |
| `?RDBYTE`  | Lit des octets | IN: A=canal, BC=longueur, DE=buffer |
| `?CLOSE`   | Ferme | IN: A=canal |

### Système

| Syscall | Usage | Registres |
|---------|-------|-----------|
| **`?RTN`** | Retour à Samos depuis un `.SM` | — (terminer le `.SM` par `.W ?RTN`, pas un `RET`) |
| `?JUMPCAR` | Saut vers une adresse via table `.BW` (byte+word) | IN: DE = table — utile pour dispatch opcode/mot-clé |

### Test d'erreur après syscall

**Convention Samos confirmée HELLO.SR** : les erreurs sont signalées par **Carry Set**. Pattern :
```
	.W	?OPEN
	JUMP	CS,ERR_OPEN	;CS => ERREUR
```
Utiliser `JUMP CS,addr` plutôt que `JUMP LO,addr` (les deux testent C=1 mais `CS` exprime la sémantique d'erreur, `LO` celle d'une comparaison non-signée).

**Note sur `?TEXTIM`** : très pratique pour les messages statiques. `<CR>` est interprété dans `.ASCIZ` — pas besoin de chaîner `?RETURN` :
```
	.W	?TEXTIM
	.ASCIZ	"TEST.PY INTROUVABLE<CR>"
```

**Note sur `?JUMPCAR`** : candidat pour le dispatch des opcodes VM (table `.BW opcode,handler`). Alternative : table indexée directe par opcode (plus rapide en O(1), mais 2× plus de mémoire). Choix à finaliser à l'implémentation VM.

### Idiome Z80 : clear d'un buffer avec LDIR

Validé HELLO.SR :
```
	LOAD	HL,#BUFFER
	XOR	A,A
	LOAD	(HL),A		;1er octet := 0
	LOAD	DE,#BUFFER+1
	LOAD	BC,#TAILLE-1
	LDIR			;propage 0 sur tout le buffer
```
Plus court qu'une boucle manuelle.

---

## 10. Format des erreurs

Format minimal pour le PoC, affiché via `?TEXTIM` + `?TEXT` :
```
ERR LIGNE 12 : NOM INDEFINI
```

- N° de ligne tracké par le lexer (incrémenté à chaque CR).
- Messages courts dans une table `.ASCIZ`.
- Retour à Samos après affichage.

Codes d'erreur prévus v0.1 :
- E1 : Caractère interdit
- E2 : Indentation incohérente
- E3 : Token inattendu
- E4 : Nom indéfini
- E5 : Trop de variables (>64)
- E6 : Pile VM débordement
- E7 : Division par zéro
- E8 : Buffer source plein
- E9 : Buffer bytecode plein
- E10 : Fichier TEST.PY introuvable

---

## 11. Format du fichier `.PY`

- **Terminateur de ligne** : CR seul (`H'0D`), pas de LF. Convention Smaky. C'est ce que produit EPRO.
- **Terminateur de fichier en RAM** : 0 (`H'00`). À ajouter manuellement par `IO.SR` après `?RDBYTE`, puisque Samos ne marque pas la fin du fichier en RAM.
- **Caractères accentués** : Smaky 6 a son propre jeu de caractères accentués dans la zone ASCII 6 bits. Le lexer **doit les accepter et les conserver** dans les commentaires (et, plus tard, les chaînes). Ils sont traduits en UTF-8 lors des transferts $PP/$PR vers le PC hôte.
- **Identificateurs** : ASCII pur (lettres A-Z a-z chiffres underscore). Pas d'accents dans les identifiants.
- **Longueur de ligne** : pas de limite imposée par notre langage. EPRO en a probablement une (à mesurer si besoin).

### Chargement v0.1

```
1) ?OPEN avec DE → adresse de la chaîne "TEST.PY" (en ROM/code)
   - en cas d'erreur (CS), afficher "ERR : TEST.PY INTROUVABLE" et retour Samos
2) Sauver le canal (A) en variable CANAL
3) ?RDBYTE avec A=CANAL, BC=4000 (oct=2048 dec, soit 2 Ko), DE=SRCBUF
   - lit jusqu'à 2 Ko ou EOF, retourne longueur effective dans BC (à vérifier)
4) Écrire 0 en fin de buffer à SRCBUF+longueur
5) ?CLOSE avec A=CANAL
```

**À confirmer** : que renvoie `?RDBYTE` exactement en fin de fichier ? La longueur réelle lue dans BC, ou se contente-t-il de lire ce qu'on a demandé ? À tester avec SMILE quand on attaquera IO.SR.

---

## 12. Programme test cible (v0.1 — « Hello arithmétique »)

Le programme qu'on veut faire tourner en fin de v0.1 :

```python
# Premiers 20 nombres de Fibonacci
a = 0
b = 1
n = 0
while n < 20:
    print(a)
    c = a + b
    a = b
    b = c
    n = n + 1
```

Sortie attendue sur écran alpha :
```
0
1
1
2
3
5
...
4181
```

Si ça tourne, v0.1 est validé.

---

## 13. Résolution des questions (réponses PYR du 17 mai 2026)

| # | Question | Résolution |
|---|----------|------------|
| Q1 | Argument de ligne de commande Samos | **Hardcoder `TEST.PY`** en v0.1. La doc du mécanisme `PYTHON <arg>` est au bureau Epsitec, on traitera ça en v0.2. |
| Q2 | Longueur identifiants | **8 caractères** pour les noms Python. Rappel séparé : labels CALM limités à **6 caractères significatifs** (cf. §2 bis). |
| Q3 | Organisation source | **Multi-fichiers via `.INS`** — `PYTHON.SR` principal + `TB`, `IO`, `LX`, `PS`, `VM`, `RT`. |
| Q4 | Terminateur de ligne | **CR seul** (`H'0D`). Pas de LF. Accents Smaky acceptés/conservés en commentaire. |
| Q5 | Marqueur EOF | **Pas de marqueur fichier**, mais convention « texte en RAM terminé par 0 » — on ajoute le `H'00` nous-mêmes après `?RDBYTE`. |
| Q6 | Syscalls | Liste confirmée : `?DICAR ?RETURN ?SPACE ?TEXT ?TEXTIM ?SETCURS ?GETCAR ?IFCAR ?OPEN ?RDBYTE ?CLOSE ?JUMPCAR`. Détails registres en §9. |
| Q7 | Grammaire v0.1 | **OK**, validée. |

→ **v0.1 verrouillée**. Aucune ouverture nouvelle sans discussion explicite.

---

## 14. Plan de codage

Ordre d'écriture des modules, du plus petit/indépendant au plus dépendant. Chaque étape produit un binaire testable.

### Étape 1 — `IO.SR` (wrappers Samos)
Petites routines :
- `IOPCH a` — affiche le caractère en A (wrap `?DICAR`)
- `IOPTX hl` — affiche chaîne 0-terminée (wrap `?TEXT`)
- `IOPNL` — saut de ligne (wrap `?RETURN`)
- `IOPDN hl` — affiche entier 16 bits signé en décimal (utile pour `print` et debug)
- `IOPDH hl` — affiche entier en hexa 4 chiffres (debug)
- `IOOPN de` — ouvre fichier, retourne canal en A, CS si erreur
- `IORDB a, bc, de` — lit BC octets, retourne longueur effective
- `IOCLS a` — ferme

**Test isolé** : un mini-programme `HELLO.SR` qui ouvre `TEST.PY`, lit le contenu, le ré-affiche tel quel à l'écran, ferme. Si ça marche, on a validé : assemblage AS.SM + `.INS` + syscalls Samos + buffer RAM.

### Étape 2 — `TB.SR` (tables statiques)
- Table des mots-clés (`if`, `else`, `elif`, `while`, `print`, `and`, `or`, `not`, `pass`, `break`, `continue`) → code de token
- Table des opérateurs (`==`, `!=`, `<=`, `>=`, `<`, `>`, `+`, `-`, `*`, `/`, `//`, `%`, `=`, `(`, `)`, `:`, `,`) → code de token
- Table des messages d'erreur (`.ASCIZ`)
- Table de dispatch des opcodes (selon stratégie choisie en VM)

### Étape 3 — `LX.SR` (lexer)
- `LXINIT` — initialise état (ptr courant = début SRCBUF, pile indent vide, ligne=1)
- `LXNEXT` — produit le token suivant en mémoire (`TKTYPE`, `TKVAL`, `TKLINE`)
- Gestion INDENT/DEDENT via pile
- **Test isolé** : appeler LXNEXT en boucle, afficher chaque token, comparer à l'œil avec le source.

### Étape 4 — `PS.SR` (parser + codegen)
- Descente récursive sur la grammaire §4
- Émet directement les octets de bytecode dans BCBUF
- Gestion des sauts en avant (backpatching pour `if`/`while`)
- **Test isolé** : compiler un programme, afficher le bytecode en hexa.

### Étape 5 — `VM.SR` (interpréteur)
- Boucle fetch-decode-execute
- Pile VM en RAM, pointée par variable `SPVM`
- Table des variables Python en RAM (`VARTBL`, 64 × 12 octets)
- **Test final** : Fibonacci 20 premiers nombres.

### Effort estimé
**2–4 semaines de travail concentré** (PYR + aller-retours sur SMILE / simulateur).

---

## 15. Décisions à prendre lors de l'implémentation (pas avant)

Petites décisions qu'on tranchera quand on y arrivera, pas maintenant :

- Choix table de dispatch VM : `?JUMPCAR` (compact, O(N)) vs table indexée directe (O(1), 168 octets).
- Représentation interne de l'état lexer : registres dédiés ou variables mémoire ?
- Politique d'erreur fatale vs récupérable (sans doute fatale pour v0.1).
- Format précis du bytecode pour les sauts : offset relatif (signé 16 bits) ou adresse absolue ? L'offset relatif rend le bytecode position-indépendant ; l'absolu est plus simple. *Hypothèse de travail : absolu, on changera si problème.*
