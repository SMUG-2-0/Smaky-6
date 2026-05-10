ECHO OFF
CLS
ECHO ==============================================================
ECHO Impression de la documentation compläte pour l'assembleur CALM
ECHO ==============================================================
ECHO Enclencher l'imprimante et initialiser l'imprimante comme suit:
ECHO 10cpi, 6lpi, gÇnÇrateur de caractäre IBM, chasse de caractäre fixe.
ECHO Tous les textes ont au maximum 66 lignes/page et 75 caractäres/ligne.
ECHO Appuyer sur Ctrl-C s'il ne faut pas imprimer!
PAUSE Appuyer sur une touche si pràt
ECHO Imprime INDEXBIN
COPY INDEXBIN.DOQ PRN:
ECHO Imprime ASCALM
COPY ASCALM.DOQ PRN:
ECHO Imprime CALMDEF
COPY CALMDEF.DOQ PRN:
ECHO Imprime CALMINS
COPY CALMINS.DOQ PRN:
ECHO Imprime CALMPSEU
COPY CALMPSEU.DOQ PRN:
ECHO Imprime CALMMACR
COPY CALMMACR.DOQ PRN:
ECHO Imprime CALMREST
COPY CALMREST.DOQ PRN:
ECHO Fin
