library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

-- Programme Z80 : clignote la LED sur le port I/O 0x20 (bit 0)
--
-- ORG 0x0000
-- start:  LD A, 0x01        ; 3E 01
--         OUT (0x20), A     ; D3 20   - LED on
--         LD D, OUTER       ; 16 xx   - compteur externe (generic)
-- dly1:   LD BC, INNER      ; 01 lo hi
-- lp1:    DEC BC            ; 0B
--         LD A, B           ; 78
--         OR C              ; B1
--         JP NZ, lp1        ; C2 09 00
--         DEC D             ; 15
--         JP NZ, dly1       ; C2 06 00
--         LD A, 0x00        ; 3E 00
--         OUT (0x20), A     ; D3 20   - LED off
--         LD D, OUTER       ; 16 xx
-- dly2:   LD BC, INNER      ; 01 lo hi
-- lp2:    DEC BC            ; 0B
--         LD A, B           ; 78
--         OR C              ; B1
--         JP NZ, lp2        ; C2 1C 00
--         DEC D             ; 15
--         JP NZ, dly2       ; C2 19 00
--         JP start          ; C3 00 00
--
-- Synthese  : OUTER=x"08", INNER=x"FFFF" -> ~0.85 Hz a 21.47 MHz
-- Simulation: OUTER=x"02", INNER=x"0005" -> cycle visible en ~700 periodes d'horloge

entity ROM is
    generic (
        OUTER : std_logic_vector(7  downto 0)  := x"08";
        INNER : std_logic_vector(15 downto 0)  := x"FFFF"
    );
    port (
        addr : in  std_logic_vector(7 downto 0);
        data : out std_logic_vector(7 downto 0)
    );
end entity;

architecture rtl of ROM is
    type rom_t is array (0 to 255) of std_logic_vector(7 downto 0);

    function init_rom(outer_cnt : std_logic_vector(7 downto 0);
                      inner_cnt : std_logic_vector(15 downto 0)) return rom_t is
        variable r   : rom_t := (others => x"FF");
        variable iLo : std_logic_vector(7 downto 0) := inner_cnt(7  downto 0);
        variable iHi : std_logic_vector(7 downto 0) := inner_cnt(15 downto 8);
    begin
        -- 0x00 : LD A, 0x01
        r(0)  := x"3E"; r(1)  := x"01";
        -- 0x02 : OUT (0x20), A
        r(2)  := x"D3"; r(3)  := x"20";
        -- 0x04 : LD D, OUTER
        r(4)  := x"16"; r(5)  := outer_cnt;
        -- 0x06 : LD BC, INNER
        r(6)  := x"01"; r(7)  := iLo; r(8) := iHi;
        -- 0x09 : DEC BC
        r(9)  := x"0B";
        -- 0x0A : LD A, B
        r(10) := x"78";
        -- 0x0B : OR C
        r(11) := x"B1";
        -- 0x0C : JP NZ, 0x0009
        r(12) := x"C2"; r(13) := x"09"; r(14) := x"00";
        -- 0x0F : DEC D
        r(15) := x"15";
        -- 0x10 : JP NZ, 0x0006
        r(16) := x"C2"; r(17) := x"06"; r(18) := x"00";
        -- 0x13 : LD A, 0x00
        r(19) := x"3E"; r(20) := x"00";
        -- 0x15 : OUT (0x20), A
        r(21) := x"D3"; r(22) := x"20";
        -- 0x17 : LD D, OUTER
        r(23) := x"16"; r(24) := outer_cnt;
        -- 0x19 : LD BC, INNER
        r(25) := x"01"; r(26) := iLo; r(27) := iHi;
        -- 0x1C : DEC BC
        r(28) := x"0B";
        -- 0x1D : LD A, B
        r(29) := x"78";
        -- 0x1E : OR C
        r(30) := x"B1";
        -- 0x1F : JP NZ, 0x001C
        r(31) := x"C2"; r(32) := x"1C"; r(33) := x"00";
        -- 0x22 : DEC D
        r(34) := x"15";
        -- 0x23 : JP NZ, 0x0019
        r(35) := x"C2"; r(36) := x"19"; r(37) := x"00";
        -- 0x26 : JP 0x0000
        r(38) := x"C3"; r(39) := x"00"; r(40) := x"00";
        return r;
    end function;

    constant MEM : rom_t := init_rom(OUTER, INNER);
begin
    data <= MEM(to_integer(unsigned(addr)));
end architecture;
