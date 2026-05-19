# INPUT2.PY - lit N puis N entiers, affiche leur somme et leur moyenne
# Tape d'abord le nombre d'entiers, puis chaque entier suivi de CR
n = input()
s = 0
for k in range(n):
    x = input()
    s = s + x
print(s)
print(s / n)
