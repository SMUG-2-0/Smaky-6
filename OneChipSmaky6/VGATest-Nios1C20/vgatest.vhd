-- ---------------------------------------------------------------------------
-- vgatest.vhd — Mire VGA 640x480@60 (pixel clock 25 MHz = 50/2) pour valider
-- le raccord VGA de la carte Nios. Sortie 1 bit (monochrome) : bordure + grille
-- tous les 32 px. HSYNC/VSYNC actifs bas.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity vgatest is
    port (
        clk   : in  std_logic;        -- 50 MHz (PIN_K5)
        video : out std_logic;        -- PIN_C19 (J11 pin 4)
        hsync : out std_logic;        -- PIN_D20 (J11 pin 8) -- inversé côté câble
        vsync : out std_logic         -- PIN_D19 (J11 pin 6)
    );
end entity;

architecture rtl of vgatest is
    signal pix : std_logic := '0';                       -- enable pixel (25 MHz)
    signal hc  : unsigned(9 downto 0) := (others => '0'); -- 0..799
    signal vc  : unsigned(9 downto 0) := (others => '0'); -- 0..524
begin
    process(clk)
    begin
        if rising_edge(clk) then
            pix <= not pix;
            if pix = '1' then                            -- 1 pixel tous les 2 cycles
                -- compteurs de balayage
                if hc = 799 then
                    hc <= (others => '0');
                    if vc = 524 then vc <= (others => '0'); else vc <= vc + 1; end if;
                else
                    hc <= hc + 1;
                end if;

                -- synchros (actives bas)
                if hc >= 656 and hc < 752 then hsync <= '0'; else hsync <= '1'; end if;
                if vc >= 490 and vc < 492 then vsync <= '0'; else vsync <= '1'; end if;

                -- mire : actif uniquement dans 640x480, bordure + grille /32
                if hc < 640 and vc < 480 and
                   (hc < 2 or hc > 637 or vc < 2 or vc > 477
                    or hc(4 downto 0) = "00000" or vc(4 downto 0) = "00000") then
                    video <= '1';
                else
                    video <= '0';
                end if;
            end if;
        end if;
    end process;
end architecture;
