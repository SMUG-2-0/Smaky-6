# Extraction et génération d'images de disques Smaky 6

Les rares disquettes Smaky 6 retrouvées ces dernières années sont précieuses : nous cherchons à les sécuriser pour les générations futures.
Le programme Python extract-smaky6-di.py permet d'extraire les fichiers d'une image. 
Il produit en outre un fichier .json qui contient les entrées du directoire Samos, telles que le bloc de début du fichier, 
sa taille en bloc, le nombre d'octet valides du dernier bloc, les adresses de chargement et d'exécution pour les exécutables,
la date de création, ainsi que les attributs.

Le fichier .json peut être également utilisé pour générer une nouvelle image. Il est ainsi possible de créer de nouvelles images,
particulièrement utile lorsque l'émulateur est utilisé. ( [Voir](../Emulateur-WD1002/) ).


