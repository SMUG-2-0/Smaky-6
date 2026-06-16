-- ---------------------------------------------------------------------------
-- pinfinder.vhd — Chercheur de broches d'extension (carte Nios 1C20).
--   64 broches des connecteurs prototypage en ENTRÉE + pull-up faible (~25 kΩ).
--   SW1/SW2/SW3 (actifs bas) sélectionnent 1 des 8 groupes de 8 broches.
--   LED(n) S'ALLUME quand l'entrée n du groupe est tirée à 0 (ton pull-down).
--   -> sonde une broche du header : la LED qui s'allume = (groupe, n) = broche FPGA.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity pinfinder is
    port (
        btn1  : in  std_logic;                       -- SW1 (Y4) : groupe bit0
        btn2  : in  std_logic;                       -- SW2 (V4) : groupe bit1
        btn3  : in  std_logic;                       -- SW3 (W4) : groupe bit2
        proto : in  std_logic_vector(63 downto 0);   -- broches prototypage (pull-up)
        led   : out std_logic_vector(7 downto 0)
    );
end entity;

architecture rtl of pinfinder is
    signal grp : integer range 0 to 7;
begin
    grp <= to_integer(unsigned'((not btn3) & (not btn2) & (not btn1)));
    process(grp, proto)
    begin
        for i in 0 to 7 loop
            led(i) <= not proto(grp * 8 + i);        -- allumée si entrée tirée à 0
        end loop;
    end process;
end architecture;
