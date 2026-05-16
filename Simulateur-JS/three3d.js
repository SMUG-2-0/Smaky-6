// Smaky 6 — vue 3D du boîtier (Three.js).
//
// Modèle approximatif d'après photo smaky-6.jpg :
//   - base parallélépipède (zone clavier) reposant sur un socle brun foncé ;
//   - capot trapézoïdal au-dessus, face avant inclinée vers l'arrière ;
//   - écran encadré, posé sur la face inclinée, décalé à droite (les deux
//     lecteurs Micropolis s'empilaient à gauche — particularité Smaky 6).
//
// Toutes les dimensions sont dans PARAMS pour ajustement après mesures.
'use strict';

// ─── Paramètres dimensionnels ────────────────────────────────────
// (en unités scène arbitraires ; à recaler après mesures chez Epsitec)
const PARAMS = {
    // Socle brun foncé qui déborde sous tout le boîtier.
    PLINTH_HEIGHT:    0.18,
    PLINTH_OVERHANG:  0.10,

    // Base (zone clavier) : avance plus que le capot vers l'utilisateur.
    BASE_W: 5.0,
    BASE_H: 0.70,
    BASE_D: 3.20,

    // Capot trapézoïdal (zone écran + lecteurs) : assis à l'arrière de la base,
    // sa face avant penche vers l'arrière en montant (CAPOT_TILT = recul du sommet).
    CAPOT_W: 5.0,
    CAPOT_H: 1.50,
    CAPOT_D: 2.40,         // profondeur en bas (au niveau de la base)
    CAPOT_TILT: 0.45,      // recul du sommet par rapport au bas (face inclinée)

    // Écran sur la face avant inclinée du capot.
    SCREEN_QUAD_W: 1.55,
    SCREEN_QUAD_H: 1.16,   // ≈ ratio 4:3 du Smaky
    SCREEN_OFFSET_X: +1.05,
    SCREEN_BEZEL: 0.09,    // épaisseur du cadre noir autour de l'écran
    SCREEN_INSET:  0.012,  // l'écran s'enfonce légèrement dans le bezel

    // Baie lecteurs (à gauche de l'écran). Deux emplacements empilés.
    // Pour chacun : 'floppy' | 'hd' | 'blank' (cache aluminium).
    DRIVE_OFFSET_X: -1.05,
    DRIVE_W: 1.45,
    DRIVE_H: 0.56,         // 2 × 0.56 + GAP = ≈ hauteur de l'écran
    DRIVE_GAP: 0.04,
    DRIVE_TOP_TYPE:    'floppy',
    DRIVE_BOTTOM_TYPE: 'hd',
};

// ─── Description en tôles (mm → unités scène) ────────────────────
// Conversion : 1 unité scène = 100 mm.
const MM = 1 / 100;

// Épaisseur uniforme de toutes les tôles du Smaky 6 (mm).
// Plus élevée que la tôle réelle pour tenir compte de la peinture.
let SHEET_THICKNESS_MM = 2;

// Paramètres de rendu — modifiables via le panneau Rendu.
const RENDER_PARAMS = {
    AMBIENT:       0.75,        // intensité ambient (0..2)
    KEY:           0.40,        // intensité directional key (0..2)
    FILL:          0.40,        // intensité directional fill (0..2)
    BG_COLOR:      0x1a1a1a,    // couleur de fond de la scène
    BEIGE_ROUGH:   1.0,         // roughness matériau beige (0..1)
    BRUN_ROUGH:    1.0,         // roughness matériau brun (0..1)
    FOV:           35,          // FOV caméra (degrés, 20..60)
};

// Tôle « fond du capot » : pièce plate trapézoïdale, posée sur le pan D
// arrière des flancs. Base au bord arrière du fond (suit les 2 segments
// F = portion latérale arrière), rétrécit en montant vers le sommet du V.
const SHEET_BACK = {
    TILT_BACK_DEG: 1,    // inclinaison vers l'arrière (depuis vertical)
    HEIGHT:        200,  // longueur de la section haute le long de sa pente
};

// Tôle « écran-disques » : pièce plate trapézoïdale, monte presque
// verticalement depuis le sommet du V (fin de la tôle clavier), un peu
// penchée vers l'arrière. Porte 2 découpes : écran à droite, baie disques
// à gauche. Toutes les valeurs en mm.
const SHEET_SCREEN_DISK = {
    HEIGHT:         200,    // hauteur de la pièce le long de la pente
    TILT_BACK_DEG:  10,     // inclinaison vers l'arrière (par rapport à vertical)
    SHRINK_DEG:     10,     // angle de rétrécissement de la pièce vers le haut
    OVERLAP:        10,     // recouvrement par le capot (la tôle passe sous, mm)

    // Découpe écran (rectangulaire) — coordonnées 2D dans le plan local
    // (X = largeur, Y = position le long de la pente, Y = 0 au bas).
    SCREEN_W:        180,
    SCREEN_H:        135,
    SCREEN_CENTER_X: +110,
    SCREEN_CENTER_Y: +100,

    // Cadre plastique noir devant l'écran. Chaque côté est paramétrable
    // indépendamment (utile pour donner un look « TV années 60 »).
    BEZEL_TOP:    9,    // largeur du cadre en haut (mm)
    BEZEL_BOT:    9,    // largeur du cadre en bas
    BEZEL_LEFT:   9,    // largeur du cadre à gauche
    BEZEL_RIGHT:  9,    // largeur du cadre à droite
    BEZEL_DEPTH:  7,    // épaisseur (= relief vers l'avant, mm)

    // Découpe disques (rectangulaire, commune aux 2 emplacements).
    DISKS_W:         180,
    DISKS_H:         135,
    DISKS_CENTER_X:  -110,
    DISKS_CENTER_Y:  +100,
};

// Tôle « clavier » : 2 surfaces pliées.
//   - face verticale en bas (touche le bord avant du fond, monte sur E)
//   - face inclinée qui suit le pan avant des flancs (longueur C ≈ 190 mm)
const SHEET_KEYBOARD = {
    FACE_VERT_H: 50,   // E : hauteur de la face verticale (mm)
    // La longueur de la face inclinée et son angle sont déduits de la
    // géométrie du pan avant des flancs (TILT_FRONT_PROJ + TILT_PEAK_H).
};

// Tôle « du fond » : forme U évasé avec sommet en V asymétrique.
// Toutes les valeurs en mm. Cotes du croquis-smaky6-fond.jpeg :
//   A = B = 450, C = 190, D = 410, G = 600.
// F (hauteur façade plate) et la hauteur du sommet : à mesurer.
const SHEET_BOTTOM = {
    W:                450,   // A : largeur du fond plat (gauche-droite)
    D:                600,   // G : profondeur du fond plat (avant-arrière)
    FLANK_TILT_DEG:   20,    // évasement des flancs (70° du fond = 20° du vertical)
    FACADE_H:         50,    // hauteur de la façade plate (= FACE_VERT_H pour emboîtement)
    TILT_FRONT_PROJ:  195,   // C : projection horiz. du pan avant (côté clavier)
    TILT_BACK_PROJ:   405,   // D : projection horiz. du pan arrière (= G − C)
    TILT_PEAK_H:      30,    // hauteur du sommet du toit au-dessus de la façade
};

