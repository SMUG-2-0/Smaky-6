'use strict';
// ═══════════════════════════════════════════════════════════════════
// audio.js — simulation du haut-parleur Smaky 6
//
// Le matériel est un simple haut-parleur miniature commandé par une
// bascule JK : chaque OUT $3 inverse la membrane (signal carré 1 bit).
// On reconstitue ce signal échantillon par échantillon à partir des
// bascules collectées par smaky.js, et on le restitue via Web Audio.
//
// Chaîne audio :
//   AudioBufferSource → Highpass 200 Hz → Lowpass 4500 Hz → Gain → Out
// Le passe-bas imite la réponse mécanique limitée d'un petit cône ;
// le passe-haut élimine la composante DC et simule le découplage
// capacitif du circuit.
// ═══════════════════════════════════════════════════════════════════

class SpeakerAudio {
    constructor() {
        this.ctx        = null;
        this.gain       = null;
        this.lowpass    = null;
        this.highpass   = null;
        this.enabled    = true;
        this.volume     = 0.20;
        this._nextTime  = 0;
        // Latence initiale (s) après remise à zéro : assez pour que
        // ~2 chunks puissent être planifiés avant que l'audio ne joue.
        this._initLat   = 0.030;
        // Si l'audio est en retard ou trop en avance, on recale.
        this._maxAhead  = 0.250;
    }

    /**
     * Crée (ou réveille) l'AudioContext. DOIT être appelée depuis un
     * handler d'événement utilisateur (clic, touche) sinon Chromium
     * refuse de démarrer le contexte (politique autoplay).
     */
    resume() {
        if (!this.ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return false;
            this.ctx      = new Ctx();
            this.highpass = this.ctx.createBiquadFilter();
            this.highpass.type = 'highpass';
            this.highpass.frequency.value = 200;
            this.highpass.Q.value = 0.7;
            this.lowpass  = this.ctx.createBiquadFilter();
            this.lowpass.type = 'lowpass';
            this.lowpass.frequency.value = 4500;
            this.lowpass.Q.value = 0.7;
            this.gain     = this.ctx.createGain();
            this.gain.gain.value = this.enabled ? this.volume : 0;
            this.highpass.connect(this.lowpass).connect(this.gain).connect(this.ctx.destination);
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return true;
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (this.gain) this.gain.gain.value = this.enabled ? this.volume : 0;
        if (!this.enabled) this._nextTime = 0;  // recalera au prochain feed
        return this.enabled;
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.gain && this.enabled) this.gain.gain.value = this.volume;
    }

    /**
     * Reçoit un paquet de bascules d'un tick d'émulation et planifie
     * un AudioBuffer correspondant.
     *   events       : array de positions T-state (depuis le début du tick)
     *   ticksInTick  : durée totale du tick en T-states
     *   levelStart   : niveau de la JK avant la première bascule (+1 / -1)
     *   tStateSec    : durée d'un T-state en secondes (temps réel audio)
     */
    feed(events, ticksInTick, levelStart, tStateSec) {
        if (!this.ctx || !this.enabled || ticksInTick <= 0) return;
        if (events.length === 0) return;

        const sr       = this.ctx.sampleRate;
        const durSec   = ticksInTick * tStateSec;
        const nSamples = Math.max(1, Math.round(durSec * sr));
        const buf      = this.ctx.createBuffer(1, nSamples, sr);
        const data     = buf.getChannelData(0);

        // Walk d'un échantillon à l'autre, en consommant les bascules
        // dont la position T-state est ≤ position de l'échantillon.
        const ticksPerSample = ticksInTick / nSamples;
        let level = levelStart;
        let ei    = 0;
        const nev = events.length;
        for (let i = 0; i < nSamples; i++) {
            const tEnd = (i + 1) * ticksPerSample;
            while (ei < nev && events[ei] < tEnd) {
                level = -level;
                ei++;
            }
            data[i] = level;
        }

        const now = this.ctx.currentTime;
        if (this._nextTime < now) {
            // Premier chunk, ou on a pris du retard : ré-ancrer.
            this._nextTime = now + this._initLat;
        } else if (this._nextTime - now > this._maxAhead) {
            // Le simulateur tourne plus vite que le temps réel et empile
            // des buffers ; on saute celui-ci pour limiter la latence.
            return;
        }

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.highpass);
        src.start(this._nextTime);
        this._nextTime += durSec;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SpeakerAudio };
} else if (typeof window !== 'undefined') {
    window.SpeakerAudio = SpeakerAudio;
}
