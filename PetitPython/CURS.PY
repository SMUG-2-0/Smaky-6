# Test de deplacement clavier
# R monte le curseur, C descend, END (code 4) quitte
cls()
x = 32
y = 10
k = 0
while k != 4:
    gotoxy(y, x)
    putc(79)
    k = getkey()
    if k == 82 or k == 114:
        y = y - 1
    if k == 67 or k == 99:
        y = y + 1
