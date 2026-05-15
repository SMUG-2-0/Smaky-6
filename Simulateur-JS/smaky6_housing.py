"""
Smaky 6 — boîtier en tôles pliées, génération paramétrique pour FreeCAD.

Usage :
  1. Ouvrir FreeCAD
  2. Menu  Macro → Macros…  (ou directement Édition → Préférences pour
     pointer le dossier Macro vers ce fichier)
  3. Sélectionner ce fichier et cliquer "Exécuter"
  4. Le document "Smaky6_Housing" est créé avec toutes les tôles

Pour modifier le boîtier : éditer la section PARAMÈTRES ci-dessous puis
ré-exécuter (Edit → Refresh ou rebooter le doc).

Toutes les cotes en millimètres, angles en degrés.
Repère scène : X = largeur (gauche-droite), Y = hauteur (vertical),
               Z = profondeur (avant = +Z, arrière = -Z).
"""

import FreeCAD as App
import Part
import math

# ═══════════════════════════════════════════════════════════════════
#                            PARAMÈTRES
# ═══════════════════════════════════════════════════════════════════

# ── Tôle de fond (le U évasé) ──
A          = 450    # largeur du fond entre pliures latérales
G          = 600    # profondeur du fond
C          = 190    # projection horizontale du pan avant (côté clavier)
E          = 50     # hauteur de la façade plate avant
F          = 50     # hauteur de la façade plate arrière
H          = 60     # hauteur du sommet du V au-dessus des façades plates
ALPHA_DEG  = 20     # angle d'évasement des flancs (depuis vertical)

# ── Tôle écran-disques (plate, inclinée) ──
L_ED       = 200    # hauteur le long de la pente
BETA_ED_DEG = 10    # inclinaison vers l'arrière (depuis vertical)

# ── Tôle fond du capot (2 sections pliées) ──
L_ARR        = 200  # longueur section haute le long de sa pente
BETA_ARR_DEG = 5    # inclinaison vers l'arrière (depuis vertical)

# ── Épaisseur uniforme ──
T = 1.5             # épaisseur tôle (toutes pièces identiques)

# ── Découpes sur la tôle écran-disques ──
# Coordonnées dans le repère local de la tôle (X = largeur centrée,
# Y = position le long de la pente, origine au bas-centre)
SCREEN_W   = 180
SCREEN_H   = 135
SCREEN_CX  = +110
SCREEN_CY  = +100

DISKS_W    = 180
DISKS_H    = 135
DISKS_CX   = -110
DISKS_CY   = +100

# ── Angle de rétrécissement des trapèzes au-dessus du V ──
# (pour que les bords des tôles écran-disques et arrière convergent
#  doucement vers le sommet du capot)
SHRINK_DEG = 10

# ═══════════════════════════════════════════════════════════════════
#                         COTES DÉDUITES
# ═══════════════════════════════════════════════════════════════════

D       = G - C
ALPHA   = math.radians(ALPHA_DEG)
BETA_ED = math.radians(BETA_ED_DEG)
BETA_ARR = math.radians(BETA_ARR_DEG)
SHRINK  = math.radians(SHRINK_DEG)
TAN_A   = math.tan(ALPHA)
TAN_S   = math.tan(SHRINK)

# Z scène du sommet du V (à distance C du bord avant)
Z_PEAK  = G / 2 - C
# Largeurs aux niveaux clés
W_AT_F  = A + 2 * F * TAN_A           # largeur des flancs au sommet de F
W_AT_E  = A + 2 * E * TAN_A           # largeur des flancs au sommet de E
W_PEAK  = A + 2 * (E + H) * TAN_A     # largeur des flancs au sommet du V

# Sommet (Y, Z, largeur) de la tôle écran-disques
Y_TOP_ED = (E + H) + L_ED * math.cos(BETA_ED)
Z_TOP_ED = Z_PEAK   - L_ED * math.sin(BETA_ED)
W_TOP_ED = W_PEAK   - 2 * L_ED * math.cos(BETA_ED) * TAN_S

# Sommet (Y, Z, largeur) de la tôle arrière (section haute)
Y_TOP_ARR = F + L_ARR * math.cos(BETA_ARR)
Z_TOP_ARR = -G/2 - L_ARR * math.sin(BETA_ARR)
W_TOP_ARR = W_AT_F - 2 * L_ARR * TAN_S

# ═══════════════════════════════════════════════════════════════════
#                          UTILITAIRES
# ═══════════════════════════════════════════════════════════════════

doc = App.newDocument("Smaky6_Housing")

def add(name, shape, color=None):
    """Ajoute un Solid au document avec un nom."""
    obj = doc.addObject("Part::Feature", name)
    obj.Shape = shape
    if color is not None and hasattr(obj, "ViewObject"):
        try:
            obj.ViewObject.ShapeColor = color
        except Exception:
            pass
    return obj

def face_from_pts(pts):
    """Construit une face plane à partir d'une liste de points (boucle fermée)."""
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    wire = Part.makePolygon([App.Vector(*p) for p in pts])
    return Part.Face(wire)

