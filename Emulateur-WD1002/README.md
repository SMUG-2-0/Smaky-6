# Emulateur de contrôleur de disque dur pour Smaky 6

Les disques durs datant du début des années 1980 sont rares à fonctionner encore actuellement.
Même les lecteurs de disquettes Micropolis des Smaky 6 fonctionnent souvent très mal après plus de 40 ans.
Par contre, les Smaky 6 eux-même fonctionnent souvent encore très bien, surtout lorsqu'on prend la peine de leur mettre des alimentations plus modernes.

Il nous a donc semblé utile de concevoir une émulateur du contrôleur original de disque dur des Smaky 6, le contrôleurs WD1000, WD1001 et WD1002. 
Ces contrôleurs sont bien documentés :

[Documentation du WD1002](http://www.bitsavers.org/pdf/westernDigital/WD100x/61-031050-0030_WD1002-05_HDO_OEM_Manual_Jul83.pdf)

Le circuit utilise un microcontrôleur **STM32**, cadençé à une fréquence suffisante (180 MHz) pour pouvoir répondre aux requêtes du Z80.
Branché sur le connecteur **MUBUS-26**, au bord droit de la carte mêre du Smaky 6, il possède un socle pour une carte micr-SD, qui contient des images de disques ou disquettes Smaky 6.