// ─── Couleurs (prélevées sur smaky-6.jpg) ────────────────────────
const COLOR_BEIGE   = 0xbea888;
const COLOR_BRUN    = 0x1f160f;   // brun très foncé (échantillon photo trop clair sous éclairage)
const COLOR_BEZEL   = 0x202020;   // cadre du moniteur, presque noir
const COLOR_DRIVE   = 0x141414;   // boîtier des lecteurs (noir mat)
const COLOR_SLOT    = 0x050505;   // fente d'insertion disquette
const COLOR_LATCH   = 0xc8c4b8;   // levier de fermeture du floppy
const COLOR_LED_OFF = 0x401010;   // LED rouge éteinte (sombre, presque noire)
const COLOR_LED_ON  = 0xff2828;   // LED rouge allumée
const LED_PULSE_MS  = 100;        // durée d'allumage après un accès
const COLOR_ALU     = 0xb0b0b0;   // cache aluminium brossé

let _renderer    = null;
let _scene       = null;
let _camera      = null;
let _controls    = null;
let _screenTex   = null;
let _screenMesh  = null;     // pour ajustement de la bordure phosphore
let _bgMat       = null;     // matériau du fond phosphore (derrière l'image)
let _animating   = false;
let _container   = null;
let _leds        = [];   // [{mesh, type:'floppy'|'hd'}, ...]
let _housingGroup = null; // contient toutes les pièces du boîtier (pour rebuild)
let _sourceCanvas = null; // mémorisé pour pouvoir reconstruire l'écran texturé
let _ambientLight = null;
let _keyLight     = null;
let _fillLight    = null;

function init3D(container, sourceCanvas) {
    _container = container;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setSize(container.clientWidth, container.clientHeight);
    // Espace de couleur sRGB en sortie : sans ça, les couleurs sombres
    // (ex. brun #372d28) sortent délavées (apparaissent beige clair).
    _renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(RENDER_PARAMS.BG_COLOR);

    _camera = new THREE.PerspectiveCamera(
        RENDER_PARAMS.FOV, container.clientWidth / container.clientHeight, 0.1, 100);
    _camera.position.set(0, 2.2, 8.5);

    // Éclairage : ambient dominante + key/fill symétriques.
    _ambientLight = new THREE.AmbientLight(0xffffff, RENDER_PARAMS.AMBIENT);
    _scene.add(_ambientLight);
    _keyLight = new THREE.DirectionalLight(0xffffff, RENDER_PARAMS.KEY);
    _keyLight.position.set(4, 6, 5);
    _scene.add(_keyLight);
    _fillLight = new THREE.DirectionalLight(0xffffff, RENDER_PARAMS.FILL);
    _fillLight.position.set(-4, 6, 5);
    _scene.add(_fillLight);

    _buildHousing(sourceCanvas);

    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.target.set(0, 1.0, 0);     // milieu vertical du Smaky
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.08;
    _controls.minDistance   = 4.0;
    _controls.maxDistance   = 25;
    _controls.zoomSpeed     = 0.3;       // molette plus douce (défaut: 1.0)
    _controls.update();

    window.addEventListener('resize', _onResize);
}

// ─── Construction du boîtier ─────────────────────────────────────
// Refonte en cours : passage du « modèle volumes pleins » (capot + base
// + plinthe) au « modèle tôles » fidèle à la fabrication réelle. Les
// anciens éléments sont commentés pendant qu'on monte les tôles une à une.
function _buildHousing(sourceCanvas) {
    _sourceCanvas = sourceCanvas;

    // Group qui contient toutes les pièces du boîtier (créé une seule fois,
    // vidé à chaque reconstruction).
    if (!_housingGroup) {
        _housingGroup = new THREE.Group();
        _scene.add(_housingGroup);
    } else {
        while (_housingGroup.children.length > 0) {
            _housingGroup.remove(_housingGroup.children[0]);
        }
    }
    _leds = [];
    _screenTex = null;
    _screenMesh = null;
    _bgMat = null;

    // Redirige temporairement _scene.add vers _housingGroup pendant
    // la construction (évite d'éparpiller des _housingGroup.add partout).
    const sceneAddOriginal = _scene.add.bind(_scene);
    _scene.add = function(obj) { _housingGroup.add(obj); return _housingGroup; };
    try {
        _buildBottomSheet();
        _buildKeyboardSheet();
        _buildKeyboard();
        _buildScreenDiskSheet();
        _buildBackSheet();
        _buildTopCapotSheet();
        _buildScreenAssembly(sourceCanvas);
        _buildDrives();
        // _buildDimensionLabels();   // désactivé pour la version 0.6.0
    } finally {
        _scene.add = sceneAddOriginal;
    }
}

// Reconstruit le boîtier (après modification de paramètres).
function rebuildHousing() {
    if (_sourceCanvas) _buildHousing(_sourceCanvas);
}

// Setter pour les paramètres de rendu. Applique immédiatement les
// changements sur les lumières / scène / caméra ; pour les matériaux
// il faut rebuildHousing().
function setRenderParam(key, value) {
    if (key === 'BG_COLOR') {
        // Couleur en hex (chaîne « #aabbcc » ou nombre)
        let c = value;
        if (typeof c === 'string' && c.startsWith('#')) c = parseInt(c.slice(1), 16);
        RENDER_PARAMS.BG_COLOR = c;
        if (_scene) _scene.background = new THREE.Color(c);
        return;
    }
    const v = parseFloat(value);
    if (isNaN(v)) return;
    RENDER_PARAMS[key] = v;
    switch (key) {
        case 'AMBIENT': if (_ambientLight) _ambientLight.intensity = v; break;
        case 'KEY':     if (_keyLight)     _keyLight.intensity     = v; break;
        case 'FILL':    if (_fillLight)    _fillLight.intensity    = v; break;
        case 'FOV':     if (_camera)     { _camera.fov = v; _camera.updateProjectionMatrix(); } break;
        case 'BEIGE_ROUGH':
        case 'BRUN_ROUGH':
            // Matériaux recréés à chaque rebuild.
            rebuildHousing();
            break;
    }
}

function getRenderParam(key) {
    if (key === 'BG_COLOR') {
        return '#' + RENDER_PARAMS.BG_COLOR.toString(16).padStart(6, '0');
    }
    return RENDER_PARAMS[key];
}

// Setter unifié pour les paramètres du boîtier.
function setHousingParam(key, value) {
    const v = parseFloat(value);
    if (isNaN(v)) return;
    switch (key) {
        case 'A':        SHEET_BOTTOM.W = v; break;
        case 'G':        SHEET_BOTTOM.D = v;
                         SHEET_BOTTOM.TILT_BACK_PROJ = v - SHEET_BOTTOM.TILT_FRONT_PROJ; break;
        case 'C':        SHEET_BOTTOM.TILT_FRONT_PROJ = v;
                         SHEET_BOTTOM.TILT_BACK_PROJ  = SHEET_BOTTOM.D - v; break;
        case 'E':        SHEET_KEYBOARD.FACE_VERT_H = v; break;
        case 'F':        SHEET_BOTTOM.FACADE_H = v; break;
        case 'H':        SHEET_BOTTOM.TILT_PEAK_H = v; break;
        case 'ALPHA':    SHEET_BOTTOM.FLANK_TILT_DEG = v; break;
        case 'L_ED':     SHEET_SCREEN_DISK.HEIGHT = v; break;
        case 'BETA_ED':  SHEET_SCREEN_DISK.TILT_BACK_DEG = v; break;
        case 'L_ARR':    SHEET_BACK.HEIGHT = v; break;
        case 'BETA_ARR': SHEET_BACK.TILT_BACK_DEG = v; break;
        case 'SHRINK':   SHEET_SCREEN_DISK.SHRINK_DEG = v; break;
        case 'OVERLAP':  SHEET_SCREEN_DISK.OVERLAP = v; break;
        case 'THICKNESS':   SHEET_THICKNESS_MM = v; break;
        case 'BEZEL_TOP':   SHEET_SCREEN_DISK.BEZEL_TOP   = v; break;
        case 'BEZEL_BOT':   SHEET_SCREEN_DISK.BEZEL_BOT   = v; break;
        case 'BEZEL_LEFT':  SHEET_SCREEN_DISK.BEZEL_LEFT  = v; break;
        case 'BEZEL_RIGHT': SHEET_SCREEN_DISK.BEZEL_RIGHT = v; break;
        case 'BEZEL_DEPTH': SHEET_SCREEN_DISK.BEZEL_DEPTH = v; break;
    }
}

