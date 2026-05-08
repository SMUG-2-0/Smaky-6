'use strict';
// ═══════════════════════════════════════════════════════════════════
// smaky.js — logique principale du simulateur Smaky 6
// Port de SimSmaky6.py (Epsitec SA, Pierre-Yves Rochat)
//
// Usage (navigateur / Electron) :
//   const sim = new Smaky();
//   await sim.loadROM(romArrayBuffer);
//   sim.loadDisk(diskArrayBuffer);          // optionnel
//   sim.start();                            // démarre la boucle
//
// Callbacks à définir avant start() :
//   sim.onFrame(textMem, gfxMem, gfxMode)  // appelé ~50 Hz
//   sim.onStopped(reason)                  // 'breakpoint' | 'step' | 'halt'
//   sim.onDiskChange(path)                 // demande de changer de disque
// ═══════════════════════════════════════════════════════════════════

// Dépendances (CommonJS ou script tag)
const _Z80      = (typeof require !== 'undefined') ? require('./z80.js')    : window.Z80;
const _disasmAt = (typeof require !== 'undefined') ? require('./disasm.js').disasmAt : window.disasmAt;

// ─── Constantes ──────────────────────────────────────────────────
const HEIGHT          = 20;
const WIDTH           = 64;
const VIDEO_START     = 0x4000;
const GFX_ADDR        = 0x4600;  // SGRA : début écran graphique
const GFX_W           = 256;
const GFX_H           = 120;
const GFX_BPR         = GFX_W >> 2;  // 64 octets par paire de lignes
const TICKS_PER_CHUNK = 17500;        // ~5 ms Z80 (3.5 MHz)
const TICKS_PER_FRAME = 70000;        // 3.5 MHz / 50 Hz

// ─── Table Smaky → Unicode ────────────────────────────────────────
const _SMAKY2ISO = [
     0,   1,   2,   3,   4,   5,   6,   7,
     8,   9,  10,  11,  12,  13,  14,0xFC,
  0xE0,0xE2,0xE9,0xE8,0xEB,0xEA,0xEF,0xEE,
  0xF4,0xF9,0xFB,0xE4,0xF6,0xE7,0xAB,0xBB,
    32,  33,  34,  35,  36,  37,  38,  39,
    40,  41,  42,  43,  44,  45,  46,  47,
    48,  49,  50,  51,  52,  53,  54,  55,
    56,  57,  58,  59,  60,  61,  62,  63,
    64,  65,  66,  67,  68,  69,  70,  71,
    72,  73,  74,  75,  76,  77,  78,  79,
    80,  81,  82,  83,  84,  85,  86,  87,
    88,  89,  90,  91,  92,  93,  94,  95,
    96,  97,  98,  99, 100, 101, 102, 103,
   104, 105, 106, 107, 108, 109, 110, 111,
   112, 113, 114, 115, 116, 117, 118, 119,
   120, 121, 122, 123, 124, 125, 126, 127,
];
// code Smaky (0-127) → caractère Unicode (espace si non imprimable)
const SMAKY_CHARS = Array.from({length: 128}, (_, c) => {
    const iso = _SMAKY2ISO[c];
    return iso >= 32 ? String.fromCharCode(iso) : ' ';
});

