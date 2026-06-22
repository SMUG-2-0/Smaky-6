# Carres des nombres pairs de 1 a 20
# Exerce : continue, %, !=
n = 0
while n < 20:
    n = n + 1
    if n % 2 != 0:
        continue
    print(n, n * n)
