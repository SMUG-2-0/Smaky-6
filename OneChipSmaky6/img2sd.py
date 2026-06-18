#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
img2sd.py — convertit une image disque Smaky (secteurs de 256 octets jointifs)
en image pour carte micro-SD au mapping « 1 secteur = 1 bloc SD de 512 octets ».

Chaque secteur de 256 o est recopié dans la première moitié d'un bloc de 512 o ;
la seconde moitié est remplie de zéros (bourrage ignoré par le contrôleur SD du
SM6Disk). À écrire ensuite sur TOUT le device : sudo dd if=<sortie> of=/dev/mmcblkX bs=512 conv=fsync

Usage : python3 img2sd.py <image_entree> <image_sortie>
"""

import sys
import os

SEC = 256   # taille d'un secteur Smaky
BLK = 512   # taille d'un bloc SD


def convert(src_path, dst_path):
    with open(src_path, "rb") as f:
        src = f.read()

    n = (len(src) + SEC - 1) // SEC          # nombre de secteurs (dernier complété)
    out = bytearray(n * BLK)
    for i in range(n):
        sec = src[i * SEC : (i + 1) * SEC]    # secteur (peut être < 256 pour le dernier)
        out[i * BLK : i * BLK + len(sec)] = sec   # 1re moitié = données ; le reste reste à 0

    with open(dst_path, "wb") as f:
        f.write(out)
    return len(src), n, len(out)


def main():
    if len(sys.argv) != 3:
        print("Usage : python3 img2sd.py <image_entree> <image_sortie>", file=sys.stderr)
        sys.exit(1)

    src_path, dst_path = sys.argv[1], sys.argv[2]
    if not os.path.isfile(src_path):
        print(f"Erreur : '{src_path}' introuvable.", file=sys.stderr)
        sys.exit(1)

    src_len, n, out_len = convert(src_path, dst_path)

    print(f"Entree  : {src_path}  ({src_len} octets = {n} secteurs de {SEC} o)")
    print(f"Sortie  : {dst_path}  ({out_len} octets = {n} blocs SD de {BLK} o)")
    if n > 65536:
        print(f"ATTENTION : {n} secteurs > 65536 -> depasse la limite 16 Mio (wd_lba 16 bits).",
              file=sys.stderr)


if __name__ == "__main__":
    main()
