# Diagnostic : intercaler des print autour de def et de l'appel
# Lecture du resultat :
#   rien            -> bug parser/JMP-over (def corrompt la suite)
#   11              -> def parse OK, mais JMP-over patche mal
#   11 22           -> JMP-over OK, mais CALL/RETN/FRAME plante
#   11 22 42        -> CALL+RETN OK, mais retour mal place
#   11 22 42 33     -> tout marche (improbable)
print(11)
def f():
    return 42

print(22)
print(f())
print(33)
