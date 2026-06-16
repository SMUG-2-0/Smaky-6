-- ---------------------------------------------------------------------------
-- sdram_pll.vhd — PLL d'horloge pour SDRAM (Cyclone I, entrée 50 MHz).
--   c0 = 50 MHz, phase 0   -> horloge système (logique + contrôleur SDRAM)
--   c1 = 50 MHz, phase -3ns -> horloge du chip SDRAM (broche, ex. L13)
-- Le décalage -3 ns compense les retards d'I/O + piste pour que les données
-- relues soient échantillonnées de façon fiable (indépendant du placement,
-- contrairement à un « not clk » combinatoire).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
library altera_mf;
use altera_mf.altera_mf_components.all;

entity sdram_pll is
    port (
        inclk0 : in  std_logic;
        c0     : out std_logic;
        c1     : out std_logic;
        locked : out std_logic
    );
end entity;

architecture rtl of sdram_pll is
    signal clk_bus : std_logic_vector(2 downto 0);
begin
    u : altpll
        generic map (
            intended_device_family => "Cyclone",
            operation_mode         => "NORMAL",
            inclk0_input_frequency => 20000,        -- 50 MHz (période 20000 ps)
            width_clock            => 3,            -- PLL Cyclone : 3 sorties clk[2:0]
            clk0_multiply_by => 1, clk0_divide_by => 1, clk0_phase_shift => "0",
            clk1_multiply_by => 1, clk1_divide_by => 1, clk1_phase_shift => "-3000"
        )
        port map (
            inclk(0) => inclk0,
            inclk(1) => '0',
            clk      => clk_bus,
            locked   => locked
        );
    c0 <= clk_bus(0);
    c1 <= clk_bus(1);
end architecture;
