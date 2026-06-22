# FORPRI.PY - nombres premiers de 2 a 99 par division d'essai
# Variante de PRIME.PY ecrite avec des boucles for/range.
# Note : on n'ecrit pas dans la variable de boucle, sinon
# l'increment automatique partirait d'une valeur modifiee.
for k in range(98):
    n = k + 2
    p = 1
    for j in range(n - 2):
        d = j + 2
        if n % d == 0:
            p = 0
    if p == 1:
        print(n)
