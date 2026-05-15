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

// ─── Couleurs (prélevées sur smaky-6.jpg) ────────────────────────
const COLOR_BEIGE   = 0xbea888;
const COLOR_BRUN    = 0x372d28;
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

function init3D(container, sourceCanvas) {
    _container = container;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x1a1a1a);

    _camera = new THREE.PerspectiveCamera(
        35, container.clientWidth / container.clientHeight, 0.1, 100);
    _camera.position.set(0, 2.2, 8.5);

    // Éclairage : ambiante douce + lumière clé + remplissage léger.
    _scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(4, 6, 5);
    _scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-3, 2, 4);
    _scene.add(fill);

    _buildHousing(sourceCanvas);

    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.target.set(0, 1.0, 0);     // milieu vertical du Smaky
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.08;
    _controls.minDistance   = 4.0;
    _controls.maxDistance   = 25;
    _controls.update();

    window.addEventListener('resize', _onResize);
}

// ─── Construction du boîtier ─────────────────────────────────────
function _buildHousing(sourceCanvas) {
    const P = PARAMS;
    const beigeMat = new THREE.MeshStandardMaterial({
        color: COLOR_BEIGE, roughness: 0.78, metalness: 0.04,
    });
    const brunMat = new THREE.MeshStandardMaterial({
        color: COLOR_BRUN, roughness: 0.85, metalness: 0.0,
    });
    const bezelMat = new THREE.MeshStandardMaterial({
        color: COLOR_BEZEL, roughness: 0.55, metalness: 0.0,
    });

    // Sol = Y=0. On empile : socle, base, capot.
    let y = 0;

    // Socle brun foncé (déborde de PLINTH_OVERHANG sur les 4 côtés).
    const plinthW = Math.max(P.BASE_W, P.CAPOT_W) + 2 * P.PLINTH_OVERHANG;
    const plinthD = P.BASE_D + 2 * P.PLINTH_OVERHANG;
    const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(plinthW, P.PLINTH_HEIGHT, plinthD), brunMat);
    plinth.position.y = y + P.PLINTH_HEIGHT / 2;
    _scene.add(plinth);
    y += P.PLINTH_HEIGHT;

    // Base beige (zone clavier).
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(P.BASE_W, P.BASE_H, P.BASE_D), beigeMat);
    base.position.y = y + P.BASE_H / 2;
    _scene.add(base);
    y += P.BASE_H;

    // Capot trapézoïdal : assis sur la base, alignement à l'arrière.
    // On fabrique une BoxGeometry et on recule en Z les vertices du sommet
    // (Y > 0 local) pour créer la face avant inclinée.
    const capotGeo = new THREE.BoxGeometry(P.CAPOT_W, P.CAPOT_H, P.CAPOT_D);
    const pos = capotGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0 && pos.getZ(i) > 0) {
            pos.setZ(i, pos.getZ(i) - P.CAPOT_TILT);
        }
    }
    pos.needsUpdate = true;
    capotGeo.computeVertexNormals();

    const capot = new THREE.Mesh(capotGeo, beigeMat);
    capot.position.y = y + P.CAPOT_H / 2;
    // Aligner l'arrière du capot avec l'arrière de la base :
    //   capotZ_arrière = -CAPOT_D/2 + capot.position.z
    //   baseZ_arrière  = -BASE_D/2
    capot.position.z = -P.BASE_D / 2 + P.CAPOT_D / 2;
    _scene.add(capot);

    // Écran sur la face inclinée du capot.
    _buildScreenAssembly(sourceCanvas, capot.position, bezelMat);

    // Baie lecteurs (à gauche de l'écran).
    _buildDriveBay(capot.position);
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

