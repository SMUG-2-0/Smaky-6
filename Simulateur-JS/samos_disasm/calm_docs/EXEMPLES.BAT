ECHO OFF
CLS
ECHO ============================
ECHO Impression des exemples CALM
ECHO ============================
ECHO Enclencher l'imprimante et initialiser l'imprimante comme suit:
ECHO 10cpi, 6lpi, gÇnÇrateur de caractäre IBM, chasse de caractäre fixe.
ECHO Tous les textes ont au maximum 66 lignes/page et 75 caractäres/ligne.
ECHO Appuyer sur Ctrl-C s'il ne faut pas imprimer!
PAUSE Appuyer sur une touche si pràt
ECHO Imprime EXEMPLES
COPY EXAMPLES.DOQ PRN:
ECHO Imprime CALMPROD
COPY CALMPROD.DOQ PRN:
ECHO Fin