// Lit la valeur courante d'un paramètre (pour pré-remplir l'UI).
function getHousingParam(key) {
    switch (key) {
        case 'A':        return SHEET_BOTTOM.W;
        case 'G':        return SHEET_BOTTOM.D;
        case 'C':        return SHEET_BOTTOM.TILT_FRONT_PROJ;
        case 'E':        return SHEET_KEYBOARD.FACE_VERT_H;
        case 'F':        return SHEET_BOTTOM.FACADE_H;
        case 'H':        return SHEET_BOTTOM.TILT_PEAK_H;
        case 'ALPHA':    return SHEET_BOTTOM.FLANK_TILT_DEG;
        case 'L_ED':     return SHEET_SCREEN_DISK.HEIGHT;
        case 'BETA_ED':  return SHEET_SCREEN_DISK.TILT_BACK_DEG;
        case 'L_ARR':    return SHEET_BACK.HEIGHT;
        case 'BETA_ARR': return SHEET_BACK.TILT_BACK_DEG;
        case 'SHRINK':   return SHEET_SCREEN_DISK.SHRINK_DEG;
        case 'OVERLAP':  return SHEET_SCREEN_DISK.OVERLAP;
        case 'THICKNESS':   return SHEET_THICKNESS_MM;
        case 'BEZEL_TOP':   return SHEET_SCREEN_DISK.BEZEL_TOP;
        case 'BEZEL_BOT':   return SHEET_SCREEN_DISK.BEZEL_BOT;
        case 'BEZEL_LEFT':  return SHEET_SCREEN_DISK.BEZEL_LEFT;
        case 'BEZEL_RIGHT': return SHEET_SCREEN_DISK.BEZEL_RIGHT;
        case 'BEZEL_DEPTH': return SHEET_SCREEN_DISK.BEZEL_DEPTH;
    }
    return null;
}

// ─── Baie disques (dans la découpe DISKS de la tôle écran-disques) ──
// Floppy en haut, disque dur en bas (paramétrable plus tard).
function _buildDrives() {
    const SD  = SHEET_SCREEN_DISK;
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const D_2 = SB.D * MM / 2;

    const tilt_sd  = SD.TILT_BACK_DEG * Math.PI / 180;
    const Y_bot_sd = E + Hp;
    const Z_bot_sd = D_2 - Tp;

    // Group orienté comme la tôle écran-disques.
    const bay = new THREE.Group();
    bay.position.set(0, Y_bot_sd, Z_bot_sd);
    bay.rotation.x = -tilt_sd;
    _scene.add(bay);

    // Centre + dimensions de la baie (= découpe DISKS sur la tôle).
    const cx  = SD.DISKS_CENTER_X * MM;
    const cy  = SD.DISKS_CENTER_Y * MM;
    const bw  = SD.DISKS_W * MM;
    const bh  = SD.DISKS_H * MM;
    const gap = 4 * MM;
    const driveH = (bh - gap) / 2;

    // Plaque noire de fond couvrant toute la baie.
    const backDepth = 5 * MM;
    const back = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, backDepth),
        new THREE.MeshStandardMaterial({
            color: COLOR_DRIVE, roughness: 0.7, metalness: 0.05, flatShading: true,
        }),
    );
    back.position.set(cx, cy, backDepth / 2);
    bay.add(back);

    // 2 emplacements (haut = floppy, bas = HD), légèrement en relief.
    const slotZ = backDepth + 1 * MM;
    const yTop  = cy + (driveH + gap) / 2;
    const yBot  = cy - (driveH + gap) / 2;

    const topSlot = new THREE.Group();
    topSlot.position.set(cx, yTop, slotZ);
    bay.add(topSlot);
    _buildDriveFloppy(topSlot, bw, driveH);

    const botSlot = new THREE.Group();
    botSlot.position.set(cx, yBot, slotZ);
    bay.add(botSlot);
    _buildDriveHD(botSlot, bw, driveH);
}

// ─── Cadre + écran texturé sur la tôle écran-disques ────────────
// Cadre noir creux (4 rectangles haut/bas/gauche/droite) qui dépasse vers
// l'extérieur de la tôle écran-disques, écran texturé en retrait.
function _buildScreenAssembly(sourceCanvas) {
    const SD  = SHEET_SCREEN_DISK;
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const D_2 = SB.D * MM / 2;

    const tilt_sd  = SD.TILT_BACK_DEG * Math.PI / 180;
    const Y_bot_sd = E + Hp;
    const Z_bot_sd = D_2 - Tp;

    // Group orienté comme la tôle écran-disques.
    const group = new THREE.Group();
    group.position.set(0, Y_bot_sd, Z_bot_sd);
    group.rotation.x = -tilt_sd;

    // Centre de la découpe écran (en local du shape 2D = local du group).
    const cx = SD.SCREEN_CENTER_X * MM;
    const cy = SD.SCREEN_CENTER_Y * MM;
    const sw = SD.SCREEN_W * MM;
    const sh = SD.SCREEN_H * MM;

    // Cadre plastique : 4 côtés indépendants + épaisseur.
    const bzT = SD.BEZEL_TOP   * MM;
    const bzB = SD.BEZEL_BOT   * MM;
    const bzL = SD.BEZEL_LEFT  * MM;
    const bzR = SD.BEZEL_RIGHT * MM;
    const bezelDepth = SD.BEZEL_DEPTH * MM;

    const bezelMat = new THREE.MeshStandardMaterial({
        color: 0x202020, roughness: 0.55, metalness: 0.0, flatShading: true,
    });

    // Rectangles top/bot couvrent la largeur de l'écran ; les latéraux
    // (left/right) couvrent toute la hauteur incluant top + bot pour fermer
    // les coins sans chevauchement.
    function addBezel(w, h, x, y) {
        if (w <= 0 || h <= 0) return;
        const m = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, bezelDepth), bezelMat);
        m.position.set(x, y, bezelDepth / 2);
        group.add(m);
    }
    // top et bot : largeur sw (juste l'écran), hauteur = bzT ou bzB
    addBezel(sw,  bzT, cx, cy + sh / 2 + bzT / 2);
    addBezel(sw,  bzB, cx, cy - sh / 2 - bzB / 2);
    // left et right : largeur bzL/bzR, hauteur = sh + bzT + bzB (fermeture coins)
    const sideH  = sh + bzT + bzB;
    const sideCy = cy + (bzT - bzB) / 2;     // centré entre top et bot
    addBezel(bzL, sideH, cx - sw / 2 - bzL / 2, sideCy);
    addBezel(bzR, sideH, cx + sw / 2 + bzR / 2, sideCy);

    // Fond phosphore au repos (couleur off de la palette courante).
    // Visible dans la bordure CRT autour du textCanvas quand l'utilisateur
    // augmente crtBorderPercent → setScreenBorder rétrécit _screenMesh.
    _bgMat = new THREE.MeshBasicMaterial({ color: 0x001000 });
    const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), _bgMat);
    bgPlane.position.set(cx, cy, bezelDepth / 2 - 1.5 * MM - 0.001);
    group.add(bgPlane);

    // Écran texturé, en retrait dans le cadre creux.
    _screenTex = new THREE.CanvasTexture(sourceCanvas);
    _screenTex.magFilter = THREE.NearestFilter;
    _screenTex.minFilter = THREE.LinearFilter;
    _screenTex.generateMipmaps = false;
    // Marquer la texture comme sRGB (= ce qu'est un canvas DOM) pour que
    // outputEncoding=sRGB de WebGLRenderer ne sature pas les couleurs.
    _screenTex.encoding = THREE.sRGBEncoding;
    const screenMat = new THREE.MeshBasicMaterial({ map: _screenTex });
    _screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), screenMat);
    _screenMesh.position.set(cx, cy, bezelDepth / 2 - 1.5 * MM);
    group.add(_screenMesh);

    _scene.add(group);
}

