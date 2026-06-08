# Les 10 premiers nombres premiers
# Exerce : nested while, %, break, multiplication
n = 2
count = 0
while count < 10:
    d = 2
    isprime = 1
    while d * d <= n:
        if n % d == 0:
            isprime = 0
            break
        d = d + 1
    if isprime:
        print(n)
        count = count + 1
    n = n + 1
