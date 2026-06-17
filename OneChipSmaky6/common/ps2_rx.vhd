-- ---------------------------------------------------------------------------
-- ps2_rx.vhd — récepteur PS/2 (clavier -> octet de scancode).
--
-- Lignes PS/2 open-collector (le clavier tire à 0 ou relâche ; pull-up côté
-- hôte). On échantillonne DATA sur le FRONT DESCENDANT de PS2_CLK.
-- Trame de 11 bits : start(0) + 8 data (LSB d'abord) + parité(impaire) + stop(1).
--
-- 'scancode' = les 8 bits de données ; 'valid' = impulsion 1 cycle quand une
-- trame complète est reçue. Watchdog : si l'horloge reste inactive en plein
-- milieu d'une trame, on réinitialise le compteur de bits (resynchronisation).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity ps2_rx is
    port (
        clk      : in  std_logic;                     -- horloge système (50 MHz)
        ps2_clk  : in  std_logic;                      -- horloge PS/2 (du clavier)
        ps2_data : in  std_logic;                      -- donnée PS/2
        scancode : out std_logic_vector(7 downto 0);
        valid    : out std_logic                       -- 1 cycle quand octet reçu
    );
end entity;

architecture rtl of ps2_rx is
    signal clk_s   : std_logic_vector(2 downto 0) := (others => '1'); -- synchro + détection de front
    signal dat_s   : std_logic_vector(1 downto 0) := (others => '1');
    signal shifter : std_logic_vector(10 downto 0) := (others => '0');
    signal bitcnt  : integer range 0 to 10 := 0;
    signal idle    : unsigned(13 downto 0) := (others => '0');  -- cycles depuis le dernier front
begin
    process(clk)
    begin
        if rising_edge(clk) then
            clk_s <= clk_s(1 downto 0) & ps2_clk;      -- 3 étages : anti-métastable + front
            dat_s <= dat_s(0) & ps2_data;
            valid <= '0';

            if clk_s(2) = '1' and clk_s(1) = '0' then  -- front descendant de PS2_CLK
                idle <= (others => '0');
                if bitcnt = 10 then                    -- 11e front (stop) : trame complète
                    scancode <= shifter(9 downto 2);   -- d0..d7 (positionnés après 10 décalages)
                    valid    <= '1';
                    bitcnt   <= 0;
                else
                    shifter <= dat_s(1) & shifter(10 downto 1);  -- décalage à droite (LSB d'abord)
                    bitcnt  <= bitcnt + 1;
                end if;
            else
                -- watchdog : ~160 µs sans front en pleine trame -> resynchronise
                if idle = 8000 then
                    bitcnt <= 0;
                else
                    idle <= idle + 1;
                end if;
            end if;
        end if;
    end process;
end architecture;
