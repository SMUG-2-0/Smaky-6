ECHO OFF
CLS
ECHO =========================================================
ECHO Impression de la documentation pour le d‚sassembleur CALM
ECHO =========================================================
ECHO Enclencher l'imprimante et initialiser l'imprimante comme suit:
ECHO 10cpi, 6lpi, g‚n‚rateur de caractŠre IBM, chasse de caractŠre fixe.
ECHO Tous les textes ont au maximum 66 lignes/page et 75 caractŠres/ligne.
ECHO Appuyer sur Ctrl-C s'il ne faut pas imprimer!
PAUSE Appuyer sur une touche si prˆt
ECHO Imprime CALMDIS
COPY CALMDIS.DOQ PRN:
ECHO Fin
