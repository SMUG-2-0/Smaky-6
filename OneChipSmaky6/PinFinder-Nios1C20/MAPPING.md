# PinFinder — table groupe/LED -> broche FPGA

Sélection du groupe par les poussoirs (actifs bas) :

- Groupe 0 : poussoirs **(rien)**
- Groupe 1 : poussoirs **SW1**
- Groupe 2 : poussoirs **SW2**
- Groupe 3 : poussoirs **SW1+SW2**
- Groupe 4 : poussoirs **SW3**
- Groupe 5 : poussoirs **SW3+SW1**
- Groupe 6 : poussoirs **SW3+SW2**
- Groupe 7 : poussoirs **SW3+SW2+SW1**

| Grp | LED D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---|---|---|---|---|---|---|---|
| **0** | C18 | C19 | D18 | D19 | D17 | D20 | E17 | F17 |
| **1** | F18 | E18 | E19 | F16 | F15 | F19 | F20 | G16 |
| **2** | G15 | G20 | G19 | G14 | H15 | G18 | G17 | H16 |
| **3** | H18 | H17 | H19 | H20 | J16 | J15 | J19 | J20 |
| **4** | T15 | W15 | Y15 | U15 | V15 | V14 | U14 | Y14 |
| **5** | W14 | T14 | R14 | V13 | U13 | W13 | Y13 | R13 |
| **6** | T13 | V12 | U12 | T12 | T11 | W12 | Y12 | W8 |
| **7** | Y8 | U9 | V9 | T9 | R9 | Y9 | W9 | T10 |

(LED Dn allumée = la broche du header sondée correspond à la broche FPGA ci-dessus.)
