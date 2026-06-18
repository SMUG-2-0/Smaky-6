-- ---------------------------------------------------------------------------
-- gvram.vhd — RAM vidéo GRAPHIQUE double-port (4 Ko), zone Smaky 0x4600-0x54FF.
--   Port A : écriture CPU (snoop des écritures Z80 dans la zone graphique).
--   Port B : lecture seule par le contrôleur VGA (chaîne graphique).
-- Sorties registrées (1 cycle de latence) -> infère un bloc-RAM M4K.
-- Initialisée à 0x00 (écran graphique éteint au démarrage).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity gvram is
    port (
        clk    : in  std_logic;
        -- port A : CPU (écriture seule)
        addr_a : in  std_logic_vector(11 downto 0);
        din_a  : in  std_logic_vector(7 downto 0);
        we_a   : in  std_logic;
        -- port B : VGA (lecture)
        addr_b : in  std_logic_vector(11 downto 0);
        dout_b : out std_logic_vector(7 downto 0)
    );
end entity;

architecture rtl of gvram is
    type ram_t is array(0 to 4095) of std_logic_vector(7 downto 0);
    signal ram : ram_t := (others => x"00");
begin
    process(clk)
    begin
        if rising_edge(clk) then
            if we_a = '1' then
                ram(to_integer(unsigned(addr_a))) <= din_a;
            end if;
            dout_b <= ram(to_integer(unsigned(addr_b)));
        end if;
    end process;
end architecture;
