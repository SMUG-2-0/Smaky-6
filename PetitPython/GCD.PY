# PGCD par algorithme d'Euclide
# Resultat attendu : 12
a = 48
b = 36
while b != 0:
    r = a % b
    a = b
    b = r
print(a)