// ─── Tôle supérieure du capot ───────────────────────────────────
// Plate trapézoïdale qui ferme le sommet du Smaky en reliant le bord haut
// de la tôle écran-disques (avant, plus haut, plus large) à celui de la
// tôle arrière (arrière, plus bas, plus étroit). Ses 2 bords latéraux
// suivent une pente parallèle aux segments D des flancs.
function _buildTopCapotSheet() {
    const SB  = SHEET_BOTTOM;
    const SBK = SHEET_BACK;
    const SD  = SHEET_SCREEN_DISK;
    const SK  = SHEET_KEYBOARD;
    const W   = SB.W * MM;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const D_2 = SB.D * MM / 2;
    const F_h = SB.FACADE_H * MM;
    const tan_a      = Math.tan(SB.FLANK_TILT_DEG * Math.PI / 180);
    const tan_shrink = Math.tan(SHEET_SCREEN_DISK.SHRINK_DEG * Math.PI / 180);

    const tilt_sd = SD.TILT_BACK_DEG * Math.PI / 180;
    const tilt_bk = SBK.TILT_BACK_DEG * Math.PI / 180;
    const Hp_p    = SD.HEIGHT * MM;

    // Sommet de la tôle écran-disques (la tôle s'arrête là, mais le capot
    // dépasse ensuite vers l'avant de OVERLAP mm — la tôle passe SOUS).
    const Y_sd_end = E + Hp + Hp_p * Math.cos(tilt_sd);
    const Z_sd_end = (D_2 - Tp) - Hp_p * Math.sin(tilt_sd);
    const W_bot_sd = W + 2 * (E + Hp) * tan_a;
    const W_top_sd = W_bot_sd - 2 * Hp_p * Math.cos(tilt_sd) * tan_shrink;

    // Sommet de la tôle arrière section 2 — DOIT correspondre exactement
    // au sommet réel construit dans _buildBackSheet (sinon le capot
    // supérieur ne tombe pas sur l'arête haute de la tôle arrière).
    const W_inflex   = W + 2 * F_h * tan_a;
    const len_bk     = SHEET_BACK.HEIGHT * MM;
    const Y_top_bk   = F_h + len_bk * Math.cos(tilt_bk);
    const Z_top_bk   = -D_2 - len_bk * Math.sin(tilt_bk);
    const W_top_bk   = Math.min(W_top_sd, W_inflex);

    // Prolongation du bord avant du capot vers l'avant, DANS LE PLAN du
    // capot (= dans la direction du sommet arrière vers le sommet avant).
    // La tôle écran-disques s'arrête au sommet, le capot dépasse au-dessus.
    const overlap = SD.OVERLAP * MM;
    const dY  = Y_sd_end - Y_top_bk;
    const dZ  = Z_sd_end - Z_top_bk;
    const dL  = Math.sqrt(dY * dY + dZ * dZ);
    const ext = dL > 0 ? overlap / dL : 0;
    const Y_top_sd = Y_sd_end + dY * ext;   // coins avant du capot supérieur
    const Z_top_sd = Z_sd_end + dZ * ext;

    const beigeMat = new THREE.MeshStandardMaterial({
        color: COLOR_BEIGE, roughness: RENDER_PARAMS.BEIGE_ROUGH, metalness: 0.0, flatShading: true,
        side: THREE.DoubleSide,
    });

    // ── Face supérieure (trapèze plat) ──
    const v = new Float32Array([
        -W_top_sd / 2, Y_top_sd, Z_top_sd,    // 0 AvG
        +W_top_sd / 2, Y_top_sd, Z_top_sd,    // 1 AvD
        +W_top_bk / 2, Y_top_bk, Z_top_bk,    // 2 ArD
        -W_top_bk / 2, Y_top_bk, Z_top_bk,    // 3 ArG
    ]);
    const idx = [
        0, 3, 2,
        0, 2, 1,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    _scene.add(new THREE.Mesh(geo, beigeMat));

    // ── 2 rabats latéraux qui descendent sur les segments D des flancs ──
    // Bord haut : suit le bord latéral de la tôle supérieure (entre AvG et ArG)
    // Bord avant : suit le bord latéral de la tôle écran-disques (jusqu'au sommet V)
    // Bord arrière : suit le bord latéral de la tôle arrière (jusqu'au coin V4)
    // Bord bas : exactement le segment D (du sommet V à V4 du flanc)
    const W_2 = W / 2;
    function makeRabat(side) {
        // V3 (sommet du V) côté `side`
        const V3_x = side * (W_2 + (E + Hp) * tan_a);
        const V3_y = E + Hp;
        const V3_z = D_2 - Tp;
        // V4 (arrière-haut façade) côté `side`
        const V4_x = side * (W_2 + F_h * tan_a);
        const V4_y = F_h;
        const V4_z = -D_2;
        // 4 sommets du rabat (CCW vu depuis l'extérieur)
        const verts = new Float32Array([
            side * W_top_sd / 2, Y_top_sd, Z_top_sd,    // 0 haut-avant
            side * W_top_bk / 2, Y_top_bk, Z_top_bk,    // 1 haut-arrière
            V4_x, V4_y, V4_z,                            // 2 bas-arrière (V4)
            V3_x, V3_y, V3_z,                            // 3 bas-avant (V3)
        ]);
        const idx = [0, 1, 2,  0, 2, 3];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return new THREE.Mesh(g, beigeMat);
    }
    _scene.add(makeRabat(-1));   // rabat gauche
    _scene.add(makeRabat(+1));   // rabat droite
}

// ─── Tôle fond du capot ──────────────────────────────────────────
// Pièce plate trapézoïdale couvrant la pente arrière (pan D) du Smaky.
// Base au bord arrière du fond (largeur W + 2·F), monte vers le sommet
// du V en rétrécissant.
function _buildBackSheet() {
    const SB  = SHEET_BOTTOM;
    const SBK = SHEET_BACK;
    const SD  = SHEET_SCREEN_DISK;
    const SK  = SHEET_KEYBOARD;
    const W   = SB.W * MM;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const t   = SHEET_THICKNESS_MM * MM;
    const D_2 = SB.D * MM / 2;
    const tan_a      = Math.tan(SB.FLANK_TILT_DEG * Math.PI / 180);
    const tan_shrink = Math.tan(SHEET_SCREEN_DISK.SHRINK_DEG * Math.PI / 180);

    const tilt    = SBK.TILT_BACK_DEG * Math.PI / 180;
    const tilt_sd = SD.TILT_BACK_DEG * Math.PI / 180;
    const Hp_p    = SD.HEIGHT * MM;
    const F_h     = SB.FACADE_H * MM;

    // Largeurs aux 3 niveaux clés.
    const W_bot    = W;                       // = B
    const W_inflex = W + 2 * F_h * tan_a;     // suit F (au sommet de la façade arrière)

    // Option A : seule la LARGEUR du sommet doit matcher celle de la tôle
    // écran-disques (pour que la face supérieure du capot soit plane).
    // L'altitude du sommet de la tôle arrière reste libre — la face du
    // capot est inclinée vers l'arrière (descendante).
    const W_bot_sd  = W + 2 * (E + Hp) * tan_a;
    const W_top_sd  = W_bot_sd - 2 * Hp_p * Math.cos(tilt_sd) * tan_shrink;

    // Longueur libre (paramètre utilisateur).
    const len_sec2 = SBK.HEIGHT * MM;
    // Contrainte de planéité du capot supérieur : W_top = W_top_sd.
    // Garde-fou : si l'évasement α est si fort que W_top_sd dépasserait
    // W_inflex (la tôle s'élargirait au lieu de rétrécir), on cape à
    // W_inflex — la tôle reste au pire rectangulaire, la planéité du
    // capot supérieur est alors sacrifiée (rabattu en 2 triangles).
    const W_top = Math.min(W_top_sd, W_inflex);

    const brunMat = new THREE.MeshStandardMaterial({
        color: COLOR_BRUN, roughness: RENDER_PARAMS.BRUN_ROUGH, metalness: 0.0, flatShading: true,
    });

    // ── Section 1 : verticale, plaquée contre F (de Y=0 à Y=F_h) ──
    const shape1 = new THREE.Shape();
    shape1.moveTo(-W_bot    / 2, 0);
    shape1.lineTo(+W_bot    / 2, 0);
    shape1.lineTo(+W_inflex / 2, F_h);
    shape1.lineTo(-W_inflex / 2, F_h);
    shape1.closePath();
    const geo1 = new THREE.ExtrudeGeometry(shape1, { depth: t, bevelEnabled: false });
    const mesh1 = new THREE.Mesh(geo1, brunMat);
    mesh1.position.set(0, 0, -D_2);
    _scene.add(mesh1);

    // ── Section 2 : inclinée vers l'arrière, du sommet de F au sommet ──
    const shape2 = new THREE.Shape();
    shape2.moveTo(-W_inflex / 2, 0);
    shape2.lineTo(+W_inflex / 2, 0);
    shape2.lineTo(+W_top    / 2, len_sec2);
    shape2.lineTo(-W_top    / 2, len_sec2);
    shape2.closePath();
    const geo2 = new THREE.ExtrudeGeometry(shape2, { depth: t, bevelEnabled: false });
    const mesh2 = new THREE.Mesh(geo2, brunMat);
    mesh2.position.set(0, F_h, -D_2);
    mesh2.rotation.x = -tilt;
    _scene.add(mesh2);
}

// ─── Tôle écran-disques ─────────────────────────────────────────
// Pièce plate trapézoïdale, soudée au capot sur le Smaky mais modélisée
// indépendamment. Part du sommet du V (fin de la tôle clavier), monte
// vers le haut-arrière (presque verticale), porte 2 découpes : écran à
// droite et baie disques à gauche (commune à 2 floppies, ou disque dur
// + floppy).
function _buildScreenDiskSheet() {
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const SD  = SHEET_SCREEN_DISK;
    const W   = SB.W * MM;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const t   = SHEET_THICKNESS_MM * MM;
    const D_2 = SB.D * MM / 2;
    const tan_a = Math.tan(SB.FLANK_TILT_DEG * Math.PI / 180);

    // Position du bord BAS de la tôle = sommet du V
    const Y_bot = E + Hp;
    const Z_bot = D_2 - Tp;

    // Inclinaison vers l'arrière (par rapport à la verticale)
    const tilt = SD.TILT_BACK_DEG * Math.PI / 180;
    const Hp_piece = SD.HEIGHT * MM;
    const Y_top = Y_bot + Hp_piece * Math.cos(tilt);
    // (Z_top = Z_bot - Hp_piece * sin(tilt) — utilisé implicitement par la rotation)

    // Largeur du trapèze : la base coïncide avec l'écart entre flancs au
    // sommet du V (W_bot ≈ 530 mm), puis le trapèze rétrécit en montant.
    // Angle de rétrécissement plus doux (≈ 10°) que l'évasement des flancs
    // pour laisser de la marge autour des découpes.
    const dY    = Y_top - Y_bot;
    const tan_shrink = Math.tan(SHEET_SCREEN_DISK.SHRINK_DEG * Math.PI / 180);
    const W_bot = W + 2 * Y_bot * tan_a;
    const W_top = W_bot - 2 * dY * tan_shrink;

    // Profil 2D de la tôle (X local = largeur, Y local = position le long
    // de la pente). Origine = bas-centre de la tôle.
    // On retire l'épaisseur t en haut, à droite et à gauche pour que
    // la tôle ne dépasse pas du capot (sinon elle laisse des marques
    // sur les bords du capot supérieur).
    const W_top_in = W_top - 2 * t;
    const H_in     = Hp_piece - t;
    const shape = new THREE.Shape();
    shape.moveTo(-W_bot    / 2, 0);
    shape.lineTo(+W_bot    / 2, 0);
    shape.lineTo(+W_top_in / 2, H_in);
    shape.lineTo(-W_top_in / 2, H_in);
    shape.closePath();

    // Découpe écran (à droite)
    const sCx = SD.SCREEN_CENTER_X * MM;
    const sCy = SD.SCREEN_CENTER_Y * MM;
    const sW2 = SD.SCREEN_W * MM / 2;
    const sH2 = SD.SCREEN_H * MM / 2;
    const screenHole = new THREE.Path();
    screenHole.moveTo(sCx - sW2, sCy - sH2);
    screenHole.lineTo(sCx + sW2, sCy - sH2);
    screenHole.lineTo(sCx + sW2, sCy + sH2);
    screenHole.lineTo(sCx - sW2, sCy + sH2);
    screenHole.closePath();
    shape.holes.push(screenHole);

    // Découpe disques (à gauche)
    const dCx = SD.DISKS_CENTER_X * MM;
    const dCy = SD.DISKS_CENTER_Y * MM;
    const dW2 = SD.DISKS_W * MM / 2;
    const dH2 = SD.DISKS_H * MM / 2;
    const disksHole = new THREE.Path();
    disksHole.moveTo(dCx - dW2, dCy - dH2);
    disksHole.lineTo(dCx + dW2, dCy - dH2);
    disksHole.lineTo(dCx + dW2, dCy + dH2);
    disksHole.lineTo(dCx - dW2, dCy + dH2);
    disksHole.closePath();
    shape.holes.push(disksHole);

    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: t, bevelEnabled: false,
    });

    const beigeMat = new THREE.MeshStandardMaterial({
        color: COLOR_BEIGE, roughness: RENDER_PARAMS.BEIGE_ROUGH, metalness: 0.0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, beigeMat);
    mesh.position.set(0, Y_bot, Z_bot);
    // rotateX(-tilt) : Y local devient (0, cos, -sin) — vertical incliné vers l'arrière
    //                  Z local (épaisseur) devient (0, sin, +cos) — vers haut-avant (extérieur visible)
    mesh.rotation.x = -tilt;
    _scene.add(mesh);
}

