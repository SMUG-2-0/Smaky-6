# FORBC.PY - test break et continue dans for/range
# break a 5 : affiche 0, 1, 2, 3, 4
for n in range(10):
    if n == 5:
        break
    print(n)

# continue sur les impairs : affiche 0, 2, 4, 6, 8
for n in range(10):
    if n % 2 == 1:
        continue
    print(n)
