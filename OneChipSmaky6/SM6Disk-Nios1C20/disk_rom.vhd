-- ROM disque dur (sous-ensemble de HD0.JS, 16 Ko = 64 secteurs de 256 o).
-- Lecture seule, init depuis disk_rom.mif. Sortie registrée -> bloc-RAM M4K.
library ieee; use ieee.std_logic_1164.all; use ieee.numeric_std.all;
entity disk_rom is
    port ( clk  : in  std_logic;
           addr : in  std_logic_vector(13 downto 0);   -- 0..16383
           data : out std_logic_vector(7 downto 0) );
end entity;
architecture rtl of disk_rom is
    type rom_t is array(0 to 16383) of std_logic_vector(7 downto 0);
    signal rom : rom_t;
    attribute ram_init_file : string;
    attribute ram_init_file of rom : signal is "disk_rom.mif";
begin
    process(clk) begin
        if rising_edge(clk) then
            data <= rom(to_integer(unsigned(addr)));
        end if;
    end process;
end architecture;