// ─── Étiquettes de cotes (sprites toujours face caméra) ─────────
// Pour faciliter le report des mesures réelles : chaque sprite porte la
// lettre du croquis (A, G, C, D, E, …) ou un angle (a, b, …).
function _makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 8;
    ctx.strokeText(text, 64, 48);
    ctx.fillStyle = color || '#ff8c00';
    ctx.fillText(text, 64, 48);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.20, 0.15, 1);
    sprite.renderOrder = 1000;       // toujours devant les meshes
    return sprite;
}

function _addLabel(text, x, y, z, color) {
    const s = _makeLabel(text, color);
    s.position.set(x, y, z);
    _scene.add(s);
}

function _buildDimensionLabels() {
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const W   = SB.W * MM;
    const D   = SB.D * MM;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const Db  = SB.TILT_BACK_PROJ * MM;
    const D_2 = D / 2;
    const W_2 = W / 2;
    const off = 0.18;   // décalage des étiquettes hors de la pièce

    // Cotes (lettres majuscules, orange).
    _addLabel('A', 0,           -off,         D_2 + off);          // largeur fond, devant
    _addLabel('G', W_2 + off,   -off,         0);                  // profondeur fond, à droite
    _addLabel('E', W_2 + off,   E / 2,        D_2 + off);          // hauteur face vert clavier
    _addLabel('C', W_2 + off,   E + Hp / 2,   D_2 - Tp / 2);       // milieu pan avant
    _addLabel('D', W_2 + off,   E + Hp / 2,   -D_2 + Db / 2);      // milieu pan arrière
    // Les 2 segments F : bord arrière vertical des flancs (équivalent de
    // E mais à l'arrière). Hauteur = SB.FACADE_H. Label placé au milieu.
    const F_h = SB.FACADE_H * MM;
    _addLabel('F', -W_2 - off, F_h / 2, -D_2);
    _addLabel('F', +W_2 + off, F_h / 2, -D_2);

    // Angles (lettres minuscules, vert clair).
    _addLabel('a', W_2 + 0.02,  E / 2,        -D_2 + off,  '#88ff44');  // évasement flanc
}

