/*
 * floppy.h
 *
 *  Created on: Jan 23, 2026
 *      Author: Pierre-Yves Rochat
 */

#ifndef INC_FLOPPY_H_
#define INC_FLOPPY_H_

#include "ff.h"
#include <stdint.h>

#define FLOPPY_BLOCK_SIZE 256

FRESULT InitFloppy(char* fileName);
FRESULT ReadBlocFloppy(uint16_t blocNumber, uint8_t* data);
FRESULT WriteBlocFloppy(uint16_t blocNumber, uint8_t* data);

#endif /* INC_FLOPPY_H_ */