// ─── Cadre + écran texturé sur la face inclinée ──────────────────
function _buildScreenAssembly(sourceCanvas, capotCenter, bezelMat) {
    const P = PARAMS;

    // Angle de la face inclinée (par rapport à la verticale).
    const tiltAngle = Math.atan2(P.CAPOT_TILT, P.CAPOT_H);

    // Centre de la face inclinée, en coordonnées scène.
    // En local du capot : Z bas = +CAPOT_D/2, Z haut = +CAPOT_D/2 - TILT
    //                     centre Z local = +CAPOT_D/2 - TILT/2
    //                     centre Y local = 0 (capot centré sur sa hauteur)
    const faceCenterY = capotCenter.y;
    const faceCenterZ = capotCenter.z + P.CAPOT_D / 2 - P.CAPOT_TILT / 2;

    // Group qui porte le cadre + l'écran ; on l'oriente avec rotateX(-tilt)
    // pour que son axe Z local sorte perpendiculairement à la face.
    const group = new THREE.Group();
    group.position.set(P.SCREEN_OFFSET_X, faceCenterY, faceCenterZ);
    group.rotation.x = -tiltAngle;

    // Cadre : 4 rectangles (haut, bas, gauche, droite) encadrant l'écran,
    // qui dépassent vers l'avant pour créer l'effet « tube CRT encastré ».
    const sw = P.SCREEN_QUAD_W;
    const sh = P.SCREEN_QUAD_H;
    const bw = P.SCREEN_BEZEL;
    const bezelDepth = 0.07;
    const bezelGeoH = new THREE.BoxGeometry(sw + 2 * bw, bw, bezelDepth);
    const bezelGeoV = new THREE.BoxGeometry(bw, sh, bezelDepth);
    const bezelTop = new THREE.Mesh(bezelGeoH, bezelMat);
    bezelTop.position.set(0, sh / 2 + bw / 2, bezelDepth / 2);
    group.add(bezelTop);
    const bezelBot = new THREE.Mesh(bezelGeoH, bezelMat);
    bezelBot.position.set(0, -sh / 2 - bw / 2, bezelDepth / 2);
    group.add(bezelBot);
    const bezelLeft = new THREE.Mesh(bezelGeoV, bezelMat);
    bezelLeft.position.set(-sw / 2 - bw / 2, 0, bezelDepth / 2);
    group.add(bezelLeft);
    const bezelRight = new THREE.Mesh(bezelGeoV, bezelMat);
    bezelRight.position.set(sw / 2 + bw / 2, 0, bezelDepth / 2);
    group.add(bezelRight);

    // Fond « phosphore au repos » : occupe toute la zone interne du cadre.
    // Sa couleur sera mise à jour par setScreenBgColor() (suit la palette).
    _bgMat = new THREE.MeshBasicMaterial({ color: 0x001000 });
    const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), _bgMat);
    bgPlane.position.z = bezelDepth / 2 - P.SCREEN_INSET - 0.001;
    group.add(bgPlane);

    // Écran : PlaneGeometry texturé, posé en retrait dans le cadre creux.
    // On stocke le mesh pour pouvoir le rétrécir (= ajouter de la bordure).
    _screenTex = new THREE.CanvasTexture(sourceCanvas);
    _screenTex.magFilter = THREE.NearestFilter;
    _screenTex.minFilter = THREE.LinearFilter;
    _screenTex.generateMipmaps = false;
    const screenGeo = new THREE.PlaneGeometry(sw, sh);
    const screenMat = new THREE.MeshBasicMaterial({ map: _screenTex });
    _screenMesh = new THREE.Mesh(screenGeo, screenMat);
    _screenMesh.position.z = bezelDepth / 2 - P.SCREEN_INSET;
    group.add(_screenMesh);

    _scene.add(group);
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

// Largeur de la bordure phosphore (% de la largeur du cadre).
// Symétrique à crtBorderPercent en 2D : l'image se rétrécit, le fond apparaît.
function setScreenBorder(percent) {
    if (!_screenMesh) return;
    const f = Math.max(0.01, 1 - 2 * (percent || 0) / 100);
    _screenMesh.scale.set(f, f, 1);
}

// Couleur du fond phosphore (palette.off : [r,g,b] sur 0..255).
function setScreenBgColor(rgb) {
    if (!_bgMat || !rgb) return;
    _bgMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
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
    window.SMAKY_3D_PARAMS  = PARAMS;   // pour bidouiller depuis la console
}