// ─── Tôle du fond ────────────────────────────────────────────────
// Fond plat rectangulaire, deux flancs latéraux évasés à 20° avec sommet
// en V asymétrique (pan avant court 190 mm, pan arrière long 410 mm).
function _buildBottomSheet() {
    const S = SHEET_BOTTOM;
    // Tôle peinte purement mate : couleur diffuse pure (pas de spéculaire),
    // flatShading pour des facettes nettes (pas d'interpolation de normales
    // entre faces du pliage).
    const sheetMat = new THREE.MeshStandardMaterial({
        color:        COLOR_BRUN,
        roughness:    1.0,
        metalness:    0.0,
        flatShading:  true,
    });

    const t = SHEET_THICKNESS_MM * MM;

    // 1) Fond plat : box mince horizontale, top à Y=0.
    const bottomGeo = new THREE.BoxGeometry(S.W * MM, t, S.D * MM);
    const bottom = new THREE.Mesh(bottomGeo, sheetMat);
    bottom.position.y = -t / 2;
    _scene.add(bottom);

    // 2) Flancs latéraux : pentagone avec épaisseur réelle (1.5 mm) le long
    //    de la normale interne du flanc. Construit comme un solide à 10
    //    sommets (5 externes + 5 internes) + 2 pentagones + 5 quads de bord.
    //    Convention scène : X+ = droite, Y+ = haut, Z+ = avant.
    const angRad = S.FLANK_TILT_DEG * Math.PI / 180;
    const tan_a  = Math.tan(angRad);
    const cos_a  = Math.cos(angRad);
    const sin_a  = Math.sin(angRad);
    const W_2    = S.W * MM / 2;
    const D_2    = S.D * MM / 2;
    const F      = S.FACADE_H * MM;
    const Hpeak  = S.TILT_PEAK_H * MM;
    // Z scène du sommet (à 190 mm de l'avant ; avant = +Z).
    const zPeak  = +D_2 - S.TILT_FRONT_PROJ * MM;

    function makeFlank(side) {            // side = -1 (gauche) ou +1 (droite)
        const x0 = side * W_2;
        const dx = (h) => side * h * tan_a;
        // Normale interne du flanc (vers l'intérieur du Smaky, +Y) :
        //   flanc gauche  : (+cos α, +sin α, 0)
        //   flanc droit   : (-cos α, +sin α, 0)
        const nx = -side * cos_a;
        const ny = sin_a;

        // 5 sommets externes (face vue depuis l'extérieur).
        const ext = [
            [x0,                 0,         -D_2 ],   // V0 arrière-bas
            [x0,                 0,         +D_2 ],   // V1 avant-bas
            [x0 + dx(F),         F,         +D_2 ],   // V2 avant-haut façade
            [x0 + dx(F+Hpeak),   F + Hpeak, zPeak],   // V3 sommet du toit
            [x0 + dx(F),         F,         -D_2 ],   // V4 arrière-haut façade
        ];
        // 5 sommets internes (décalés de t le long de la normale interne).
        const intr = ext.map(([x, y, z]) => [x + nx * t, y + ny * t, z]);

        const v = new Float32Array(
            ext.flat().concat(intr.flat()));

        // Indices : ext = 0..4, int = 5..9. Triangulations choisies pour
        // que la normale géométrique sorte vers l'extérieur (back-face culling
        // donnera le bon rendu sans avoir à utiliser DoubleSide).
        // Pour le flanc gauche, l'ordre du pentagone V0→V1→V2→V3→V4 est
        // sens trigo direct vu depuis -X (extérieur). Pour le flanc droit
        // c'est l'inverse, donc on swappe l'orientation.
        const ccw = (side === -1);
        function tri(a, b, c) { return ccw ? [a, b, c] : [a, c, b]; }
        const idx = [
            // Face externe (pentagone)
            ...tri(0, 1, 2),
            ...tri(0, 2, 3),
            ...tri(0, 3, 4),
            // Face interne (pentagone, orientation opposée)
            ...tri(5, 7, 6),
            ...tri(5, 8, 7),
            ...tri(5, 9, 8),
            // 5 quads de bord (chacun = 2 triangles).
            // Pour chaque arête ext (a,b), arête int (a+5, b+5).
            ...tri(0, 5, 6), ...tri(0, 6, 1),
            ...tri(1, 6, 7), ...tri(1, 7, 2),
            ...tri(2, 7, 8), ...tri(2, 8, 3),
            ...tri(3, 8, 9), ...tri(3, 9, 4),
            ...tri(4, 9, 5), ...tri(4, 5, 0),
        ];

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, sheetMat);
    }

    _scene.add(makeFlank(-1));   // flanc gauche
    _scene.add(makeFlank(+1));   // flanc droit
}

