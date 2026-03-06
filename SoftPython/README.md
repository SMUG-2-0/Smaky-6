# Extraction et génération d'images de disques Smaky 6

Les rares disquettes Smaky 6 retrouvées ces dernières années sont précieuses : nous cherchons à les sécuriser pour les générations futures.
Le programme Python extract-smaky6-di.py permet d'extraire les fichiers d'une image. 
Il produit en outre un fichier .json qui contient les entrées du directoire Samos, telles que le bloc de début du fichier, 
sa taille en bloc, le nombre d'octet valides du dernier bloc, les adresses de chargement et d'exécution pour les exécutables,
la date de création, ainsi que les attributs.

Le fichier .json peut être également utilisé pour re-générer une image. Il est ainsi possible de créer de nouvelles images,
particulièrement utile lorsque l'émulateur est utilisé. ( [Voir](../Emulateur-WD1002/) ).

Usage du programme extract-smaky6-di.py :
```bash
python extract-smaky-di.py nom_de_l_image.dsk 
```
Un dossier est créé avec le nom de l'image, qui va contenir les fichiers extraits de l'image.
Un fichier .json est aussi créé, qui contient les données suivantes :
- nom du fichier (maximum 8 lettres)
- entension du fichier (maximum 2 lettres)
- bloc de début (les blocs ont 256 caractères)
- bloc de fin
- nombre d'octets valides dans le dernier bloc
- attribut du fichier
- date de création
