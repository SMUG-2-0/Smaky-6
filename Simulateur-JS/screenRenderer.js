// Smaky 6 — moteur de rendu en pixels élémentaires.
//
// Reconstitue le pipeline matériel : un compteur de balayage X (0..511) et
// Y (0..319) parcourt l'écran ; à chaque pixel élémentaire, on combine le
// bit issu du générateur de caractères (PROM TMS2716) et le bit issu de la
// chaîne graphique. Combinaison : OR booléen (les deux affichages s'ajoutent).
//
// Géométrie (validée visuellement) :
//   - Écran physique     : 512 × 240 pixels élémentaires
//   - Cellule caractère  : 8 × 12 (le hardware lit rows 0..11 de la PROM ;
//                          rows 12..15 stockés en PROM mais non câblés)
//   - Pixel graphique    : 2 × 2 pixels élémentaires (mode gros)
//                          ou 1 × 1 pixel élémentaire en haut-gauche (mode petit)
//   - Zone gfx           : couvre l'intégralité de l'écran (120 × 2 = 240 lignes)
'use strict';

const SCREEN_W       = 512;
const SCREEN_H       = 240;
const CHAR_W         = 8;
const CHAR_H         = 12;
const PROM_BYTES_PER_CHAR = 16;  // PROM stocke 16 octets/char (rows 12-15 non câblées)
const TEXT_COLS      = 64;
const TEXT_ROWS      = 20;       // 20 × 12 = 240 ✓
const GFX_W_PX       = 256;
const GFX_H_PX       = 120;
const GFX_PAIR_BYTES = 64;       // 64 octets par paire de lignes graphiques
                                 // (renommé pour éviter conflit avec GFX_BPR de smaky.js)
const GFX_X_OFFSET = 0;
const GFX_Y_OFFSET = 0;

// Palettes : couleur du phosphore allumé / éteint.
const PALETTES = {
    green: { name: 'Vert P31',           on: [0x33, 0xCC, 0x33], off: [0x00, 0x10, 0x00] },
    gray:  { name: 'Gris (prototype)',   on: [0xCC, 0xCC, 0xCC], off: [0x10, 0x10, 0x10] },
    amber: { name: 'Ambre',              on: [0xFF, 0xB0, 0x40], off: [0x18, 0x10, 0x00] },
};

/**
 * Remplit `imgData` (ImageData de 512×320, RGBA) à partir des VRAM Smaky.
 *
 * @param {ImageData} imgData    cible — width = 512, height = 320
 * @param {Uint8Array} textMem   1280 octets : VRAM texte ($4000..$44FF)
 * @param {Uint8Array} gfxMem    3840 octets : VRAM graphique ($4600..$54FF)
 * @param {Uint8Array} prom      2048 octets : générateur de caractères TMS2716
 * @param {Object} flags         { gra, nox, gros } — convention Smaky.onFrame
 * @param {Object} palette       { on:[r,g,b], off:[r,g,b] }
 */
function renderScreen(imgData, textMem, gfxMem, prom, flags, palette) {
    const data    = imgData.data;
    const gfxGra  = !!flags.gra;
    const gfxNox  = !!flags.nox;
    const gfxGros = !!flags.gros;
    const onR  = palette.on[0],  onG  = palette.on[1],  onB  = palette.on[2];
    const offR = palette.off[0], offG = palette.off[1], offB = palette.off[2];

    let p = 0;  // index dans le buffer RGBA
    for (let y = 0; y < SCREEN_H; y++) {
        const rowChar = (y / CHAR_H) | 0;   // 0..19 (cellule = 12 lignes)
        const dy      = y - rowChar * CHAR_H;  // 0..11
        const textRowBase = rowChar * TEXT_COLS;

        // Pré-calculs gfx pour cette ligne.
        const gy        = (y - GFX_Y_OFFSET) >> 1;
        const gfxOnRow  = gfxGra && gy >= 0 && gy < GFX_H_PX;
        const gfxBase   = gfxOnRow ? (gy >> 1) * GFX_PAIR_BYTES : 0;
        const gfxIsTop  = gfxOnRow ? ((gy & 1) === 0) : false;
        const yOdd      = (y & 1) !== 0;  // pour mode petit

        for (let x = 0; x < SCREEN_W; x++) {
            // ── Chaîne caractères ──
            let bitTxt = 0;
            if (!gfxNox) {
                const colChar = x >> 3;
                const dx      = x & 7;
                const code    = textMem[textRowBase + colChar];
                const inverse = (code & 0x80) !== 0;
                const glyph   = prom[(code & 0x7F) * PROM_BYTES_PER_CHAR + dy];
                bitTxt = ((glyph >> dx) & 1) ^ (inverse ? 1 : 0);
            }

            // ── Chaîne graphique ──
            let bitGfx = 0;
            if (gfxOnRow) {
                const gx = (x - GFX_X_OFFSET) >> 1;
                if (gx >= 0 && gx < GFX_W_PX) {
                    const oct = gfxMem[gfxBase + (gx >> 2)];
                    bitGfx = gfxIsTop
                        ? (oct >> (7 - (gx & 3))) & 1   // bits 7..4 = ligne haute
                        : (oct >> (3 - (gx & 3))) & 1;  // bits 3..0 = ligne basse
                    // Mode petit : seul le pixel élémentaire haut-gauche
                    // de la cellule 2×2 reçoit le bit ; les 3 autres = 0.
                    if (!gfxGros && (yOdd || (x & 1))) bitGfx = 0;
                }
            }

            // ── Combinaison OR + palette ──
            if (bitTxt | bitGfx) {
                data[p]     = onR;
                data[p + 1] = onG;
                data[p + 2] = onB;
            } else {
                data[p]     = offR;
                data[p + 1] = offG;
                data[p + 2] = offB;
            }
            data[p + 3] = 255;
            p += 4;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderScreen, SCREEN_W, SCREEN_H, PALETTES,
                       CHAR_W, CHAR_H, TEXT_COLS, TEXT_ROWS,
                       GFX_X_OFFSET, GFX_Y_OFFSET };
} else if (typeof window !== 'undefined') {
    window.renderScreen = renderScreen;
    window.SCREEN_W     = SCREEN_W;
    window.SCREEN_H     = SCREEN_H;
    window.PALETTES     = PALETTES;
}
