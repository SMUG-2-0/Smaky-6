#ifndef HEADER_LZ_H
#define HEADER_LZ_H

#include <stdint.h>
#include <stddef.h>

int LZ4_decompress_safe(const char* source, char* dest, int compressedSize, int maxOutputSize);

/* Décompression d’un bloc issu de votre fichier compressé */
int decompress_block(uint32_t block_id, uint8_t *dest, uint32_t dest_size);

#endif // HEADER_LZ_H
