# Ping-Pong - Petit Python v0.5
# Espace : lance la balle      CR ou END : quitter
# R / C : raquette gauche      I / M : raquette droite


def covers(top, row):
    if row < top:
        return 0
    if row > top + 3:
        return 0
    return 1


def movepad(top, col, d):
    if d < 0:
        gotoxy(top + 3, col)
        putc(32)
        top = top - 1
        gotoxy(top, col)
        putc(35)
    else:
        gotoxy(top, col)
        putc(32)
        top = top + 1
        gotoxy(top + 3, col)
        putc(35)
    return top


# ecran titre
cls()
gotoxy(3, 26)
print("PING - PONG")
gotoxy(7, 18)
print("Espace : lance la balle")
gotoxy(8, 18)
print("R / C  : raquette gauche")
gotoxy(9, 18)
print("I / M  : raquette droite")
gotoxy(10, 18)
print("CR     : quitter")
gotoxy(13, 18)
print("Presse une touche...")
getkey()
cls()

# raquettes de 4 de haut, au milieu des bords
gpad = 8
dpad = 8
n = 0
while n < 4:
    gotoxy(gpad + n, 0)
    putc(35)
    gotoxy(dpad + n, 63)
    putc(35)
    n = n + 1

# etat de la balle
live = 0
br = 0
bc = 1
dr = 1
dc = 1

# boucle de jeu  (CR = 13, END = 4)
k = 0
while k != 13 and k != 4:
    k = inkey()
    if k == 82 or k == 114:
        if gpad > 0:
            gpad = movepad(gpad, 0, -1)
    if k == 67 or k == 99:
        if gpad < 15:
            gpad = movepad(gpad, 0, 1)
    if k == 73 or k == 105:
        if dpad > 0:
            dpad = movepad(dpad, 63, -1)
    if k == 77 or k == 109:
        if dpad < 15:
            dpad = movepad(dpad, 63, 1)
    if k == 32:
        if live == 0:
            live = 1
            br = 0
            bc = 1
            dr = 1
            dc = 1
    if live == 1:
        gotoxy(br, bc)
        putc(32)
        br = br + dr
        if br < 0:
            br = 1
            dr = -dr
        if br > 18:
            br = 17
            dr = -dr
        bc = bc + dc
        if bc < 1:
            if covers(gpad, br) == 1:
                bc = 1
                dc = -dc
                beep()
            else:
                live = 0
                beep()
        if bc > 62:
            if covers(dpad, br) == 1:
                bc = 62
                dc = -dc
                beep()
            else:
                live = 0
                beep()
        if live == 1:
            gotoxy(br, bc)
            putc(79)
    delay(60)

cls()
gotoxy(10, 28)
print("Partie terminee")