// ─── Clavier (touches sur la tôle clavier) ──────────────────────
// Plaque noire posée sur la face inclinée + grille de touches.
// Quelques touches rouges aux positions caractéristiques (KILL, COPY,
// fonctions). Tout se trouve dans un Group orienté comme la face inclinée.
function _buildKeyboard() {
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const W   = SB.W * MM;
    const E   = SK.FACE_VERT_H * MM;
    const Hp  = SB.TILT_PEAK_H * MM;
    const Tp  = SB.TILT_FRONT_PROJ * MM;
    const D_2 = SB.D * MM / 2;

    const Cpan = Math.sqrt(Tp * Tp + Hp * Hp);

    // Group placé sur la face inclinée du clavier (mêmes pos+rotation
    // que le mesh "incl" de _buildKeyboardSheet).
    const kb = new THREE.Group();
    kb.position.set(0, E + Hp / 2, D_2 - Tp / 2);
    kb.rotation.x = Math.atan2(-Tp, Hp);

    // Grille de touches. Toutes les dimensions multipliées par KB_SCALE pour
    // ajuster la taille globale du clavier.
    const KB_SCALE = 0.8;
    const cols     = 20;
    const rows     = 6;
    const keySize  = 18 * KB_SCALE * MM;
    const keyGap   =  3 * KB_SCALE * MM;
    const keyDepth =  8 * KB_SCALE * MM;

    const totalW = cols * keySize + (cols - 1) * keyGap;
    const totalH = rows * keySize + (rows - 1) * keyGap;
    const startX = -totalW / 2 + keySize / 2;
    const startY = -totalH / 2 + keySize / 2;

    // Plaque de fond (noir mat, sous la tôle — invisible de l'extérieur,
    // sert juste de référence pour le positionnement des touches).
    const plateW = totalW + 40 * KB_SCALE * MM;
    const plateH = totalH + 40 * KB_SCALE * MM;
    const plateDepth = 5 * KB_SCALE * MM;
    const plate = new THREE.Mesh(
        new THREE.BoxGeometry(plateW, plateH, plateDepth),
        new THREE.MeshStandardMaterial({
            color: 0x1a1a1a, roughness: 0.55, metalness: 0.05, flatShading: true,
        }),
    );
    plate.position.z = -plateDepth / 2 - 2 * MM;   // sous la surface de la tôle
    kb.add(plate);

    const keyMat = new THREE.MeshStandardMaterial({
        color: 0x4a4844, roughness: 0.65, metalness: 0.05, flatShading: true,
    });
    const redMat = new THREE.MeshStandardMaterial({
        color: 0xb02818, roughness: 0.55, metalness: 0.05, flatShading: true,
    });

    // Touches rouges, toutes sur la rangée du bas (rangée 0) :
    //   - 3 à gauche (cols 0, 1, 2)
    //   - 4 à droite (cols cols-4 .. cols-1)
    const isRed = (c, r) => (
        (r === 0 && c <= 2) ||
        (r === 0 && c >= cols - 4)
    );

    // Barre espace : rangée du bas, entre les rouges gauche et droite.
    const SPACE_COL_START = 3;
    const SPACE_COL_END   = cols - 5;   // = 15 (touche le 1er rouge à droite, col 16)
    const SPACE_ROW       = 0;
    const isSpace = (c, r) => (
        r === SPACE_ROW && c >= SPACE_COL_START && c <= SPACE_COL_END
    );

    // Touches posées sur la surface de la tôle (Z = 0 local).
    const keyZ = keyDepth / 2 + 1 * MM;

    // Touches normales (skip emplacements de la barre espace).
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (isSpace(c, r)) continue;
            const k = new THREE.Mesh(
                new THREE.BoxGeometry(keySize, keySize, keyDepth),
                isRed(c, r) ? redMat : keyMat,
            );
            k.position.set(
                startX + c * (keySize + keyGap),
                startY + r * (keySize + keyGap),
                keyZ,
            );
            kb.add(k);
        }
    }

    // Barre espace (large, joint les emplacements skipés).
    const spaceCols = SPACE_COL_END - SPACE_COL_START + 1;
    const spaceW = spaceCols * keySize + (spaceCols - 1) * keyGap;
    const spaceCx =
        (startX + SPACE_COL_START * (keySize + keyGap) +
         startX + SPACE_COL_END   * (keySize + keyGap)) / 2;
    const spaceCy = startY + SPACE_ROW * (keySize + keyGap);
    const space = new THREE.Mesh(
        new THREE.BoxGeometry(spaceW, keySize, keyDepth),
        keyMat,
    );
    space.position.set(spaceCx, spaceCy, keyZ);
    kb.add(space);

    _scene.add(kb);
}

// ─── Tôle clavier ────────────────────────────────────────────────
// 2 faces TRAPÉZOÏDALES (les flancs latéraux s'évasent à 20°, la largeur
// croît avec la hauteur) : face verticale (bas) + face inclinée qui suit
// le pan avant des flancs. Beige.
function _buildKeyboardSheet() {
    const SB  = SHEET_BOTTOM;
    const SK  = SHEET_KEYBOARD;
    const W   = SB.W * MM;                  // 450 mm largeur du fond
    const E   = SK.FACE_VERT_H * MM;        // 50 mm hauteur face verticale
    const Hp  = SB.TILT_PEAK_H * MM;        // hauteur peak (60 mm)
    const Tp  = SB.TILT_FRONT_PROJ * MM;    // 190 mm projection horiz pan avant
    const t   = SHEET_THICKNESS_MM * MM;
    const D_2 = SB.D * MM / 2;              // bord avant du fond (Z scène)
    const tan_a = Math.tan(SB.FLANK_TILT_DEG * Math.PI / 180);

    // Largeurs aux trois niveaux (à mesure qu'on monte, les flancs s'écartent).
    const W_bot    = W;                          // à Y = 0
    const W_pli    = W + 2 * E      * tan_a;     // à Y = E (haut face vert / bas face incl)
    const W_sommet = W + 2 * (E + Hp) * tan_a;   // à Y = E + Hp (sommet du V)

    const beigeMat = new THREE.MeshStandardMaterial({
        color: COLOR_BEIGE, roughness: RENDER_PARAMS.BEIGE_ROUGH, metalness: 0.0, flatShading: true,
    });

    // 1) Face verticale TRAPÉZOÏDALE (X = largeur, Y = hauteur, extrudée en Z).
    const shape1 = new THREE.Shape();
    shape1.moveTo(-W_bot / 2, 0);
    shape1.lineTo(+W_bot / 2, 0);
    shape1.lineTo(+W_pli / 2, E);
    shape1.lineTo(-W_pli / 2, E);
    shape1.closePath();
    const vertGeo = new THREE.ExtrudeGeometry(shape1, {
        depth: t, bevelEnabled: false,
    });
    const vert = new THREE.Mesh(vertGeo, beigeMat);
    // Origine du mesh = (0, 0, 0) en local, profil dans plan XY, extrudé en +Z.
    // On veut la face int (Z=0 local) à Z = D_2 dans la scène.
    vert.position.set(0, 0, D_2);
    _scene.add(vert);

    // 2) Face inclinée TRAPÉZOÏDALE.
    //    Profil dans plan XY local : X = largeur, Y = longueur du pan.
    //    Extrudé en Z = épaisseur t.
    const Cpan = Math.sqrt(Tp * Tp + Hp * Hp);
    const shape2 = new THREE.Shape();
    shape2.moveTo(-W_pli    / 2, 0);
    shape2.lineTo(+W_pli    / 2, 0);
    shape2.lineTo(+W_sommet / 2, Cpan);
    shape2.lineTo(-W_sommet / 2, Cpan);
    shape2.closePath();
    const inclGeo = new THREE.ExtrudeGeometry(shape2, {
        depth: t, bevelEnabled: false,
    });
    const incl = new THREE.Mesh(inclGeo, beigeMat);
    // Origine au coin (centre X, Y=0) = au pli, à (0, E, D_2) dans la scène.
    incl.position.set(0, E, D_2);
    // Rotation autour de X pour que +Y local s'aligne sur (0, +Hp, -Tp)/Cpan
    // (= direction du pli vers le sommet du V).
    //   rotateX(θ) sur (0,1,0) → (0, cos θ, sin θ)
    //   On veut (0, Hp/Cpan, -Tp/Cpan) → cos θ = Hp/Cpan, sin θ = -Tp/Cpan
    //   θ = atan2(-Tp, Hp)
    incl.rotation.x = Math.atan2(-Tp, Hp);
    _scene.add(incl);
}

// ─── Baie lecteurs ───────────────────────────────────────────────
function _buildDriveBay(capotCenter) {
    const P = PARAMS;
    const tiltAngle = Math.atan2(P.CAPOT_TILT, P.CAPOT_H);
    const faceCenterY = capotCenter.y;
    const faceCenterZ = capotCenter.z + P.CAPOT_D / 2 - P.CAPOT_TILT / 2;

    const bay = new THREE.Group();
    bay.position.set(P.DRIVE_OFFSET_X, faceCenterY, faceCenterZ);
    bay.rotation.x = -tiltAngle;
    _scene.add(bay);

    // Plaque de fond (noir mat) qui couvre les 2 emplacements.
    const totalH = 2 * P.DRIVE_H + P.DRIVE_GAP;
    const backMat = new THREE.MeshStandardMaterial({
        color: COLOR_DRIVE, roughness: 0.7, metalness: 0.05,
    });
    const back = new THREE.Mesh(
        new THREE.PlaneGeometry(P.DRIVE_W, totalH), backMat);
    back.position.z = 0.005;
    bay.add(back);

    // Les 2 emplacements (haut et bas).
    const yTop    = +(P.DRIVE_H + P.DRIVE_GAP) / 2;
    const yBottom = -(P.DRIVE_H + P.DRIVE_GAP) / 2;
    _buildDrive(bay, P.DRIVE_TOP_TYPE,    yTop);
    _buildDrive(bay, P.DRIVE_BOTTOM_TYPE, yBottom);
}

