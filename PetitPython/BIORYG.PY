# BIORYG.PY - Biorythme graphique (adapte du BASIC Smaky 6, 1982)
# Trace les trois cycles (physique 23 j, emotif 28 j, intellect 33 j)
# sur ~32 jours centres sur la date du calcul.
#
cls()
print("B I O R Y T H M E")
print()
print("Date de naissance")
print("Jour:")
jn = input()
print("Mois:")
mn = input()
print("Annee:")
an = input()
if an < 100:
    an = an + 1900
print()
print("Date du calcul")
print("Jour:")
jc = input()
print("Mois:")
mc = input()
print("Annee:")
ac = input()
if ac < 100:
    ac = ac + 1900

# Numero de jour (flottant) de chaque date
if mn < 3:
    xb = 365.0*an + jn + 31.0*(mn-1) + int((an-1)/4.0) - int(0.75 * (int((an-1)/100.0) + 1.0))
else:
    xb = 365.0*an + jn + 31.0*(mn-1) - int(0.4*mn + 2.3) + int(an/4.0) - int(0.75 * (int(an/100.0) + 1.0))
if mc < 3:
    xc = 365.0*ac + jc + 31.0*(mc-1) + int((ac-1)/4.0) - int(0.75 * (int((ac-1)/100.0) + 1.0))
else:
    xc = 365.0*ac + jc + 31.0*(mc-1) - int(0.4*mc + 2.3) + int(ac/4.0) - int(0.75 * (int(ac/100.0) + 1.0))
z = xc - xb

# Un seul trait disponible : on trace les courbes une a une, chacune
# avec son nom (la legende s'empile), en attendant une touche entre
# chaque. On n'efface pas -> les trois se superposent, comme sur un
# vrai biorythme. Periode = 23, 28, 33 jours selon le cycle.
graph()
cls()                            # efface les prompts de saisie
gcls()                           # efface le plan graphique (une seule fois)
line(0, 63, 248, 63, 1)          # axe horizontal (cycle = 0)
line(128, 15, 128, 111, 1)       # marqueur de la date du calcul
for c in range(3):
    per = 23 + 5 * c             # 23, 28 ou 33 jours
    if c == 0:
        print("Physique  (23 jours)")
    elif c == 1:
        print("Emotif    (28 jours)")
    else:
        print("Intellect (33 jours)")
    for i in range(32):
        x = i * 8
        d = z - 16.0 + i
        y = 63 - int(sin(frac(d / per) * 2.0 * pi()) * 43.0)
        if i > 0:
            line(ox, oy, x, y, 1)
        ox = x
        oy = y
    getkey()
text()
