# Fibonacci recursif - test des fonctions v0.2
# Attendu : 55, 610, 6765
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(10))
print(fib(15))
print(fib(20))
