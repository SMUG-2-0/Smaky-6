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
const TICKS_PER_CHUNK = 12500;        // ~5 ms Z80 (2.5 MHz)
const TICKS_PER_FRAME = 50000;        // 2.5 MHz / 50 Hz

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
        // Valeur en MHz "Z80-équivalent" : 2.5 = vitesse réelle du
        // Smaky 6 (quartz 2.5 MHz). 0 = illimité (max CPU).
        this.speed          = 2.5;

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
        // Durée (en ticks 50 Hz) pendant laquelle fn_keys est exposé sur
        // port $0 avant l'armement du strobe. La ROM polle fn_keys et
        // peut rater quelques cycles si une routine plus longue est en
        // cours. 4 ticks (80 ms) = compromis fiabilité / réactivité ;
        // 1 ou 2 ticks produisent des races intermittentes sur les
        // flèches (char F/D/R/C interprété comme littéral).
        this.kbFnExposeTicks = 4;
        this._kbFnExposeLeft = 0;
        // Mini-gap après une touche avec fn co-tenu (ex. cursor+F) :
        // garde fn_keys exposé quelques ticks pour la ROM qui relirait
        // l'image après le char. Distinct de kbGapTicks (anti-rebond
        // auto-repeat de chars identiques).
        this.kbFnHoldGapTicks = 4;

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

        // ── Haut-parleur (port $3) ──────────────────────────────
        // Schéma matériel : chaque OUT $3 fait basculer une JK qui
        // commande un petit haut-parleur via une résistance. La valeur
        // écrite est ignorée. On collecte les bascules du tick courant
        // avec leur position en T-states (depuis le début du tick) et
        // on les transmet via onSpeakerChunk pour reconstituer le
        // signal carré côté Web Audio.
        this._spkLevel        = 1;     // état courant de la JK : +1 / -1
        this._spkChunkEvents  = null;  // array exposé à _ioOut pendant cpu.run()
        this._spkChunkAccum   = 0;     // T-states écoulés avant le run() en cours
        this.onSpeakerChunk   = null;  // (events, ticks, levelStart, tStateSec) => void

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

        // ── FDC (Floppy Disk Controller, ports $18–$1B) ──────────
        // $19 : contrôle (OUT) / statut (IN)
        // $18 : données write
        // $1A : statut bit7=prêt (IN) et données write (OUT)
        // $1B : données read (IN)
        this._fdcImages   = [null, null];  // ArrayBuffer DX1: DX2:
        this._fdcNames    = [null, null];  // noms des images
        this._fdcControl  = 0;             // dernier OUT $19
        this._fdcDrive    = -1;            // drive courant (0=FD1, 1=FD2, -1=aucun)
        this._fdcLogCount = 0;
        this._fdcLogMax   = 10000;         // étendu pour capturer une session de read complète
        // Transfert FDC en cours (Lot 2b)
        this._fdcXferBuf    = null;        // Uint8Array : header + data + checksum
        this._fdcXferPos    = 0;
        this._fdcXferActive = false;
        this._fdcSector     = [0, 0];      // n° secteur courant par drive (auto-incrémenté)
        this._fdcIntPending = false;       // IT FDC à délivrer dès que IFF1 = 1
        this._fdcLogLast  = '';            // pour compression des répétitions
        this._fdcLogRepeat = 0;

        // ── Détection JP 0 (bascule ROM18 → SYS.SY) ─────────────
        // ROM18 et SYS.SY partagent le même premier octet (F3 = DI).
        // On utilise un mot à l'offset 2 qui diffère : ROM18[2]=00, SYS.SY[2]=30.
        // Dès que mem[2..3] change, LDIR a copié SYS.SY et JP 0 est imminent.
        this._romWord2    = 0xFFFF;  // initialisé par loadROM()
        this._sysSyActive = false;

        // ── E405 RTC (Micro Electronic Marin, port $8) ───────────
        // Bit-banging sériel : bit0=data, bit1=master OE, bit2=CS,
        // bit3=clk. Adresse 4 bits LSB-first ($0F=lecture, $07=écri-
        // ture), puis 7 octets BCD : H, M, dom, mo, yy, dow, sec.
        // Asymétrie : la puce envoie en LSB-first, le master écrit
        // en MSB-first (RR (HL) vs RL (HL) côté SAMOS).
        // L'écriture met à jour `_rtcOffsetMs` (heure simulée =
        // heure du PC + offset). L'horloge du PC n'est jamais
        // touchée.
        this._rtcCS        = false;
        this._rtcLastClk   = false;
        this._rtcPhase     = 'idle';      // 'idle' | 'addr' | 'data'
        this._rtcAddrBits  = 0;
        this._rtcAddrCount = 0;
        this._rtcDir       = 'read';      // 'read' | 'write'
        this._rtcByteIdx   = 0;
        this._rtcBitIdx    = 0;
        this._rtcReadBuf   = new Uint8Array(7);
        this._rtcWriteBuf  = new Uint8Array(7);
        this._rtcOffsetMs  = 0;

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
        this._romWord2    = this.cpu.mem[2] | (this.cpu.mem[3] << 8);
        this._sysSyActive = false;
        this._fdcLogCount = 0;
        this._fdcDrive    = -1;
        this._fdcControl  = 0;
        this._fdcXferActive = false;
        this._fdcXferPos    = 0;
        this._fdcSector     = [0, 0];
        this._fdcIntPending = false;
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

    /**
     * Charge une image disquette (index 0 = DX1:, index 1 = DX2:).
     * buffer = ArrayBuffer ou null pour éjecter.
     */
    loadFloppy(index, buffer, name) {
        if (index < 0 || index > 1) return;
        if (buffer) {
            this._fdcImages[index] = buffer;
            this._fdcNames[index]  = name || `DX${index + 1}:`;
            console.log(`FDC: loadFloppy(${index}, ${name}) — ${buffer.byteLength} octets`);
        } else {
            this._fdcImages[index] = null;
            this._fdcNames[index]  = null;
            console.log(`FDC: loadFloppy(${index}, ${name}) — buffer null, drive éjecté`);
        }
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
            // speed en MHz "Z80-équivalent", Z80 réel du Smaky 6 = 2.5 MHz
            const mhz = this.speed;
            ticksToRun = Math.round(mhz * 1e6 * elapsed / 1000);
        }

        // Préparer la collecte des bascules haut-parleur pour ce tick.
        // Ne rien collecter (et donc ne rien faire dans _ioOut) si aucun
        // consommateur n'écoute, ou si la vitesse est illimitée (audio
        // n'aurait pas de sens : pas de référence temporelle).
        const wantSpk    = !!(this.onSpeakerChunk && this.speed > 0);
        const spkEvents  = wantSpk ? [] : null;
        const spkLvlInit = this._spkLevel;
        this._spkChunkEvents = spkEvents;
        this._spkChunkAccum  = 0;

        let ticksDone = 0;
        while (ticksDone < ticksToRun && this.mode === 'running') {
            const chunk = Math.min(TICKS_PER_CHUNK, ticksToRun - ticksDone);
            cpu.ticksToStop = chunk;
            const ev = cpu.run();
            ticksDone += chunk;
            if (wantSpk) this._spkChunkAccum += cpu.tCount;

            if (ev & _Z80.BREAKPOINT_HIT) {
                this.mode = 'interactive';
                this._emitSpeaker(spkEvents, spkLvlInit);
                this._spkChunkEvents = null;
                this._emitFrame();
                if (this.onStopped) this.onStopped('breakpoint');
                return;
            }

            // IT FDC pending (RST 1) : délivrée dès que IFF1 = 1 (= sortie
            // d'un handler IT précédent + ION). On essaie à chaque chunk.
            if (this._fdcIntPending) {
                cpu.intVector = 0xCF;          // RST 1 → 0x08
                if (cpu.handleActiveInt()) {
                    this._fdcIntPending = false;
                }
                // sinon : reste pending jusqu'au prochain chunk
            }

            // Timer 50 Hz : déclenche une interruption toutes les 70000 T-states
            this.ticksSinceInt += chunk;
            if (this.eni50 && this.ticksSinceInt >= TICKS_PER_FRAME) {
                this.ticksSinceInt -= TICKS_PER_FRAME;
                this._timer50Pending = true;
                this._kbTick();
                cpu.intVector = 0xFF;          // RST 7 → 0x38
                cpu.handleActiveInt();
            }
        }

        this._emitSpeaker(spkEvents, spkLvlInit);
        this._spkChunkEvents = null;
        this._emitFrame();
        this._scheduleNext();
    }

    _emitSpeaker(events, levelStart) {
        if (!events || events.length === 0) return;
        // tStateSec : durée d'un T-state en secondes de temps réel
        // (= durée audio à produire). Calculée à partir de la vitesse
        // instantanée du simulateur, pour que le son reste synchrone
        // avec la perception visuelle, même si l'utilisateur change
        // la vitesse en cours de session.
        const tStateSec = 1 / (this.speed * 1e6);
        this.onSpeakerChunk(events, this._spkChunkAccum, levelStart, tStateSec);
        // Toggle final : nombre impair de bascules → niveau inversé.
        if (events.length & 1) this._spkLevel = -this._spkLevel;
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
            // Maintenir fn_keys exposé pendant plusieurs ticks pour que la
            // ROM ait le temps d'observer le bit cursor (ou autre modifier)
            // dans son polling avant de voir le strobe.
            if (--this._kbFnExposeLeft > 0) return;
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
                this._kbFnExposeLeft = this.kbFnExposeTicks;
                this._kbState = 'fn_expose';   // latch reste à 0, fn exposé N ticks
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
                // Cas particulier : char avec fn co-tenu (ex. cursor+F) →
                // on force aussi un gap pour que la ROM, en relisant
                // fn_keys juste après, voie encore le bit cursor. Mais
                // un gap COURT (kbFnHoldGapTicks) pour ne pas dégrader
                // la réactivité des flèches.
                const next = this._kbFifo[0];
                const repeatGap = (next && next.code === code && next.fn === null);
                const hasFnHold = (this._kbCurFn !== null);
                if (repeatGap || hasFnHold) {
                    this._kbState = 'gap';
                    this._kbGapLeft = repeatGap ? this.kbGapTicks : this.kbFnHoldGapTicks;
                } else {
                    this._kbState = 'idle';
                }
                return code | 0x80;
            }
            if (this._kbState === 'fn_expose') {
                return this._kbCurFn & 0x7F;
            }
            // Pendant 'gap' (juste après lecture du char), garder le bit
            // cursor co-tenu : sur le vrai Smaky 6, la flèche maintient
            // physiquement la touche cursor pendant que la lettre F/D/R/C
            // est lue. Sans ça, la ROM relit fn_keys=0 et traite le char
            // comme un littéral.
            if (this._kbState === 'gap' && this._kbCurFn !== null) {
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

        if (p === 0x08) return this._rtcIn();

        if (p >= 0x20 && p <= 0x27) return this._wd1002In(p);

        if (p >= 0x18 && p <= 0x1B) return this._fdcIn(p);

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

        if (p === 0x03) {
            // Haut-parleur : bascule JK, valeur ignorée. On enregistre
            // la position T-state de la bascule pour le module audio.
            if (this._spkChunkEvents) {
                this._spkChunkEvents.push(this._spkChunkAccum + this.cpu.tCount);
            }
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

        if (p === 0x08) { this._rtcOut(v); return; }

        if (p >= 0x20 && p <= 0x27) { this._wd1002Out(p, v); return; }

        if (p >= 0x18 && p <= 0x1B) { this._fdcOut(p, v); return; }
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

    // ─────────────────────────────────────────────────────────────
    // FDC — contrôleur disquette (ports $18–$1B)
    // ─────────────────────────────────────────────────────────────

    _fdcLog(msg) {
        if (!this._sysSyActive) return;
        if (this._fdcLogCount >= this._fdcLogMax) return;
        if (msg === this._fdcLogLast) {
            this._fdcLogRepeat++;
            return;
        }
        if (this._fdcLogRepeat > 0) {
            console.log(`FDC: … × ${this._fdcLogRepeat + 1} répétitions`);
            this._fdcLogCount++;
            this._fdcLogRepeat = 0;
        }
        this._fdcLogLast = msg;
        console.log(msg);
        this._fdcLogCount++;
        if (this._fdcLogCount === this._fdcLogMax)
            console.log('FDC: log plafonné (' + this._fdcLogMax + ' entrées)');
    }

    _fdcLogFlush() {
        if (this._fdcLogRepeat > 0) {
            console.log(`FDC: … × ${this._fdcLogRepeat + 1} répétitions`);
            this._fdcLogRepeat = 0;
        }
    }

    _fdcCheckHandoff() {
        const w2 = this.cpu.mem[2] | (this.cpu.mem[3] << 8);
        if (!this._sysSyActive && w2 !== this._romWord2) {
            this._sysSyActive = true;
            this._fdcLogCount = 0;
            console.log('FDC: JP 0 détecté — SYS.SY actif, floppy visible');
        }
    }

    /**
     * Décodage de la commande écrite sur $19 (CONTR) :
     *   bits 6-7 = drive_mask ($40 = FD1, $80 = FD2)
     *   bits 0-4 = opcode (sélection seule, $02 wait, $0A seek, $0C read,
     *              $0E write, $12 init/calibrate, $0F reset, etc.)
     * Retourne l'index du drive (0 ou 1), ou -1 si masque invalide (ex. $00 ou
     * masque HD $20 qui n'arrive pas ici, c'est le WD1002 qui le gère).
     */
    _fdcDriveFromMask(mask) {
        switch (mask & 0xC0) {
            case 0x40: return 0;  // FD1
            case 0x80: return 1;  // FD2
            default:   return -1;
        }
    }

    /** Décode une valeur écrite sur $19 en label lisible. */
    _fdcDecodeCmd(v) {
        const driveMask = v & 0xC0;
        const opcode    = v & 0x1F;
        const drive = driveMask === 0x40 ? 'FD1' :
                      driveMask === 0x80 ? 'FD2' :
                      driveMask === 0x00 ? '---' : `mask${driveMask.toString(16)}`;
        const op = {
            0x00: 'select',
            0x02: 'wait_ready',
            0x0A: 'seek?',
            0x0C: 'read_sec',
            0x0E: 'write_sec',
            0x0F: 'reset/ack',
            0x12: 'init/calib',
        }[opcode] || `op_${opcode.toString(16).toUpperCase()}`;
        return `${drive} ${op}`;
    }

    _fdcIn(p) {
        this._fdcCheckHandoff();
        let val;
        if (p === 0x19) {
            // CONTR en lecture = statut.
            //   bit 6 = 0 → drive prêt, 1 → absent/occupé
            //   bit 4 = 0 → pas busy interne (sinon SAMOS attend dans L_2183)
            //   bits 0-3 = code de cause IT (utilisé par L_2169 / L_223C)
            const drive = this._fdcDrive;
            const ready = drive >= 0 && this._fdcImages[drive];
            if (this._fdcXferActive) {
                // Bits 0-3 = E mémorisé au moment du OUT $19 ← cmd_read.
                // SAMOS l'utilise pour : (a) tester via mem[$244F+E] AND
                // mem[$2B9F] qu'il veut bien ce bloc, (b) indexer la table
                // par drive ($2BA3+2*E) pour choisir le buffer cible.
                val = this._fdcXferE;
            } else {
                val = ready ? 0x00 : 0xFF;
            }
        } else if (p === 0x1A) {
            // RDREQ — bit 7 = DRQ (octet prêt). Pas loggué : c'est juste
            // du polling très bruyant.
            val = (this._fdcXferActive && this._fdcXferPos < this._fdcXferBuf.length) ? 0x80 : 0x00;
            return val;
        } else if (p === 0x1B) {
            // RDBYT — sert l'octet courant du buffer de transfert.
            if (this._fdcXferActive && this._fdcXferBuf && this._fdcXferPos < this._fdcXferBuf.length) {
                val = this._fdcXferBuf[this._fdcXferPos++];
                if (this._fdcXferPos >= this._fdcXferBuf.length) {
                    this._fdcXferActive = false;
                    // Annule toute IT fantôme : le pending éventuellement set
                    // au re-issue intra-L_2169 (juste avant ce transfert) ne
                    // doit pas survivre au transfert. Si SAMOS veut le sector
                    // suivant, L_22B4 fera un OUT $19 ← 4C qui re-set pending.
                    this._fdcIntPending = false;
                    // Dump RAM destination pour voir si les data atterrissent
                    const m = this.cpu.mem;
                    const dumpZone = (base, label) => {
                        let dump = '';
                        for (let row = 0; row < 4; row++) {
                            let hex = '', ascii = '';
                            for (let col = 0; col < 16; col++) {
                                const b = m[base + row*16 + col];
                                hex += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
                                ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
                            }
                            dump += `\n  $${(base + row*16).toString(16).toUpperCase().padStart(4,'0')}: ${hex} ${ascii}`;
                        }
                        return `${label} = $${base.toString(16).toUpperCase().padStart(4,'0')}+64:${dump}`;
                    };
                    const baseDest = 0x2300 + this._fdcXferE * 0x100;
                    console.log(`FDC: transfert fini (E=${this._fdcXferE}, ${this._fdcXferBuf.length} octets)\n${dumpZone(baseDest, 'RAM dest présumée')}\n${dumpZone(0x2600, 'RAM $2600 (DE backup)')}`);
                }
            } else {
                val = 0xFF;
            }
            return val;  // pas loggué non plus
        } else {
            val = 0xFF;
        }
        const name = ['$18','$19','$1A','$1B'][p - 0x18];
        this._fdcLog(`FDC IN  ${name} → ${val.toString(16).toUpperCase().padStart(2,'0')}H`);
        return val;
    }

    _fdcOut(p, v) {
        this._fdcCheckHandoff();
        const name = ['$18','$19','$1A','$1B'][p - 0x18];
        const vh   = v.toString(16).toUpperCase().padStart(2,'0');
        if (p === 0x19) {
            this._fdcLog(`FDC OUT $19 ← ${vh}H  [${this._fdcDecodeCmd(v)}]`);
            this._fdcControl = v;
            this._fdcDrive   = this._fdcDriveFromMask(v);
            // Lot 2b : exécution de la commande read sector ($0C).
            // Format du transfert (déduit empiriquement) :
            //   byte 0       : pré-data (lu mais non comparé)
            //   byte 1       : marker (= mem[$2B8C+drive_offset], comparé)
            //   bytes 2..257 : 256 octets de data
            //   byte 258     : checksum (somme modulo 256 des 256 data)
            // Choix de E : on lit le masque "sectors voulus" mem[$2B9F] et
            // on prend le 1er bit set. SAMOS clear ce bit après chaque
            // transfert. E est ensuite servi en bits 0-3 du statut $19, et
            // sert aussi à indexer la table buffers $2BA3 + 2*E.
            // L'offset physique sur l'image = E * 256 (= sector E).
            const opcode = v & 0x1F;
            if (opcode === 0x0C && this._fdcDrive >= 0) {
                const drive    = this._fdcDrive;
                const img      = this._fdcImages[drive];
                const wantMask = this.cpu.mem[0x2B9F];
                if (img && wantMask !== 0) {
                    let E = 0;
                    for (let i = 0; i < 8; i++) {
                        if (wantMask & (1 << i)) { E = i; break; }
                    }
                    const offset = E * 256;
                    if (offset + 256 <= img.byteLength) {
                        const data           = new Uint8Array(img, offset, 256);
                        const markerAddr     = drive === 0 ? 0x2B8C : 0x2B8D;
                        const expectedMarker = this.cpu.mem[markerAddr];
                        const buf            = new Uint8Array(259);
                        buf[0] = 0x00;
                        buf[1] = expectedMarker;
                        buf.set(data, 2);
                        let sum = 0;
                        for (let i = 0; i < 256; i++) sum = (sum + data[i]) & 0xFF;
                        buf[258] = sum;
                        this._fdcXferBuf    = buf;
                        this._fdcXferPos    = 0;
                        this._fdcXferActive = true;
                        this._fdcXferE      = E;
                        // Dump hex + ASCII des 256 data bytes pour debug
                        const lines = [];
                        for (let row = 0; row < 16; row++) {
                            let hex = '', ascii = '';
                            for (let col = 0; col < 16; col++) {
                                const b = data[row*16 + col];
                                hex += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
                                ascii += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
                            }
                            lines.push(`  ${(row*16).toString(16).toUpperCase().padStart(3,'0')}: ${hex} ${ascii}`);
                        }
                        console.log(`FDC: read E=${E} (offset=$${offset.toString(16)}, masque=$${wantMask.toString(16).toUpperCase().padStart(2,'0')}, marker=$${expectedMarker.toString(16).toUpperCase().padStart(2,'0')}, chk=$${sum.toString(16).toUpperCase().padStart(2,'0')})\n${lines.join('\n')}`);
                        this._fdcIntPending = true;
                    } else {
                        console.log(`FDC: read E=${E} hors image (taille ${img.byteLength})`);
                    }
                } else if (wantMask === 0) {
                    // Plus rien à lire — SAMOS sortira via L_211B (HL=0).
                    // On ne déclenche pas d'IT.
                }
            }
        } else if (p === 0x1A) {
            // STPCMD — impulsion de pas moteur. La valeur encode probablement
            // drive + direction. À analyser quand on aura assez de traces.
            this._fdcLog(`FDC OUT $1A ← ${vh}H  [STPCMD]`);
        } else if (p === 0x18) {
            // WRBYT — données ou paramètre (n° de secteur ?).
            this._fdcLog(`FDC OUT $18 ← ${vh}H  [WRBYT]`);
        } else {
            this._fdcLog(`FDC OUT ${name} ← ${vh}H`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // E405 — Real-Time Clock (port $8)
    // ─────────────────────────────────────────────────────────────

    _bcd(n)   { return ((Math.floor(n / 10) << 4) | (n % 10)) & 0xFF; }
    _unbcd(b) { return ((b >> 4) & 0xF) * 10 + (b & 0xF); }

    /** Capture l'heure simulée (PC + offset) dans _rtcReadBuf en BCD. */
    _rtcCaptureSnapshot() {
        const d = new Date(Date.now() + this._rtcOffsetMs);
        this._rtcReadBuf[0] = this._bcd(d.getHours());
        this._rtcReadBuf[1] = this._bcd(d.getMinutes());
        this._rtcReadBuf[2] = this._bcd(d.getDate());
        this._rtcReadBuf[3] = this._bcd(d.getMonth() + 1);
        this._rtcReadBuf[4] = this._bcd(d.getFullYear() % 100);
        // JS getDay() : 0=dimanche..6=samedi → convention E405 1=lundi..7=dimanche
        const jsDow = d.getDay();
        this._rtcReadBuf[5] = this._bcd(jsDow === 0 ? 7 : jsDow);
        this._rtcReadBuf[6] = this._bcd(d.getSeconds());
    }

    /** Décode _rtcWriteBuf BCD et met à jour _rtcOffsetMs. */
    _rtcApplyWrite() {
        const b   = this._rtcWriteBuf;
        const H   = this._unbcd(b[0]);
        const M   = this._unbcd(b[1]);
        const dom = this._unbcd(b[2]);
        const mo  = this._unbcd(b[3]);
        const yy  = this._unbcd(b[4]);
        // dow (b[5]) ignoré : redondant avec la date.
        const ss  = this._unbcd(b[6]);
        // Pivot YY → année : ≥70 → 19YY, sinon 20YY.
        const Y = yy >= 70 ? 1900 + yy : 2000 + yy;
        const target = new Date(Y, mo - 1, dom, H, M, ss).getTime();
        if (!isNaN(target)) {
            this._rtcOffsetMs = target - Date.now();
        }
    }

    _rtcIn() {
        // En lecture data : présente bit `_rtcBitIdx` (LSB-first) du
        // snapshot[byteIdx] sur bit 0. Hors phase data en lecture : 0.
        if (this._rtcPhase === 'data' && this._rtcDir === 'read' &&
            this._rtcByteIdx < 7) {
            return (this._rtcReadBuf[this._rtcByteIdx] >> this._rtcBitIdx) & 0x01;
        }
        return 0;
    }

    _rtcOut(v) {
        const cs   = !!(v & 0x04);
        const clk = !!(v & 0x08);
        const data =  (v & 0x01);

        // CS rising edge : nouvelle transaction → snapshot et reset FSM.
        if (cs && !this._rtcCS) {
            this._rtcPhase     = 'addr';
            this._rtcAddrBits  = 0;
            this._rtcAddrCount = 0;
            this._rtcByteIdx   = 0;
            this._rtcBitIdx    = 0;
            this._rtcCaptureSnapshot();
            this._rtcWriteBuf.fill(0);
        }

        // CS falling edge : fin de transaction. Si écriture complète,
        // applique l'offset.
        if (!cs && this._rtcCS) {
            if (this._rtcPhase === 'data' && this._rtcDir === 'write' &&
                this._rtcByteIdx === 7) {
                this._rtcApplyWrite();
            }
            this._rtcPhase = 'idle';
        }

        // Front montant horloge pendant transaction.
        if (cs && clk && !this._rtcLastClk) {
            if (this._rtcPhase === 'addr') {
                // 4 bits adresse, LSB-first.
                this._rtcAddrBits |= (data << this._rtcAddrCount);
                this._rtcAddrCount++;
                if (this._rtcAddrCount === 4) {
                    // $0F=lecture, $07=écriture (le bit 3 de l'adresse
                    // distingue les deux ; tout autre code → ignoré).
                    this._rtcDir   = (this._rtcAddrBits & 0x08) ? 'read' : 'write';
                    this._rtcPhase = 'data';
                }
            } else if (this._rtcPhase === 'data') {
                if (this._rtcDir === 'write' && this._rtcByteIdx < 7) {
                    // Écriture : MSB-first (bit transmis = bit 7,6,...,0).
                    this._rtcWriteBuf[this._rtcByteIdx] |= (data << (7 - this._rtcBitIdx));
                }
                // Avance compteur (lecture comme écriture).
                this._rtcBitIdx++;
                if (this._rtcBitIdx === 8) {
                    this._rtcBitIdx = 0;
                    this._rtcByteIdx++;
                }
            }
        }

        this._rtcCS      = cs;
        this._rtcLastClk = clk;
    }
}

// ─── Export ──────────────────────────────────────────────────────
if (typeof module !== 'undefined') {
    module.exports = { Smaky, SMAKY_CHARS, HEIGHT, WIDTH, GFX_W, GFX_H, GFX_ADDR, VIDEO_START };
} else {
    window.Smaky = Smaky;
}
