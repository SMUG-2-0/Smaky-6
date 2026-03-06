#include "lz4_decompress.h"

#include "DemoLz4hc.h"


/* --------------------------------------------------------------------
   LZ4 — decodeur "safe" (version compacte pour microcontrôleurs)
   Source officielle modifiée pour tenir dans un seul fichier.
   -------------------------------------------------------------------- */

#define STEPSIZE sizeof(size_t)

static int LZ4_decompress_generic(
    const char* source,
    char* dest,
    int inputSize,
    int outputSize)
{
    const uint8_t* ip = (const uint8_t*) source;
    const uint8_t* const iend = ip + inputSize;

    uint8_t* op = (uint8_t*) dest;
    uint8_t* const oend = op + outputSize;

    while (ip < iend) {
        /* ---- 1. Lire le token ---- */
        uint8_t token = *ip++;
        unsigned literal_length = (token >> 4);

        /* ---- 2. Littéraux ---- */
        if (literal_length == 15) {
            uint8_t s;
            do {
                s = *ip++;
                literal_length += s;
            } while (s == 255);
        }

        if ((op + literal_length) > oend) return -1;
        if ((ip + literal_length) > iend) return -1;

        /* Copier littéraux */
        while (literal_length--) {
            *op++ = *ip++;
        }

        if (ip >= iend) break;  // fin

        /* ---- 3. Lire offset ---- */
        uint16_t offset = ip[0] | (ip[1] << 8);
        ip += 2;
        if (offset == 0) return -2;

        uint8_t* match = op - offset;
        if (match < (uint8_t*)dest) return -3;

        /* ---- 4. Longueur du match ---- */
        unsigned match_length = (token & 0xF) + 4;
        if ((token & 0xF) == 15) {
            uint8_t s;
            do {
                s = *ip++;
                match_length += s;
            } while (s == 255);
        }

        if ((op + match_length) > oend) return -4;

        /* Copier match (gère chevauchement) */
        while (match_length--) {
            *op++ = *match++;
        }
    }

    return (int)(op - (uint8_t*)dest);
}


/* API publique */
int LZ4_decompress_safe(const char* source, char* dest, int compressedSize, int maxOutputSize)
{
    return LZ4_decompress_generic(source, dest, compressedSize, maxOutputSize);
}


/* --------------------------------------------------------------------
   Décompression d’un bloc issu du packer Python
   -------------------------------------------------------------------- */
// extern const uint8_t compressed_data[];
// extern const block_index_t block_index[];
// extern const uint32_t BLOCK_COUNT;

int decompress_block(uint32_t block_id, uint8_t *dest, uint32_t dest_size)
{
    if (block_id >= BLOCK_COUNT)
        return -10;

    uint32_t offset = block_index[block_id].offset;
    uint32_t size   = block_index[block_id].size;

    const char *src = (const char *)&demoLz4hc[offset];

    return LZ4_decompress_safe(src, (char*)dest, size, dest_size);
}