// ═══════════════════════════════════════════════════════════════════
// Classe Smaky
// ═══════════════════════════════════════════════════════════════════
class Smaky {
    constructor() {
        // ── CPU ──────────────────────────────────────────────────
        this.cpu = new _Z80();
        this.cpu.onInput  = (port) => this._ioIn(port);
        this.cpu.onOutput = (port, val) => this._ioOut(port, val);

        // ── État simulation ──────────────────────────────────────
        // 'interactive' | 'running' | 'stepping'
        this.mode           = 'interactive';
        this.stepsRemaining = 0;
        this.ticksSinceInt  = 0;
        this._rafHandle     = null;   // requestAnimationFrame handle
        this._lastTime      = 0;      // timestamp ms du dernier tick

        // ── Vitesse ──────────────────────────────────────────────
        // 3.25 = vitesse relative au Z80 réel 3.5 MHz
        // 0 = illimité (max CPU)
        this.speed          = 3.25;

        // ── Clavier ──────────────────────────────────────────────
        // Modèle matériel Smaky 6 : port $1 bit2 passe à 1 quand une touche
        // génère un strobe, et est **effacé par la lecture de port $0**.
        // Port $0 renvoie soit char|0x80 (bit2=1) soit fn_keys (bit2=0).
        // On arme le strobe sur l'événement 50 Hz : au plus un char par
        // tick ISR → ~50 chars/s, aligné sur la cadence du Smaky.
        this._kbFifo        = [];        // entrées { code, fn } en attente
        this._kbMax         = 256;       // taille max de la FIFO
        this._fnKeys        = 0;         // CHANGE=0x01 SEARCH=0x02 SHOW=0x04 PROGRA=0x08 KILL=0x10 COPY=0x20 CURSOR=0x40
        this._kbState       = 'idle';    // 'idle' | 'fn_expose' | 'pending' | 'gap'
        this._kbLatch       = false;     // bit2 de $1, effacé par lecture de $0
        this._kbCurCode     = 0;         // char 7 bits en attente de lecture
        this._kbCurFn       = null;      // fn_keys à exposer avant le char
        // Nombre de ticks 50 Hz pendant lesquels bit2 reste à 0 après la
        // lecture d'un char, avant de charger le suivant. Doit être assez
        // long pour que la logique d'anti-rebond / auto-repeat de la ROM
        // considère la touche comme relâchée. 1 = minimal (AA ok, AAA
        // échoue), 3 = laisse passer ~95%, 5 = fiable en pratique.
        this.kbGapTicks     = 8;
        this._kbGapLeft     = 0;

        // ── USART 8251 (ports 4-5) ───────────────────────────────
        this._8251phase = 'mode';  // 'mode' | 'cmd' (après reset)
        this._prFifo    = [];      // Paper Reader : octets en attente (entrée)
        this._ppBuffer  = [];      // Paper Punch  : octets émis (sortie)
        this.onPpByte   = null;    // callback(byte) à chaque octet émis
        this.onPrEmpty  = null;    // callback() quand le PR est épuisé

        // ── Port 0 sortie ────────────────────────────────────────
        this.eni50          = false;
        this.gfxGros        = true;  // 0=gros 2×2, 1=petit 1×1
        this.gfxGra         = false; // afficher écran graphique
        this.gfxNox         = false; // masquer écran alphanumérique

        // ── Timer 50 Hz ──────────────────────────────────────────
        this._timer50Pending = false;

        // ── WD1002 ───────────────────────────────────────────────
        this._wdSectorSize       = 256;
        this._wdSectorsPerTrack  = 32;
        this._wdHeads            = 6;
        this._wdDisk             = new Map();  // lba → Uint8Array (secteurs en RAM)
        this._wdImage            = null;       // ArrayBuffer de l'image disque
        this._wdImageSize        = 0;
        this._wdTargetSize       = 16 * 1024 * 1024;

        this._wdError       = 0;
        this._wdSectorCount = 0;
        this._wdSectorNum   = 0;
        this._wdCylLow      = 0;
        this._wdCylHigh     = 0;
        this._wdHead        = 0;
        this._wdMode        = null;  // null | 'read' | 'write'
        this._wdData        = new Uint8Array(0);
        this._wdDataIdx     = 0;
        this._wdLastRead    = null;
        this._wdLastReadLba = null;

        // ── Callbacks utilisateur ────────────────────────────────
        this.onFrame      = null;   // (textMem, gfxMem, gfxMode) => void
        this.onStopped    = null;   // (reason) => void
        this.onDiskWrite  = null;   // (diskName, imageBuffer) => void  — après écriture secteur

        // ── Nom du disque courant (pour onDiskWrite) ─────────────
        this.diskName     = null;   // ex. 'SM6WIN0.DSK'
    }

