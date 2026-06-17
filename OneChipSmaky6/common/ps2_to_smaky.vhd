-- ---------------------------------------------------------------------------
-- ps2_to_smaky.vhd — traduit un flux de scancodes PS/2 (Set 2) en caractères
-- ASCII 7 bits (codes attendus par le Smaky, cf. simulateur : charCodeAt&0x7F).
--
-- Gère : préfixe break 0xF0 (relâchement -> on n'émet pas, sauf MAJ des shift),
-- préfixe étendu 0xE0 (ignoré pour l'instant), touches Shift gauche/droite.
-- 'char_valid' = impulsion 1 cycle à chaque caractère "make" traduit.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity ps2_to_smaky is
    port (
        clk        : in  std_logic;
        scancode   : in  std_logic_vector(7 downto 0);
        valid      : in  std_logic;                       -- impulsion : scancode présent
        char       : out std_logic_vector(7 downto 0);    -- ASCII 7 bits
        char_valid : out std_logic
    );
end entity;

architecture rtl of ps2_to_smaky is
    -- scancode PS/2 Set 2 (make) -> code Smaky. Layout SUISSE ROMAND (QWERTZ).
    -- Lettres en minuscules (MAJ appliquée plus bas) ; accents directs = codes Smaky 0x0F-0x1D.
    function sc2char(sc : std_logic_vector(7 downto 0); sh : std_logic)
        return std_logic_vector is
        variable c : unsigned(7 downto 0) := (others => '0');
    begin
        case sc is
            -- lettres (QWERTZ : Z et Y inversés par rapport à l'US)
            when x"1C" => c := x"61"; when x"32" => c := x"62"; when x"21" => c := x"63";
            when x"23" => c := x"64"; when x"24" => c := x"65"; when x"2B" => c := x"66";
            when x"34" => c := x"67"; when x"33" => c := x"68"; when x"43" => c := x"69";
            when x"3B" => c := x"6A"; when x"42" => c := x"6B"; when x"4B" => c := x"6C";
            when x"3A" => c := x"6D"; when x"31" => c := x"6E"; when x"44" => c := x"6F";
            when x"4D" => c := x"70"; when x"15" => c := x"71"; when x"2D" => c := x"72";
            when x"1B" => c := x"73"; when x"2C" => c := x"74"; when x"3C" => c := x"75";
            when x"2A" => c := x"76"; when x"1D" => c := x"77"; when x"22" => c := x"78";
            when x"1A" => c := x"79";  -- touche US 'Z' -> 'y' (QWERTZ)
            when x"35" => c := x"7A";  -- touche US 'Y' -> 'z' (QWERTZ)
            -- touches accentuées directes (codes Smaky)
            when x"54" => if sh='1' then c := x"0F"; else c := x"13"; end if; -- è / ü
            when x"4C" => if sh='1' then c := x"1C"; else c := x"12"; end if; -- é / ö
            when x"52" => if sh='1' then c := x"1B"; else c := x"10"; end if; -- à / ä
            -- rangée des chiffres (suisse : Maj -> + " * ç % & / ( ) =)
            when x"16" => if sh='1' then c := x"2B"; else c := x"31"; end if; -- 1 +
            when x"1E" => if sh='1' then c := x"22"; else c := x"32"; end if; -- 2 "
            when x"26" => if sh='1' then c := x"2A"; else c := x"33"; end if; -- 3 *
            when x"25" => if sh='1' then c := x"1D"; else c := x"34"; end if; -- 4 ç
            when x"2E" => if sh='1' then c := x"25"; else c := x"35"; end if; -- 5 %
            when x"36" => if sh='1' then c := x"26"; else c := x"36"; end if; -- 6 &
            when x"3D" => if sh='1' then c := x"2F"; else c := x"37"; end if; -- 7 /
            when x"3E" => if sh='1' then c := x"28"; else c := x"38"; end if; -- 8 (
            when x"46" => if sh='1' then c := x"29"; else c := x"39"; end if; -- 9 )
            when x"45" => if sh='1' then c := x"3D"; else c := x"30"; end if; -- 0 =
            -- ponctuation (positions suisses)
            when x"4E" => if sh='1' then c := x"3F"; else c := x"27"; end if; -- ' ?
            when x"5D" => if sh='1' then c := x"21"; else c := x"24"; end if; -- $ £(->!)
            when x"41" => if sh='1' then c := x"3B"; else c := x"2C"; end if; -- , ;
            when x"49" => if sh='1' then c := x"3A"; else c := x"2E"; end if; -- . :
            when x"4A" => if sh='1' then c := x"5F"; else c := x"2D"; end if; -- - _
            -- touches spéciales
            when x"29" => c := x"20";   -- espace
            when x"5A" => c := x"0D";   -- Entrée (CR)
            when x"66" => c := x"08";   -- Backspace
            when x"0D" => c := x"09";   -- Tab
            when x"76" => c := x"1B";   -- Esc
            when others => c := x"00";
        end case;
        -- MAJUSCULES pour les lettres si shift
        if sh = '1' and c >= x"61" and c <= x"7A" then
            c := c - x"20";
        end if;
        return std_logic_vector(c);
    end function;

    signal break_f : std_logic := '0';   -- prochain code = relâchement
    signal ext_f   : std_logic := '0';   -- prochain code = étendu (0xE0)
    signal shift   : std_logic := '0';   -- un Shift est enfoncé
begin
    process(clk)
        variable c : std_logic_vector(7 downto 0);
    begin
        if rising_edge(clk) then
            char_valid <= '0';
            if valid = '1' then
                if scancode = x"F0" then
                    break_f <= '1';
                elsif scancode = x"E0" then
                    ext_f <= '1';
                elsif scancode = x"12" or scancode = x"59" then   -- Shift G/D
                    shift   <= not break_f;     -- make -> 1, break -> 0
                    break_f <= '0';
                    ext_f   <= '0';
                else
                    if break_f = '0' and ext_f = '0' then          -- touche "make" normale
                        c := sc2char(scancode, shift);
                        char <= c;
                        if c /= x"00" then char_valid <= '1'; end if;
                    end if;
                    break_f <= '0';
                    ext_f   <= '0';
                end if;
            end if;
        end if;
    end process;
end architecture;
