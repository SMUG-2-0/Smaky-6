# BIORY.PY - Biorythme (adapte du BASIC Smaky 6, EPSITEC 1982)
# Trois cycles : physique (23 j), emotif (28 j), intellect (33 j).
#
# Les numeros de jour (365 * annee) depassent 32767, donc le calcul
# se fait en virgule flottante. Tout est en variables globales
# (comme le BASIC d'origine) : les flottants ne sont pas encore
# admis en variable locale ou parametre de fonction.

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

# Numero de jour de la date de naissance (en flottant)
if mn < 3:
    xb = 365.0*an + jn + 31.0*(mn-1) + int((an-1)/4.0) - int(0.75 * (int((an-1)/100.0) + 1.0))
else:
    xb = 365.0*an + jn + 31.0*(mn-1) - int(0.4*mn + 2.3) + int(an/4.0) - int(0.75 * (int(an/100.0) + 1.0))

# Numero de jour de la date du calcul (en flottant)
if mc < 3:
    xc = 365.0*ac + jc + 31.0*(mc-1) + int((ac-1)/4.0) - int(0.75 * (int((ac-1)/100.0) + 1.0))
else:
    xc = 365.0*ac + jc + 31.0*(mc-1) - int(0.4*mc + 2.3) + int(ac/4.0) - int(0.75 * (int(ac/100.0) + 1.0))

# Nombre de jours vecus
z = xc - xb
print()
print("Jours vecus:", int(z))
print()

# Valeur de chaque cycle (sinus -1..+1), affichee en pourcentage
vp = sin(frac(z / 23.0) * 2.0 * pi())
ve = sin(frac(z / 28.0) * 2.0 * pi())
vi = sin(frac(z / 33.0) * 2.0 * pi())
print("Physique :", int(vp * 100.0))
print("Emotif   :", int(ve * 100.0))
print("Intellect:", int(vi * 100.0))

# Moyenne du jour (comme le BASIC : moyenne des trois cycles)
moy = (vp + ve + vi) / 3.0
print("Moyenne  :", int(moy * 100.0))
