library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity blink is
    port (
        clk  : in  std_logic;  -- PIN_28, 21.47727 MHz
        led1 : out std_logic   -- PIN_43
    );
end entity;

architecture rtl of blink is
    signal counter : unsigned(23 downto 0) := (others => '0');
begin
    process(clk)
    begin
        if rising_edge(clk) then
            counter <= counter + 1;
        end if;
    end process;

    -- bit 23 : toggle toutes les 2^23 / 21.47727e6 = 0.39 s  ->  ~1.3 Hz
    led1 <= counter(23);
end architecture;
