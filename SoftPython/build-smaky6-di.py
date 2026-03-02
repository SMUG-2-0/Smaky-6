# -*- coding: utf8 -*-

# Epsitec, Pierre-Yves Rochat, 2026
# Reconstruction d'une image de disque Smaky 6 depuis un fichier JSON
#
# 12.02.2026 : première version (base ChatGPT)

import os
import sys
import json
import math

BLOCK_SIZE = 256
DIR_ENTRIES = 32
DIR_ENTRY_SIZE = 24
DATA_START_BLOCK = 3   # 32 * 24 = 768 octets = bloc 3

print("Reconstruction d'une image disque Smaky 6")
print("Usage: python build-smaky6-di.py dossier index.json image.DI6\n")

if len(sys.argv) < 4:
    sys.exit("Arguments insuffisants.")

folder = sys.argv[1]
json_file = sys.argv[2]
output_file = sys.argv[3]

# -------------------------
# Outils
# -------------------------

def to_bcd(n):
    return ((n // 10) << 4) | (n % 10)

def encode_date(date_str):
    if not date_str:
        return bytes([0xFF, 0xFF, 0xFF])
    try:
        j, m, a = date_str.split("-")
        return bytes([
            to_bcd(int(j)),
            to_bcd(int(m)),
            to_bcd(int(a))
        ])
    except:
        return bytes([0xFF, 0xFF, 0xFF])

# -------------------------
# Lecture JSON
# -------------------------

with open(json_file, "r") as f:
    fichiers = json.load(f)

if len(fichiers) > 32:
    sys.exit("Trop de fichiers (max 32).")

fichiers_sorted = fichiers.items()
# Tri facultatif : par nom
# fichiers_sorted = sorted(fichiers.items())

# -------------------------
# Allocation
# -------------------------

current_block = DATA_START_BLOCK
directory = bytearray(32 * 24)
data_blocks = bytearray()

for index, (nomFi, info) in enumerate(fichiers_sorted):

    path = os.path.join(folder, nomFi)

    if not os.path.exists(path):
        print("Fichier manquant :", nomFi)
        continue

    with open(path, "rb") as f:
        data = f.read()

    size = len(data)
    blocks_needed = math.ceil(size / BLOCK_SIZE)

    begin = current_block
    end = begin + blocks_needed
    current_block = end

    print(nomFi, "-> blocs", begin, "à", end-1)

    # -------------------------
    # Écriture données
    # -------------------------

    offset = begin * BLOCK_SIZE
    required_size = end * BLOCK_SIZE

    if len(data_blocks) < required_size:
        data_blocks.extend(b'\x00' * (required_size - len(data_blocks)))

    data_blocks[offset:offset+size] = data

    # -------------------------
    # Dernier bloc valide
    # -------------------------

    der = size % BLOCK_SIZE
    if der == 0:
        der = 256

    # -------------------------
    # Entrée directoire
    # -------------------------

    entry = bytearray(24)

    name, ext = nomFi.split(".")
    entry[0:8] = name.ljust(8)[:8].encode("ascii")
    entry[8:10] = ext.ljust(2)[:2].encode("ascii")

    entry[10:12] = begin.to_bytes(2, "little")
    entry[12:14] = end.to_bytes(2, "little")

    entry[16] = der if der < 256 else 0

    load = info.get("load", 0)
    go = info.get("go", 0)

    entry[17:19] = load.to_bytes(2, "little")
    entry[19:21] = go.to_bytes(2, "little")

    date_bytes = encode_date(info.get("date"))
    entry[21:24] = date_bytes

    directory[index*24:(index+1)*24] = entry

# -------------------------
# Construction image finale
# -------------------------

disk_size = current_block * BLOCK_SIZE
dsk = bytearray(disk_size)

# Données
dsk[0:len(data_blocks)] = data_blocks

# Directoire
dsk[0:32*24] = directory

# -------------------------
# Sauvegarde
# -------------------------

with open(output_file, "wb") as f:
    f.write(dsk)

print("\nImage créée :", output_file)
print("Taille :", disk_size, "octets")
