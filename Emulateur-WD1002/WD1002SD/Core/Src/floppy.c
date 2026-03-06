/*
 * floppy.c
 *
 *  Created on: Jan 23, 2026
 *      Author: Pierre-Yves Rochat
 */

#include "floppy.h"

FIL floppyFile;
uint8_t floppyMounted;

FRESULT InitFloppy(char* fileName)
{
    FRESULT res;

    if (floppyMounted)
    {
        f_close(&floppyFile);
        floppyMounted = 0;
    }

    res = f_open(&floppyFile, fileName, FA_READ | FA_WRITE);
    if (res != FR_OK)
        return res;

    floppyMounted = 1;
    return FR_OK;
}

FRESULT ReadBlocFloppy(uint16_t blocNumber, uint8_t* data)
{
    if (!floppyMounted)
        return FR_NOT_READY;

    FRESULT res;
    UINT bytesRead;
    FSIZE_t offset = (FSIZE_t)blocNumber * FLOPPY_BLOCK_SIZE;

    res = f_lseek(&floppyFile, offset);
    if (res != FR_OK)
        return res;

    res = f_read(&floppyFile, data, FLOPPY_BLOCK_SIZE, &bytesRead);
    if (res != FR_OK)
        return res;

    if (bytesRead != FLOPPY_BLOCK_SIZE)
        return FR_INT_ERR;

    return FR_OK;
}

FRESULT WriteBlocFloppy(uint16_t blocNumber, uint8_t* data)
{
    if (!floppyMounted)
        return FR_NOT_READY;

    FRESULT res;
    UINT bytesWritten;
    FSIZE_t offset = (FSIZE_t)blocNumber * FLOPPY_BLOCK_SIZE;

    res = f_lseek(&floppyFile, offset);
    if (res != FR_OK)
        return res;

    res = f_write(&floppyFile, data, FLOPPY_BLOCK_SIZE, &bytesWritten);
    if (res != FR_OK)
        return res;

    if (bytesWritten != FLOPPY_BLOCK_SIZE)
        return FR_INT_ERR;

    /* Important pour la sécurité des données */
    f_sync(&floppyFile);

    return FR_OK;
}

