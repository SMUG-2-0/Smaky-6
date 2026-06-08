# Premiers 20 nombres de Fibonacci
a = 0
b = 1
n = 0
while n < 20:
    print(a)
    c = a + b
    a = b
    b = c
    n = n + 1