def face_with_holes(outer_pts, hole_pts_list):
    """Face plane avec trous (tous dans le même plan XY)."""
    def to_wire(pts):
        if pts[0] != pts[-1]:
            pts = pts + [pts[0]]
        return Part.makePolygon([App.Vector(*p) for p in pts])
    outer = to_wire(outer_pts)
    holes = [to_wire(h) for h in hole_pts_list]
    return Part.Face([outer] + holes)

# Couleurs (RGB en 0..1)
COLOR_BEIGE = (0.745, 0.659, 0.533)   # #beA888
COLOR_BRUN  = (0.122, 0.086, 0.059)   # #1f160f

# ═══════════════════════════════════════════════════════════════════
#                           TÔLE DE FOND
# ═══════════════════════════════════════════════════════════════════

def make_bottom_sheet():
    parts = []

    # Fond plat : box A × T × G, top à Y=0
    fond = Part.makeBox(A, T, G, App.Vector(-A/2, -T, -G/2))
    parts.append(("Bottom_fond", fond))

    # Flanc latéral : pentagone dans plan YZ, extrudé en X par T
    pts_pent = [
        (0, 0,     -G/2),    # V0 arrière-bas
        (0, 0,     +G/2),    # V1 avant-bas
        (0, E,     +G/2),    # V2 avant-haut façade
        (0, E + H, Z_PEAK),  # V3 sommet du V
        (0, F,     -G/2),    # V4 arrière-haut façade
    ]
    face_flank = face_from_pts(pts_pent)

    # Flanc gauche : extrusion en +X (vers l'intérieur), puis rotation +ALPHA
    # autour de Z (axe avant-arrière), puis translation à X = -A/2.
    flank_l = face_flank.extrude(App.Vector(T, 0, 0))
    flank_l.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), +ALPHA_DEG)
    flank_l.translate(App.Vector(-A/2, 0, 0))
    parts.append(("Bottom_flank_left", flank_l))

    # Flanc droit : extrusion en -X, rotation -ALPHA
    flank_r = face_flank.extrude(App.Vector(-T, 0, 0))
    flank_r.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), -ALPHA_DEG)
    flank_r.translate(App.Vector(+A/2, 0, 0))
    parts.append(("Bottom_flank_right", flank_r))

    return [(name, sh, COLOR_BRUN) for (name, sh) in parts]

# ═══════════════════════════════════════════════════════════════════
#                         TÔLE CLAVIER
# ═══════════════════════════════════════════════════════════════════

def make_keyboard_sheet():
    parts = []

    # Face verticale (trapèze : s'élargit en montant à cause de l'évasement)
    pts_v = [
        (-A/2,         0, 0),
        (+A/2,         0, 0),
        (+W_AT_E/2,    E, 0),
        (-W_AT_E/2,    E, 0),
    ]
    face_v = face_from_pts(pts_v)
    vert = face_v.extrude(App.Vector(0, 0, T))
    vert.translate(App.Vector(0, 0, G/2))
    parts.append(("Keyboard_vert", vert))

    # Face inclinée (trapèze) : du pli au sommet du V
    Cpan = math.sqrt(C*C + H*H)
    pts_i = [
        (-W_AT_E/2,  0, 0),
        (+W_AT_E/2,  0, 0),
        (+W_PEAK/2,  Cpan, 0),
        (-W_PEAK/2,  Cpan, 0),
    ]
    face_i = face_from_pts(pts_i)
    incl = face_i.extrude(App.Vector(0, 0, T))
    # Rotation autour de X pour aligner +Y local sur direction (0, +H, -C)/Cpan
    angle = math.degrees(math.atan2(-C, H))
    incl.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), angle)
    incl.translate(App.Vector(0, E, G/2))
    parts.append(("Keyboard_incl", incl))

    return [(name, sh, COLOR_BEIGE) for (name, sh) in parts]

# ═══════════════════════════════════════════════════════════════════
#                       TÔLE ÉCRAN-DISQUES
# ═══════════════════════════════════════════════════════════════════

def make_screen_disk_sheet():
    # Largeurs base / sommet (dans le repère local du trapèze)
    W_b = W_PEAK
    W_t = W_PEAK - 2 * L_ED * math.cos(BETA_ED) * TAN_S

    # Contour extérieur (trapèze)
    outer = [
        (-W_b/2, 0,    0),
        (+W_b/2, 0,    0),
        (+W_t/2, L_ED, 0),
        (-W_t/2, L_ED, 0),
    ]
    # Découpes (rectangles en local)
    def rect(cx, cy, w, h):
        return [
            (cx - w/2, cy - h/2, 0),
            (cx + w/2, cy - h/2, 0),
            (cx + w/2, cy + h/2, 0),
            (cx - w/2, cy + h/2, 0),
        ]
    holes = [
        rect(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H),
        rect(DISKS_CX,  DISKS_CY,  DISKS_W,  DISKS_H),
    ]
    face = face_with_holes(outer, holes)
    sheet = face.extrude(App.Vector(0, 0, T))

    # Placement : base à (0, E+H, Z_PEAK), inclinaison BETA_ED vers l'arrière
    sheet.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), -BETA_ED_DEG)
    sheet.translate(App.Vector(0, E + H, Z_PEAK))
    return [("ScreenDisk_sheet", sheet, COLOR_BEIGE)]

