# -*- coding: utf8 -*-

# 2025, Epsitec SA, Pierre-Yves Rochat, pyr@pyr.ch
# - Lecture des fichiers d'une disquette Smaky 6
# - Copie avec le programme DUMPSM6.SR
#   avec l'interface Simser-USB (Arduino Mini)
# - Création d'un dossier avec les fichiers
#
# 16/06/2025 : nom du fichier sur ligne de commande
# 11/11/2025 : patch du SYS.SY pour disque dur (pour émulateur WD1002)
# 26/11/2025 : création fichier .json (avec adresse load and go)
#              création d'un source en C

import os
import sys
import json

LG_MAX = 1024*250

print ("Extraction des fichiers d'une copie de disque Smaky 6")
print ("2025, Epsitec SA, Pierre-Yves Rochat, pyr@pyr.ch")
print ("Version du 26/11/2025")
print ("python extract-smaky6-di.py nom_image_disque [nom_nouvelle_image] [SYSWIN.SY pour remplacement]")
print ("\nLigne de commande :", sys.argv)

file = sys.argv[1] # nom du fichier de la copie du disque Smaky 6
if file.find(".")<0 : file += ".DI6"

dir = file.split(".")[0] # création d'un dossier qui contiendra les fichiers
if not os.path.exists(dir):
    os.makedirs(dir)

with open(file, "rb") as f: # lecture du disque
    dsk = bytearray(f.read())
print("Longueur de l'image", len(dsk))

sysExist = False
fichiers = {}
index = 0
lastFin = 0
coupeApres = "BASIC.DR"
coupe = False
for idFi in range(32): # parcours
    if dsk[idFi*24] != 0:
        fi = dsk[idFi*24:(idFi*24)+24] # entrée du directoire
        
        nom = fi[0:8].decode("utf8").strip() # nom du fichier (8 car. max)
        ext = fi[8:8+2].decode("utf8").strip() # extension (2 car. max)
        nomFi = (nom+"."+ext)
        deb = int.from_bytes(fi[10:10+2], byteorder='little') # bloc de début
        fin = int.from_bytes(fi[12:12+2], byteorder='little') # bloc de fin
        der = int.from_bytes(fi[16:16+1]) # taille valide du dernier bloc
        load = int.from_bytes(fi[17:17+2], byteorder='little') # adresse de chargement
        start = int.from_bytes(fi[19:19+2], byteorder='little') # adresse d'exécution
        
        print(nomFi, " bloc de début :", deb, " bloc de fin:", fin, " dernier bloc:", der, \
             " load:", oct(load), " start:", oct(start))
        with open(os.path.join(dir, nomFi), "wb") as f:
            if der==0 : der = 256
            f.write(dsk[(deb*256):((fin-1)*256)+der])
            f.close()
        info = {"index": index, "begin": deb, "end": fin, "load": load, "go": start}
        fichiers[nomFi] = info
        index += 1

        if nomFi.find("SYS.SY")==0:
            print("Fichier SYS.SY trouvé !")
            sysExist = True
            debSys = deb
            finSys = fin
            derSys = der
            loadSys = load
            startSys = start
        if nomFi.find(coupeApres)==0:
            print("Dernier fichier trouvé !")
            coupe = True
        if coupe :
            dsk[idFi*24:(idFi*24)+24] = b"\x00" * 24 # efface l'entrée du fichier
        else :
            if lastFin<fin : lastFin = fin
            
            
    # sauvegarde de la structure :
with open(os.path.join(dir, 'index.json'), 'w') as f:
    json.dump(fichiers, f, indent=4)
    f.close
    
print("Dernier bloc utile du disque :", lastFin, "taille : ", lastFin*256)

# Substitution du fichier SYS.SY par un
if sysExist:
    print("SYS.SY : ", debSys, " -> ", finSys)

if len(sys.argv)>3:
    winDi = sys.argv[2]
    winSys = sys.argv[3]
    print("Création d'une image pour disque dur : ", winDi, "à partir de ", winSys)
    
    with open(winSys, "rb") as f:
        sysSy = f.read()
        f.close()
    
    # print("Longueur du .DI6 : ", len(dsk) )
    print("Longueur du .DI6 : ", lastFin*256 )
    print("Début : bloc ", debSys)
    print("longueur SYS.SY : ", len(sysSy) , " = ", len(sysSy)/256, " blocs")
    print("Récriture du solde dès : ", finSys, " blocs")
    
    with open(winDi, "wb") as f:
        f.write(dsk[:debSys*256]); print(debSys*256 )
        f.write(sysSy); print(len(sysSy))
        # f.write(dsk[finSys*256:LG_MAX])
        f.write(dsk[finSys*256:lastFin*256])
        print( len(dsk)-(finSys*256) )
        f.close
    

