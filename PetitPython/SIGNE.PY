# Classifie les entiers de -5 a 5 : -1 (negatif), 0, 1 (positif)
# Exerce : litteral negatif, elif/else, comparaisons
n = -5
while n <= 5:
    if n < 0:
        print(n, -1)
    elif n == 0:
        print(n, 0)
    else:
        print(n, 1)
    n = n + 1
