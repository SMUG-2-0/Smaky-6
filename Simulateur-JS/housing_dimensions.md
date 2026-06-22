# Cotes nécessaires et suffisantes — boîtier Smaky 6

Pour décrire entièrement le boîtier en tôles pliées et garantir qu'il est
toujours bien fermé, il suffit de mesurer les cotes ci-dessous. Le code
3D (`three3d.js`, structure `PARAMS`) calcule automatiquement les
dimensions déduites et la position des tôles voisines.

Toutes les cotes sont en **millimètres**, les angles en **degrés**.

## Tôle de fond (le U évasé)

| Cote | Description | Statut |
|------|-------------|--------|
| **A** | largeur du fond entre pliures latérales (axe gauche-droite) | mesurer |
| **G** | profondeur du fond (axe avant-arrière) | mesurer |
| **C** | projection horizontale du pan avant — côté clavier | mesurer |
| **D** | projection horizontale du pan arrière — côté capot | **déduit : `D = G − C`** |
| **E** | hauteur de la façade plate avant | mesurer |
| **F** | hauteur de la façade plate arrière | mesurer (peut différer de E) |
| **H** | hauteur du sommet du V au-dessus du plus haut des façades plates | mesurer |
| **α** | angle d'évasement des flancs depuis la verticale (≈ 20° estimé) | mesurer |

## Tôle clavier (deux surfaces pliées)

Aucune cote propre. Tout est contraint par la tôle de fond :

- **Hauteur face verticale** = E (sinon écart visible avec la façade plate avant)
- **Longueur face inclinée** = √(C² + H²) (= longueur réelle du pan avant)
- **Largeur** = A + 2 · y · tan(α) où y est la hauteur sur la pente
  (l'évasement des flancs élargit la tôle en montant)

## Tôle écran-disques (plate, inclinée)

| Cote | Description | Statut |
|------|-------------|--------|
| **L_ed** | hauteur le long de la pente | mesurer |
| **β_ed** | inclinaison vers l'arrière (depuis la verticale, ≈ 10° estimé) | mesurer |

## Tôle fond du capot (deux sections pliées)

| Cote | Description | Statut |
|------|-------------|--------|
| Section verticale | hauteur = F (contrainte d'emboîtement avec la façade plate arrière) | déduit |
| **L_arr** | longueur de la section haute le long de sa pente | mesurer |
| **β_arr** | inclinaison vers l'arrière (depuis la verticale, ≈ 5° estimé) | mesurer |

## Tôle supérieure du capot

**Aucune cote.** La pièce est entièrement déduite des sommets des tôles
écran-disques et arrière. Cohérence des inclinaisons et longueurs (β_ed,
β_arr, L_ed, L_arr) garantit la fermeture sans gap.

## Épaisseur

| Cote | Description |
|------|-------------|
| **t** | épaisseur uniforme des tôles (≈ 1.5 mm estimé) |

## Découpes sur la tôle écran-disques

Coordonnées dans le repère local de la tôle (X = largeur, Y = position
le long de la pente, origine au bas-centre).

### Découpe écran

| Cote | Description |
|------|-------------|
| **screenW** | largeur de la découpe |
| **screenH** | hauteur de la découpe |
| **screenCx** | position horizontale du centre |
| **screenCy** | position verticale du centre (depuis le bord bas) |

### Découpe baie disques (commune aux 2 emplacements)

| Cote | Description |
|------|-------------|
| **disksW** | largeur de la découpe |
| **disksH** | hauteur de la découpe |
| **disksCx** | position horizontale du centre |
| **disksCy** | position verticale du centre |

## Récapitulatif

**Structure** (9 cotes) : `A`, `G`, `C`, `E`, `F`, `H`, `α`, `L_ed`, `β_ed`,
`L_arr`, `β_arr` (D est déduit, donc 11 cotes nommées).

**Découpes** (8 cotes) : 4 par découpe.

**Matière** (1 cote) : `t`.

**Total à mesurer** : **20 cotes** — toutes les autres sont calculées
automatiquement.

## Contraintes vérifiées automatiquement par le code

- `D = G − C`
- Hauteur face verticale tôle clavier = E
- Hauteur section verticale tôle arrière = F
- Largeur des trapèzes au pli = largeur des flancs (suit α)
- Tôle supérieure du capot relie les sommets des 2 tôles inclinées
- Rabats latéraux du capot supérieur descendent sur les segments D des flancs