function _buildDrive(parentBay, type, yLocal) {
    const P = PARAMS;
    const w = P.DRIVE_W;
    const h = P.DRIVE_H;
    const slot = new THREE.Group();
    slot.position.set(0, yLocal, 0.010);
    parentBay.add(slot);

    if (type === 'floppy')      _buildDriveFloppy(slot, w, h);
    else if (type === 'hd')     _buildDriveHD(slot, w, h);
    else                        _buildDriveBlank(slot, w, h);
}

function _buildDriveFloppy(parent, w, h) {
    // Façade noire (légèrement en relief par rapport à la plaque de fond).
    const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.96, h * 0.92),
        new THREE.MeshStandardMaterial({ color: COLOR_DRIVE, roughness: 0.55, metalness: 0.1 }),
    );
    parent.add(face);

    // Fente horizontale (légèrement au-dessus du milieu, comme sur un Micropolis).
    const slotW = w * 0.66;
    const slotH = h * 0.10;
    const slotMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(slotW, slotH),
        new THREE.MeshBasicMaterial({ color: COLOR_SLOT }),
    );
    slotMesh.position.set(-w * 0.05, h * 0.05, 0.002);
    parent.add(slotMesh);

    // Levier de fermeture clair, à droite de la fente.
    const latchW = w * 0.07;
    const latchH = h * 0.30;
    const latch = new THREE.Mesh(
        new THREE.BoxGeometry(latchW, latchH, 0.018),
        new THREE.MeshStandardMaterial({ color: COLOR_LATCH, roughness: 0.4, metalness: 0.15 }),
    );
    latch.position.set(w * 0.36, h * 0.05, 0.012);
    parent.add(latch);

    // LED ronde rouge en bas à gauche (typique des Micropolis).
    _addLED(parent, -w * 0.40, -h * 0.32, 'round', 'floppy');
}

function _buildDriveHD(parent, w, h) {
    // Façade noire uniforme.
    const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.96, h * 0.92),
        new THREE.MeshStandardMaterial({ color: COLOR_DRIVE, roughness: 0.55, metalness: 0.1 }),
    );
    parent.add(face);

    // LED rectangulaire rouge d'activité en bas à gauche.
    _addLED(parent, -w * 0.40, -h * 0.32, 'rect', 'hd');
}

function _buildDriveBlank(parent, w, h) {
    // Cache aluminium brossé.
    const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.96, h * 0.92),
        new THREE.MeshStandardMaterial({ color: COLOR_ALU, roughness: 0.30, metalness: 0.85 }),
    );
    parent.add(face);
}

function _addLED(parent, xLocal, yLocal, shape, type) {
    const geo = (shape === 'round')
        ? new THREE.CircleGeometry(0.022, 18)
        : new THREE.PlaneGeometry(0.07, 0.025);
    const mat = new THREE.MeshBasicMaterial({ color: COLOR_LED_OFF });
    const led = new THREE.Mesh(geo, mat);
    led.position.set(xLocal, yLocal, 0.003);
    parent.add(led);
    _leds.push({ mesh: led, type: type });
}

function _onResize() {
    if (!_renderer || !_container) return;
    const w = _container.clientWidth;
    const h = _container.clientHeight;
    if (!w || !h) return;
    _renderer.setSize(w, h);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
}

function update3DFrame() {
    if (_screenTex) _screenTex.needsUpdate = true;
}

// Rétrécit le _screenMesh selon le pourcentage de bordure CRT (= même
// paramètre que crtBorderPercent en 2D). Le fond phosphore (_bgMat)
// apparaît autour quand l'écran est rétréci.
function setScreenBorder(percent) {
    if (!_screenMesh) return;
    const f = Math.max(0.01, 1 - 2 * (percent || 0) / 100);
    _screenMesh.scale.set(f, f, 1);
}

// Couleur du fond phosphore (palette.off : [r,g,b] sur 0..255).
// Convert sRGB → linear pour que la sortie (outputEncoding=sRGB) donne
// exactement la valeur sRGB d'origine — sinon les valeurs sombres
// sortent plus claires (gamma de 2.2 inversé).
function setScreenBgColor(rgb) {
    if (!_bgMat || !rgb) return;
    _bgMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
                .convertSRGBToLinear();
}

function _updateLEDs() {
    if (_leds.length === 0) return;
    const sim = window.sim;
    if (!sim) return;
    const now = performance.now();
    for (let i = 0; i < _leds.length; i++) {
        const led = _leds[i];
        const t = (led.type === 'floppy') ? sim._lastFloppyAccessMs
                                          : sim._lastHDAccessMs;
        const on = t > 0 && (now - t < LED_PULSE_MS);
        led.mesh.material.color.setHex(on ? COLOR_LED_ON : COLOR_LED_OFF);
    }
}

function _renderLoop() {
    if (!_animating) return;
    _updateLEDs();
    _controls.update();
    _renderer.render(_scene, _camera);
    requestAnimationFrame(_renderLoop);
}

function start3D() {
    if (_animating || !_renderer) return;
    _animating = true;
    _renderLoop();
}

// Animation d'intro : caméra arrive depuis le haut-gauche (petite, vue
// d'en haut) puis se rapproche du centre et se redresse légèrement.
function playIntroAnimation(durationMs) {
    if (!_camera || !_controls) return;
    const dur = durationMs || 3000;

    // Pose initiale : très éloignée, à gauche, vue plongeante
    // (Smaky tout petit, en haut-gauche du cadre)
    const startPos    = new THREE.Vector3(-24, 16, 12);
    const startTarget = new THREE.Vector3(-3,  0.5, 0);

    // Pose finale : 2× plus loin que la pose par défaut, donc Smaky 2× plus
    // petit dans le cadre que ce qu'on avait avant.
    const endPos    = new THREE.Vector3(0, 2.2, 15);
    const endTarget = new THREE.Vector3(0, 1.0, 0);

    _controls.enabled = false;
    const t0 = performance.now();

    function step() {
        const elapsed = performance.now() - t0;
        let t = Math.min(elapsed / dur, 1);
        // Ease-out cubic : ralentit en arrivant
        const e = 1 - Math.pow(1 - t, 3);

        _camera.position.lerpVectors(startPos, endPos, e);
        _controls.target.lerpVectors(startTarget, endTarget, e);
        _controls.update();

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            _controls.enabled = true;
        }
    }
    step();
}

function stop3D() {
    _animating = false;
}

if (typeof window !== 'undefined') {
    window.init3D           = init3D;
    window.update3DFrame    = update3DFrame;
    window.start3D          = start3D;
    window.stop3D           = stop3D;
    window.setScreenBorder  = setScreenBorder;
    window.setScreenBgColor = setScreenBgColor;
    window.get3DCanvas      = () => _renderer ? _renderer.domElement : null;
    window.playIntroAnimation = playIntroAnimation;
    window.rebuildHousing     = rebuildHousing;
    window.setHousingParam    = setHousingParam;
    window.getHousingParam    = getHousingParam;
    window.setRenderParam     = setRenderParam;
    window.getRenderParam     = getRenderParam;
    window.SMAKY_3D_PARAMS  = PARAMS;   // pour bidouiller depuis la console
}