# ═══════════════════════════════════════════════════════════════════
#                      TÔLE FOND DU CAPOT (2 sections)
# ═══════════════════════════════════════════════════════════════════

def make_back_sheet():
    parts = []

    # Section verticale : trapèze qui s'élargit (suit F) — profil dans XY
    W_inflex = W_AT_F
    pts1 = [
        (-A/2,        0, 0),
        (+A/2,        0, 0),
        (+W_inflex/2, F, 0),
        (-W_inflex/2, F, 0),
    ]
    face1 = face_from_pts(pts1)
    sec1 = face1.extrude(App.Vector(0, 0, T))
    sec1.translate(App.Vector(0, 0, -G/2))
    parts.append(("Back_section_vert", sec1))

    # Section haute : trapèze qui rétrécit, inclinée vers l'arrière
    W_top = W_inflex - 2 * L_ARR * TAN_S
    pts2 = [
        (-W_inflex/2, 0,     0),
        (+W_inflex/2, 0,     0),
        (+W_top/2,    L_ARR, 0),
        (-W_top/2,    L_ARR, 0),
    ]
    face2 = face_from_pts(pts2)
    sec2 = face2.extrude(App.Vector(0, 0, T))
    sec2.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), +BETA_ARR_DEG)
    sec2.translate(App.Vector(0, F, -G/2))
    parts.append(("Back_section_incl", sec2))

    return [(name, sh, COLOR_BRUN) for (name, sh) in parts]

# ═══════════════════════════════════════════════════════════════════
#                   TÔLE SUPÉRIEURE DU CAPOT
# ═══════════════════════════════════════════════════════════════════

def make_top_capot_sheet():
    """Face médiane + 2 rabats latéraux qui descendent sur les segments D
    des flancs."""
    # 4 coins de la face médiane (peut être non-plane à cause de l'évasure
    # asymétrique — FreeCAD construit la face avec une légère arête au milieu).
    AvG = ( -W_TOP_ED/2,  Y_TOP_ED,  Z_TOP_ED )
    AvD = ( +W_TOP_ED/2,  Y_TOP_ED,  Z_TOP_ED )
    ArD = ( +W_TOP_ARR/2, Y_TOP_ARR, Z_TOP_ARR )
    ArG = ( -W_TOP_ARR/2, Y_TOP_ARR, Z_TOP_ARR )

    # Face médiane : on la construit comme 2 triangles cousus en BSpline
    # (quadrilatère gauche → on utilise Part.makeFilledFace ou makeShell).
    # Plus simple : extruder un wire fermé de 4 pts via Part.Face directe
    # (FreeCAD planarise automatiquement si l'écart est faible).
    pts_top = [AvG, AvD, ArD, ArG]
    face_top = face_from_pts(pts_top)
    top_solid = face_top.extrude(App.Vector(0, T, 0))   # épaisseur en +Y (vers le haut)

    # V3 et V4 du flanc gauche / droit
    def V(side):
        x_v3 = side * (A/2 + (E+H) * TAN_A)
        x_v4 = side * (A/2 + F * TAN_A)
        return {
            "V3": (x_v3, E + H, Z_PEAK),
            "V4": (x_v4, F,     -G/2 ),
            "Av": (side * W_TOP_ED/2,  Y_TOP_ED,  Z_TOP_ED),
            "Ar": (side * W_TOP_ARR/2, Y_TOP_ARR, Z_TOP_ARR),
        }
    parts = [("TopCapot_face", top_solid)]

    for side in (-1, +1):
        v = V(side)
        rabat_pts = [v["Av"], v["Ar"], v["V4"], v["V3"]]
        face_r = face_from_pts(rabat_pts)
        rabat_solid = face_r.extrude(App.Vector(side * T, 0, 0))
        name = "TopCapot_rabat_" + ("left" if side == -1 else "right")
        parts.append((name, rabat_solid))

    return [(name, sh, COLOR_BEIGE) for (name, sh) in parts]

# ═══════════════════════════════════════════════════════════════════
#                       CONSTRUCTION
# ═══════════════════════════════════════════════════════════════════

ALL_PARTS = (
    make_bottom_sheet()
    + make_keyboard_sheet()
    + make_screen_disk_sheet()
    + make_back_sheet()
    + make_top_capot_sheet()
)

for name, shape, color in ALL_PARTS:
    add(name, shape, color)

doc.recompute()

# Vue isométrique par défaut
try:
    Gui = App.Gui  # type: ignore
    Gui.activeDocument().activeView().viewIsometric()
    Gui.SendMsgToActiveView("ViewFit")
except Exception:
    pass

print(f"Smaky 6 boîtier généré : {len(ALL_PARTS)} pièces.")
