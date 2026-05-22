# Ping-Pong graphique - Petit Python
# Espace : lance la balle      CR ou END : quitter
# R / C : raquette gauche      I / M : raquette droite


def covers(top, by):
    if by + 1 < top:
        return 0
    if by > top + 24:
        return 0
    return 1


def movepad(top, x, d):
    line(x, top, x, top + 24, 0)
    top = top + d
    line(x, top, x, top + 24, 2)
    return top


def ball(x, y, c):
    if c == 1:
        plot(x, y)
        plot(x + 1, y)
        plot(x, y + 1)
        plot(x + 1, y + 1)
    else:
        clrp(x, y)
        clrp(x + 1, y)
        clrp(x, y + 1)
        clrp(x + 1, y + 1)


# ecran titre (mode texte)
cls()
gotoxy(4, 22)
print("PING-PONG GRAPHIQUE")
gotoxy(7, 18)
print("Espace : lance la balle")
gotoxy(8, 18)
print("R / C  : raquette gauche")
gotoxy(9, 18)
print("I / M  : raquette droite")
gotoxy(11, 18)
print("CR ou END : quitter")
gotoxy(13, 18)
print("Presse une touche...")
getkey()

# passage en mode graphique
cls()
graph()
gcls()

# raquettes : lignes verticales epaisses, au milieu des bords
gpad = 48
dpad = 48
line(4, gpad, 4, gpad + 24, 2)
line(250, dpad, 250, dpad + 24, 2)

# etat de la balle
live = 0
bx = 10
by = 2
dx = 2
dy = 2

# boucle de jeu  (CR = 13, END = 4)
k = 0
while k != 13 and k != 4:
    k = inkey()
    if k == 82 or k == 114:
        if gpad > 3:
            gpad = movepad(gpad, 4, -4)
    if k == 67 or k == 99:
        if gpad < 92:
            gpad = movepad(gpad, 4, 4)
    if k == 73 or k == 105:
        if dpad > 3:
            dpad = movepad(dpad, 250, -4)
    if k == 77 or k == 109:
        if dpad < 92:
            dpad = movepad(dpad, 250, 4)
    if k == 32:
        if live == 0:
            live = 1
            bx = 10
            by = 2
            dx = 2
            dy = 2
    if live == 1:
        ball(bx, by, 0)
        by = by + dy
        if by < 0:
            by = 2
            dy = -dy
        if by > 118:
            by = 116
            dy = -dy
        bx = bx + dx
        if bx < 8:
            if covers(gpad, by) == 1:
                bx = 8
                dx = -dx
                beep()
            else:
                live = 0
                beep()
        if bx > 244:
            if covers(dpad, by) == 1:
                bx = 244
                dx = -dx
                beep()
            else:
                live = 0
                beep()
        if live == 1:
            ball(bx, by, 1)
    delay(25)

text()
cls()
gotoxy(11, 28)
print("Partie terminee")
