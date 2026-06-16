-- ---------------------------------------------------------------------------
-- vram.vhd — RAM vidéo double-port (2 Ko), zone écran Smaky 0x4000-0x47FF.
--   Port A : lecture/écriture CPU (Z80).
--   Port B : lecture seule par le contrôleur VGA.
-- Sorties registrées (1 cycle de latence) -> infère un bloc-RAM M4K.
-- Initialisée à 0x20 (espace) pour un écran blanc avant que le boot l'efface.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity vram is
    port (
        clk    : in  std_logic;
        -- port A : CPU
        addr_a : in  std_logic_vector(10 downto 0);
        din_a  : in  std_logic_vector(7 downto 0);
        we_a   : in  std_logic;
        dout_a : out std_logic_vector(7 downto 0);
        -- port B : VGA (lecture)
        addr_b : in  std_logic_vector(10 downto 0);
        dout_b : out std_logic_vector(7 downto 0)
    );
end entity;

architecture rtl of vram is
    type ram_t is array(0 to 2047) of std_logic_vector(7 downto 0);
    signal ram : ram_t := (others => x"20");
begin
    process(clk)
    begin
        if rising_edge(clk) then
            if we_a = '1' then
                ram(to_integer(unsigned(addr_a))) <= din_a;
            end if;
            dout_a <= ram(to_integer(unsigned(addr_a)));
            dout_b <= ram(to_integer(unsigned(addr_b)));
        end if;
    end process;
end architecture;
