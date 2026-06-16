-- ---------------------------------------------------------------------------
-- vgatext.vhd — Affichage texte VGA 640x480@60 (test char-gen).
-- Écran 64x20 cellules de 8x16 px, centré (h:64..575, v:80..399).
-- Char-gen TMS2716 (char_rom). Pour CE test : le code caractère vient de la
-- position (row(0)&col) -> affiche tout le jeu de 128 caractères.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity vgatext is
    port (
        clk   : in  std_logic;        -- 50 MHz (K5)
        video : out std_logic;        -- C19
        hsync : out std_logic;        -- D20
        vsync : out std_logic         -- D19
    );
end entity;

architecture rtl of vgatext is
    signal pix  : std_logic := '0';
    signal hc   : unsigned(9 downto 0) := (others => '0');
    signal vc   : unsigned(9 downto 0) := (others => '0');
    signal hrel, vrel : unsigned(9 downto 0);
    signal in_text : std_logic;
    signal rom_addr : std_logic_vector(10 downto 0);
    signal font : std_logic_vector(7 downto 0);
    signal cx_d  : unsigned(2 downto 0) := (others => '0');  -- char_x retardé (latence ROM)
    signal intxt_d : std_logic := '0';
begin
    u_crom : entity work.char_rom
        port map (clk => clk, addr => rom_addr, data => font);

    hrel <= hc - 64;
    vrel <= vc - 80;
    in_text <= '1' when (hc >= 64 and hc < 576 and vc >= 80 and vc < 400) else '0';
    -- adresse char-gen : code(6:0) & char_y(3:0) ; code = row(0) & col(5:0)
    rom_addr <= vrel(4) & std_logic_vector(hrel(8 downto 3))
                & std_logic_vector(vrel(3 downto 0));

    process(clk)
    begin
        if rising_edge(clk) then
            pix <= not pix;
            if pix = '1' then
                if hc = 799 then
                    hc <= (others => '0');
                    if vc = 524 then vc <= (others => '0'); else vc <= vc + 1; end if;
                else
                    hc <= hc + 1;
                end if;
                if hc >= 656 and hc < 752 then hsync <= '0'; else hsync <= '1'; end if;
                if vc >= 490 and vc < 492 then vsync <= '0'; else vsync <= '1'; end if;

                -- aligne char_x et in_text sur la latence 1-cycle du char_rom
                cx_d    <= hrel(2 downto 0);
                intxt_d <= in_text;
                if intxt_d = '1' and font(to_integer(cx_d)) = '1' then
                    video <= '1';
                else
                    video <= '0';
                end if;
            end if;
        end if;
    end process;
end architecture;
