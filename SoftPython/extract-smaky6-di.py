# -*- coding: utf8 -*-

# 2025-2026, Epsitec SA, Pierre-Yves Rochat, pyr@pyr.ch
# - Lecture des fichiers d'une disquette Smaky 6
# - Copie possible avec le programme DUMPSM6.SR
#   à travers l'interface Simser-USB (Arduino Mini)
# - Création d'un dossier avec les fichiers
# - Création d'un fichier .json avec les entrées du directoire
#
# 16/06/2025 : nom du fichier sur ligne de commande
# 11/11/2025 : patch du SYS.SY pour disque dur (pour émulateur WD1002)
# 26/11/2025 : création fichier .json (avec adresse load and go)
#
# Le programme build-smaky6-di.py permet de créer une image,
# à partir des fichiers décrits dans un fichier .json

import os
import sys
import json

print ("Extraction des fichiers d'une copie de disque Smaky 6")
print ("2025, Epsitec SA, Pierre-Yves Rochat, pyr@pyr.ch")
print ("Version du 26/11/2025")
print ("python extract-smaky6-di.py nom_image_disque [nom_nouvelle_image] [SYSWIN.SY pour remplacement]")
print ("\nLigne de commande :", sys.argv)

file = sys.argv[1] # nom du fichier de la copie du disque Smaky 6
if file.find(".")<0 : file += ".dsk"

dir = file.split(".")[0] # création d'un dossier qui contiendra les fichiers
if not os.path.exists(dir):
    os.makedirs(dir)

with open(file, "rb") as f: # lecture du disque
    dsk = bytearray(f.read())
print("Longueur de l'image", len(dsk))

sysExist = False
fichiers = {} # dictionnaire des entrées du directoire
index = 0
lastFin = 0
coupe = False
for idFi in range(32): # parcours les entrées du directoire
    if dsk[idFi*24] != 0:
        fi = dsk[idFi*24:(idFi*24)+24] # entrée du directoire
        
        nom = fi[0:8].decode("utf8").strip() # nom du fichier (8 car. max)
        ext = fi[8:8+2].decode("utf8").strip() # extension (2 car. max)
        nomFi = (nom+"."+ext)
        deb = int.from_bytes(fi[10:10+2], byteorder='little') # bloc de début
        fin = int.from_bytes(fi[12:12+2], byteorder='little') # bloc de fin
        attr = fi[14]
        attrib = "".join(l if attr & (1<<b) else "-" for b,l in [(0,'W'),(1,'R'),(2,'P'),(3,'C'),(4,'O')])
        der = int.from_bytes(fi[16:16+1]) # taille valide du dernier bloc
        load = int.from_bytes(fi[17:17+2], byteorder='little') # adresse de chargement
        start = int.from_bytes(fi[19:19+2], byteorder='little') # adresse d'exécution
        date = f"{fi[21]:02X}.{fi[22]:02X}.{fi[23]:02X}"
        
        print(nomFi, " bloc de début :", deb, " bloc de fin:", fin, " dernier bloc:", der, \
             " load:", oct(load), " start:", oct(start))
        with open(os.path.join(dir, nomFi), "wb") as f:
            if der==0 : der = 256
            f.write(dsk[(deb*256):((fin-1)*256)+der])
            f.close()
        info = {"INDEX": index, "BEGIN": deb, "END": fin, "ATTRIB": attrib, "LOAD": load, "GO": start, "DATE": date}
        fichiers[nomFi] = info
        index += 1
        if lastFin<fin : lastFin = fin
            
            
# sauvegarde de la structure :
with open(os.path.join(dir, 'index.json'), 'w') as f:
    json.dump(fichiers, f, indent=4)
    f.close
    
print("Dernier bloc utile du disque :", lastFin, "taille : ", lastFin*256)


