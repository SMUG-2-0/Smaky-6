library ieee;
use ieee.std_logic_1164.all;

-- Testbench SM6FPGA
-- Delai raccourci : OUTER=2, INNER=5  ->  un cycle LED complet en ~700 periodes
-- Simulation recommandee : 200 us (voir plusieurs cycles)
--
-- Signaux a observer dans ModelSim :
--   /sm6fpga_tb/dut/led1          -- sortie LED
--   /sm6fpga_tb/dut/cpu_a         -- bus adresse Z80
--   /sm6fpga_tb/dut/cpu_do        -- bus donnees (ecriture CPU)
--   /sm6fpga_tb/dut/cpu_iorq_n    -- cycle I/O
--   /sm6fpga_tb/dut/cpu_wr_n      -- ecriture
--   /sm6fpga_tb/dut/cpu_mreq_n    -- acces memoire
--   /sm6fpga_tb/dut/cpu_rd_n      -- lecture

entity SM6FPGA_tb is
end entity;

architecture sim of SM6FPGA_tb is

    signal clk     : std_logic := '0';
    signal reset_n : std_logic := '0';
    signal led1    : std_logic;

    -- Horloge 21.47727 MHz -> demi-periode = 23.28 ns
    constant T_CLK : time := 23.28 ns;

begin

    -- Generation horloge
    clk <= not clk after T_CLK;

    -- Reset : actif bas pendant 10 periodes puis relache
    process
    begin
        reset_n <= '0';
        wait for T_CLK * 20;
        reset_n <= '1';
        wait;
    end process;

    -- DUT : delais courts pour simulation
    dut : entity work.SM6FPGA
        generic map (
            ROM_OUTER => x"02",   -- 2 iterations externes (au lieu de 8)
            ROM_INNER => x"0005"  -- BC=5 (au lieu de 65535)
        )
        port map (
            clk     => clk,
            reset_n => reset_n,
            led1    => led1
        );

end architecture;
