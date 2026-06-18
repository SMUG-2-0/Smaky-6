-- ---------------------------------------------------------------------------
-- top.vhd — squelette ECP5 (Colorlight 5A-75B) : blinky de validation.
--
-- Divise l'horloge 25 MHz de la carte et fait clignoter une sortie `led`
-- (à câbler au fil sur une LED + résistance, façon « fils en l'air »).
-- But : valider la chaîne Yosys -> nextpnr-ecp5 -> ecppack -> openFPGALoader.
-- Ensuite on remplace ce contenu par le cœur Smaky (T80/fx68k, SDRAM, VGA…).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity top is
    port (
        clk25 : in  std_logic;   -- oscillateur 25 MHz de la carte (broche P6)
        led   : out std_logic    -- sortie de test (HUB75 GPIO, à vérifier)
    );
end entity;

architecture rtl of top is
    signal cnt : unsigned(24 downto 0) := (others => '0');
begin
    process(clk25)
    begin
        if rising_edge(clk25) then
            cnt <= cnt + 1;
        end if;
    end process;

    led <= cnt(24);   -- ~25e6 / 2^25 ≈ 0,75 Hz
end architecture;