    // ─────────────────────────────────────────────────────────────
    // Chargement ROM / disque
    // ─────────────────────────────────────────────────────────────

    /**
     * Charge la ROM dans mem[0..].
     * Accepte : ArrayBuffer, Uint8Array, ou Node.js Buffer.
     */
    loadROM(buffer) {
        const data = (buffer instanceof Uint8Array) ? buffer : new Uint8Array(buffer);
        const len  = Math.min(data.length, 65536);
        for (let i = 0; i < len; i++) this.cpu.mem[i] = data[i];
    }

    /**
     * Charge une image disque depuis un ArrayBuffer.
     * Si buffer est null, le disque est vidé (secteurs RAM seulement).
     */
    loadDisk(buffer) {
        if (buffer) {
            this._wdImage     = buffer;
            this._wdImageSize = buffer.byteLength;
        } else {
            this._wdImage     = null;
            this._wdImageSize = 0;
        }
        this._wdDisk.clear();
        // Interrompre proprement toute opération WD1002 en cours
        this._wdMode    = null;
        this._wdData    = new Uint8Array(0);
        this._wdDataIdx = 0;
        this._wdError   = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Boucle de simulation
    // ─────────────────────────────────────────────────────────────

    /** Démarre la simulation en mode run continu. */
    start() {
        this.mode = 'running';
        this._scheduleNext();
    }

    /** Arrête la boucle de simulation. */
    stop() {
        this.mode = 'interactive';
        if (this._rafHandle !== null) {
            if (typeof cancelAnimationFrame !== 'undefined')
                cancelAnimationFrame(this._rafHandle);
            else if (this._rafHandle._timeout)
                clearTimeout(this._rafHandle._timeout);
            this._rafHandle = null;
        }
    }

    /** Exécute N instructions en mode pas-à-pas. */
    step(n = 1) {
        this.mode           = 'stepping';
        this.stepsRemaining = n;
        this._scheduleNext();
    }

    /** Reprend l'exécution continue depuis le mode interactif. */
    resume() {
        this.mode = 'running';
        this._scheduleNext();
    }

    _scheduleNext() {
        if (typeof requestAnimationFrame !== 'undefined') {
            this._rafHandle = requestAnimationFrame((t) => this._tick(t));
        } else {
            // Node.js : setTimeout de 0 ms
            const h = { _timeout: null };
            h._timeout = setTimeout(() => this._tick(Date.now()), 0);
            this._rafHandle = h;
        }
    }

    _tick(now) {
        this._rafHandle = null;
        if (this.mode === 'interactive') return;

        const cpu = this.cpu;

        if (this.mode === 'stepping') {
            // Exécuter stepsRemaining instructions une par une
            for (let i = 0; i < this.stepsRemaining; i++) {
                cpu.ticksToStop = 4;
                const ev = cpu.run();
                if (ev & _Z80.BREAKPOINT_HIT) {
                    this.mode = 'interactive';
                    if (this.onStopped) this.onStopped('breakpoint');
                    this._emitFrame();
                    return;
                }
            }
            this.mode = 'interactive';
            if (this.onStopped) this.onStopped('step');
            this._emitFrame();
            return;
        }

        // Mode 'running' : on calcule combien de ticks Z80 exécuter
        // par rapport au temps réel écoulé.
        if (this._lastTime === 0) this._lastTime = now;
        let elapsed  = now - this._lastTime;   // ms
        this._lastTime = now;

        // Clamp : si l'onglet était en arrière-plan, on ne rattrape pas le retard
        if (elapsed > 100) elapsed = 100;

        let ticksToRun;
        if (this.speed <= 0) {
            ticksToRun = TICKS_PER_FRAME;  // illimité : 1 frame de Z80 par tick JS
        } else {
            // speed en MHz relatif, Z80 réel = 3.5 MHz
            const mhz = this.speed;
            ticksToRun = Math.round(mhz * 1e6 * elapsed / 1000);
        }

        let ticksDone = 0;
        while (ticksDone < ticksToRun && this.mode === 'running') {
            const chunk = Math.min(TICKS_PER_CHUNK, ticksToRun - ticksDone);
            cpu.ticksToStop = chunk;
            const ev = cpu.run();
            ticksDone += chunk;

            if (ev & _Z80.BREAKPOINT_HIT) {
                this.mode = 'interactive';
                this._emitFrame();
                if (this.onStopped) this.onStopped('breakpoint');
                return;
            }

            // Timer 50 Hz : déclenche une interruption toutes les 70000 T-states
            this.ticksSinceInt += chunk;
            if (this.eni50 && this.ticksSinceInt >= TICKS_PER_FRAME) {
                this.ticksSinceInt -= TICKS_PER_FRAME;
                this._timer50Pending = true;
                this._kbTick();
                cpu.handleActiveInt();
            }
        }

        this._emitFrame();
        this._scheduleNext();
    }

    _emitFrame() {
        if (this.onFrame) {
            const textMem = this.cpu.mem.subarray(VIDEO_START, VIDEO_START + HEIGHT * WIDTH);
            const gfxMem  = this.cpu.mem.subarray(GFX_ADDR,    GFX_ADDR    + GFX_BPR * (GFX_H >> 1));
            this.onFrame(textMem, gfxMem, {
                gra:  this.gfxGra,
                nox:  this.gfxNox,
                gros: this.gfxGros,
            });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Clavier
    // ─────────────────────────────────────────────────────────────

    /**
     * Injecter un caractère Smaky dans la FIFO.
     * ch     : caractère JS (1 char).
     * fnSnap : si non-null, octet fn_keys exposé pendant un tick 50 Hz
     *          avant la "frappe" (nécessaire pour les touches curseur et
     *          les combinaisons SHOW/COPY+define).
     * Retourne false si la FIFO est pleine.
     */
    injectKey(ch, fnSnap = null) {
        if (this._kbFifo.length >= this._kbMax) return false;
        this._kbFifo.push({
            code: ch.charCodeAt(0) & 0x7F,
            fn:   (fnSnap === null) ? null : (fnSnap & 0x7F),
        });
        return true;
    }

    /** Injecter une touche curseur (fn_keys=CURSOR + char R/C/D/F). */
    injectCursorKey(ch) {
        return this.injectKey(ch, (this._fnKeys | 0x40) & 0x7F);
    }

    /** Avancer la FSM clavier d'un tick 50 Hz. */
    _kbTick() {
        // Tant que le strobe n'a pas été lu, on attend.
        if (this._kbState === 'pending') return;

        if (this._kbState === 'fn_expose') {
            // Le masque fn_keys a été exposé pendant un tick, on arme le char.
            this._kbState = 'pending';
            this._kbLatch = true;
            return;
        }

        if (this._kbState === 'gap') {
            // Ticks "touche relâchée" : la ROM observe bit2=0 pendant
            // plusieurs ticks pour conclure à une vraie libération.
            if (--this._kbGapLeft > 0) return;
            this._kbState = 'idle';
            this._kbCurFn = null;
            // fall through : on peut charger le prochain char dans le même tick
        }

        // idle : charger la prochaine entrée si disponible
        if (this._kbFifo.length > 0) {
            const e = this._kbFifo.shift();
            this._kbCurCode = e.code;
            if (e.fn !== null) {
                this._kbCurFn = e.fn;
                this._kbState = 'fn_expose';   // latch reste à 0, fn exposé 1 tick
            } else {
                this._kbCurFn = null;
                this._kbState = 'pending';
                this._kbLatch = true;
            }
        } else {
            this._kbCurFn = null;
        }
    }

    /** Activer/désactiver un bit de fn_keys. */
    setFnKey(mask, active) {
        if (active) this._fnKeys |=  (mask & 0x7F);
        else        this._fnKeys &= ~(mask & 0x7F);
    }

    /** Définir fn_keys directement. */
    setFnKeys(val) {
        this._fnKeys = val & 0x7F;
    }

    /** Déclencher un NMI → push PC, IFF1=0, PC=0x0066. */
    nmi() {
        const cpu = this.cpu;
        cpu.iff2 = cpu.iff1;
        cpu.iff1 = 0;
        if (cpu.halted) { cpu.halted = false; cpu.pc = (cpu.pc + 1) & 0xFFFF; }
        cpu.push(cpu.pc);
        cpu.pc = 0x0066;
    }

    // ─────────────────────────────────────────────────────────────
    // Breakpoints
    // ─────────────────────────────────────────────────────────────

    addBreakpoint(addr) {
        this.cpu.setBreakpoint(addr & 0xFFFF);
    }

    removeBreakpoint(addr) {
        this.cpu.clearBreakpoint(addr & 0xFFFF);
    }

    // ─────────────────────────────────────────────────────────────
    // Désassemblage / état CPU (pour le panneau debug)
    // ─────────────────────────────────────────────────────────────

    disasmAt(addr) {
        return _disasmAt((a) => this.cpu.mem[a & 0xFFFF], addr & 0xFFFF);
    }

    /** Retourne un objet avec tous les registres et drapeaux du CPU. */
    getCpuState() {
        const cpu = this.cpu;
        const f   = cpu.f;
        return {
            pc: cpu.pc, sp: cpu.sp, ix: cpu.ix, iy: cpu.iy,
            af: cpu.af, bc: cpu.bc, de: cpu.de, hl: cpu.hl,
            a: cpu.a, f,
            flags: {
                S: !!(f & 0x80), Z: !!(f & 0x40), Y: !!(f & 0x20), H: !!(f & 0x10),
                X: !!(f & 0x08), P: !!(f & 0x04), N: !!(f & 0x02), C: !!(f & 0x01),
            },
            iff1: cpu.iff1, iff2: cpu.iff2, im: cpu.im,
            halted: cpu.halted,
            // Registres alternatifs
            af_: (cpu.a_ << 8) | cpu.f_,
            bc_: (cpu.b_ << 8) | cpu.c_,
            de_: (cpu.d_ << 8) | cpu.e_,
            hl_: (cpu.h_ << 8) | cpu.l_,
            // WD1002
            wd: {
                error: this._wdError, sectorCount: this._wdSectorCount,
                sectorNum: this._wdSectorNum,
                cyl: ((this._wdCylHigh & 0xFF) << 8) | (this._wdCylLow & 0xFF),
                head: this._wdHead, mode: this._wdMode, idx: this._wdDataIdx,
            },
            eni50:  this.eni50,
            fnKeys: this._fnKeys,
            kbFifoLen: this._kbFifo.length,
        };
    }

    /** Lire un octet de la mémoire CPU. */
    memRead(addr) {
        return this.cpu.mem[addr & 0xFFFF];
    }

    /** Écrire un octet dans la mémoire CPU. */
    memWrite(addr, val) {
        this.cpu.mem[addr & 0xFFFF] = val & 0xFF;
    }

    /**
     * Renvoie l'écran texte sous forme de tableau [HEIGHT][WIDTH] de caractères.
     * ch : caractère Unicode (SMAKY_CHARS)
     * inv : true si inverso vidéo (bit7=1 du code Smaky)
     */
    getTextScreen() {
        const mem  = this.cpu.mem;
        const rows = [];
        for (let y = 0; y < HEIGHT; y++) {
            const cols = [];
            for (let x = 0; x < WIDTH; x++) {
                const b   = mem[VIDEO_START + y * WIDTH + x] & 0xFF;
                const inv = !!(b & 0x80);
                const ch  = SMAKY_CHARS[b & 0x7F];
                cols.push({ ch, inv });
            }
            rows.push(cols);
        }
        return rows;
    }

    // ─────────────────────────────────────────────────────────────
    // Callbacks I/O Z80
    // ─────────────────────────────────────────────────────────────

    _ioIn(port) {
        const p = port & 0xFF;

        if (p === 0x00) {
            // Lecture du port $0 : efface le strobe (bit2 de $1).
            if (this._kbState === 'pending') {
                const code = this._kbCurCode & 0x7F;
                this._kbLatch = false;
                // Gap seulement si le prochain char est identique : la ROM
                // a alors besoin de voir bit2=0 plusieurs ticks pour ne pas
                // confondre avec un auto-repeat. Sinon on repart immédiate-
                // ment en idle (un char par tick 50 Hz = ~50 chars/s).
                const next = this._kbFifo[0];
                if (next && next.code === code && next.fn === null) {
                    this._kbState = 'gap';
                    this._kbGapLeft = this.kbGapTicks;
                } else {
                    this._kbState = 'idle';
                }
                return code | 0x80;
            }
            if (this._kbState === 'fn_expose') {
                return this._kbCurFn & 0x7F;
            }
            return this._fnKeys & 0x7F;
        }

        if (p === 0x01) {
            let val = 0;
            if (this._kbLatch) val |= 0x04;
            if (this._timer50Pending)        val |= 0x08;
            return val;
        }

        if (p === 0x03) {
            return this._kbLatch ? 0x04 : 0x00;
        }

        if (p === 0x04) {
            // 8251 data : lire un octet du Paper Reader
            if (this._prFifo.length > 0) {
                const b = this._prFifo.shift();
                if (this._prFifo.length === 0 && this.onPrEmpty) this.onPrEmpty();
                return b;
            }
            return 0xFF;
        }

        if (p === 0x05) {
            // 8251 status : TXRDY(0)=1, RXRDY(1)=PR dispo, TXEMPTY(2)=1, DSR(7)=1
            return 0x85 | (this._prFifo.length > 0 ? 0x02 : 0x00);
        }

        if (p >= 0x20 && p <= 0x27) return this._wd1002In(p);

        if (p === 0x19) return 0xFF;  // pas de FDC : timeout

        return 0;
    }

    _ioOut(port, value) {
        const p = port  & 0xFF;
        const v = value & 0xFF;

        if (p === 0x00) {
            this.eni50   =  !!(v & 0x01);
            this.gfxGros = !(v & 0x02);  // 0=gros (2×2), 1=petit (1×1)
            this.gfxGra  =  !!(v & 0x04);
            this.gfxNox  =  !!(v & 0x08);
            return;
        }

        if (p === 0x01) {
            if (v & 0x08) this._timer50Pending = false;
            return;
        }

        if (p === 0x04) {
            // 8251 data : émettre un octet vers le Paper Punch
            this._ppBuffer.push(v);
            if (this.onPpByte) this.onPpByte(v);
            return;
        }

        if (p === 0x05) {
            // 8251 contrôle : mode word puis command word
            if (this._8251phase === 'mode') {
                this._8251phase = 'cmd';
            } else {
                if (v & 0x40) this._8251phase = 'mode';  // IR = Internal Reset
            }
            return;
        }

        if (p >= 0x20 && p <= 0x27) { this._wd1002Out(p, v); return; }

        if (p === 0x19) return;
    }

    // ─────────────────────────────────────────────────────────────
    // WD1002 — contrôleur disque dur
    // ─────────────────────────────────────────────────────────────

    _wdLba() {
        const cyl  = ((this._wdCylHigh & 0xFF) << 8) | (this._wdCylLow & 0xFF);
        const head = this._wdHead  & 0x1F;
        const sec  = this._wdSectorNum & 0xFF;
        return ((cyl * this._wdHeads) + head) * this._wdSectorsPerTrack + sec;
    }

    _wdLoadSector(lba) {
        const sz  = this._wdSectorSize;
        const off = lba * sz;
        if (this._wdImage && off + sz <= this._wdImage.byteLength) {
            return new Uint8Array(this._wdImage, off, sz).slice();
        }
        // Secteur en RAM (écritures précédentes ou image trop courte)
        return this._wdDisk.get(lba) ?? new Uint8Array(sz);
    }

    _wdStoreSector(lba, data) {
        const sz  = this._wdSectorSize;
        const off = lba * sz;
        if (this._wdImage && off + sz <= this._wdImage.byteLength) {
            new Uint8Array(this._wdImage, off, sz).set(data.subarray(0, sz));
        } else {
            this._wdDisk.set(lba, data.slice(0, sz));
        }
        // Notifier l'application pour persistance (ex. Electron fs.writeFileSync)
        if (this.onDiskWrite && this.diskName && this._wdImage) {
            this.onDiskWrite(this.diskName, this._wdImage);
        }
    }

    _wd1002In(p) {
        if (p === 0x20) {
            if (this._wdMode === 'read') {
                const v = this._wdDataIdx < this._wdData.length
                    ? this._wdData[this._wdDataIdx] : 0;
                this._wdDataIdx++;
                if (this._wdDataIdx >= this._wdData.length) this._wdMode = null;
                return v & 0xFF;
            }
            return 0;
        }
        if (p === 0x21) return this._wdError        & 0xFF;
        if (p === 0x22) return this._wdSectorCount  & 0xFF;
        if (p === 0x23) return this._wdSectorNum    & 0xFF;
        if (p === 0x24) return this._wdCylLow       & 0xFF;
        if (p === 0x25) return this._wdCylHigh      & 0xFF;
        if (p === 0x26) return this._wdHead         & 0xFF;
        if (p === 0x27) return 0x50;   // DRDY + DSC, toujours prêt
        return 0;
    }

    _wd1002Out(p, v) {
        if (p === 0x20) {
            if (this._wdMode === 'write') {
                if (this._wdDataIdx < this._wdData.length) {
                    this._wdData[this._wdDataIdx++] = v;
                }
                if (this._wdDataIdx >= this._wdData.length) {
                    this._wdStoreSector(this._wdLba(), this._wdData);
                    this._wdMode = null;
                }
            }
            return;
        }
        if (p === 0x21) return;
        if (p === 0x22) { this._wdSectorCount = v; return; }
        if (p === 0x23) { this._wdSectorNum   = v; return; }
        if (p === 0x24) { this._wdCylLow      = v; return; }
        if (p === 0x25) { this._wdCylHigh     = v; return; }
        if (p === 0x26) { this._wdHead        = v; return; }
        if (p === 0x27) {
            this._wdError = 0;
            if (v >= 0x10 && v <= 0x1F) {
                // Recalibrate / seek
                this._wdMode = null; this._wdData = new Uint8Array(0); this._wdDataIdx = 0;
            } else if (v === 0x20) {
                // Read sector
                this._wdMode    = 'read';
                const lba       = this._wdLba();
                this._wdData    = this._wdLoadSector(lba);
                this._wdLastRead    = this._wdData.slice();
                this._wdLastReadLba = lba;
                this._wdDataIdx = 0;
            } else if (v === 0x30) {
                // Write sector
                this._wdMode    = 'write';
                this._wdData    = new Uint8Array(this._wdSectorSize);
                this._wdDataIdx = 0;
            } else {
                this._wdMode = null; this._wdData = new Uint8Array(0); this._wdDataIdx = 0;
            }
        }
    }
}

// ─── Export ──────────────────────────────────────────────────────
if (typeof module !== 'undefined') {
    module.exports = { Smaky, SMAKY_CHARS, HEIGHT, WIDTH, GFX_W, GFX_H, GFX_ADDR, VIDEO_START };
} else {
    window.Smaky = Smaky;
}
