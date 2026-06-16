library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity SM6FPGA is
    generic (
        ROM_OUTER : std_logic_vector(7  downto 0)  := x"08";
        ROM_INNER : std_logic_vector(15 downto 0)  := x"FFFF"
    );
    port (
        clk     : in  std_logic;   -- PIN_28 : 21.47727 MHz
        reset_n : in  std_logic;   -- PIN_153 : RESET actif bas (slot expansion)
        led1    : out std_logic    -- PIN_43  : LED de statut
    );
end entity;

architecture rtl of SM6FPGA is

    -- Signaux du Z80 (T80s)
    signal cpu_a      : std_logic_vector(15 downto 0);
    signal cpu_di     : std_logic_vector(7 downto 0);
    signal cpu_do     : std_logic_vector(7 downto 0);
    signal cpu_mreq_n : std_logic;
    signal cpu_iorq_n : std_logic;
    signal cpu_rd_n   : std_logic;
    signal cpu_wr_n   : std_logic;
    signal cpu_m1_n   : std_logic;

    -- Reset : power-on reset (4 cycles) combine avec reset_n externe
    signal por : std_logic_vector(3 downto 0) := (others => '0');
    signal cpu_reset_n : std_logic;

    -- Sortie ROM
    signal rom_data : std_logic_vector(7 downto 0);

    -- Registre LED (port I/O 0x20, bit 0)
    signal led_reg : std_logic := '0';

begin

    -- Power-on reset : maintient RESET bas pendant 16 cycles apres la mise sous tension
    process(clk)
    begin
        if rising_edge(clk) then
            por <= por(2 downto 0) & '1';
        end if;
    end process;
    cpu_reset_n <= por(3) and reset_n;

    -- Coeur Z80 (T80s, mode Z80, avec wait state I/O automatique)
    cpu : entity work.T80s
        generic map (
            Mode    => 0,   -- Z80
            T2Write => 0,
            IOWait  => 1    -- insere automatiquement 1 wait state sur I/O
        )
        port map (
            RESET_n => cpu_reset_n,
            CLK_n   => clk,
            WAIT_n  => '1',
            INT_n   => '1',
            NMI_n   => '1',
            BUSRQ_n => '1',
            M1_n    => cpu_m1_n,
            MREQ_n  => cpu_mreq_n,
            IORQ_n  => cpu_iorq_n,
            RD_n    => cpu_rd_n,
            WR_n    => cpu_wr_n,
            RFSH_n  => open,
            HALT_n  => open,
            BUSAK_n => open,
            A       => cpu_a,
            DI      => cpu_di,
            DO      => cpu_do
        );

    -- ROM programme (256 octets, adressage sur A[7:0])
    rom : entity work.ROM
        generic map (OUTER => ROM_OUTER, INNER => ROM_INNER)
        port map (
            addr => cpu_a(7 downto 0),
            data => rom_data
        );

    -- Multiplexeur bus de donnees vers le CPU
    -- Lecture memoire : ROM (seule memoire presente)
    -- Lecture I/O    : 0xFF par defaut (aucun peripherique en lecture)
    cpu_di <= rom_data when cpu_mreq_n = '0' and cpu_rd_n = '0' else
              x"FF";

    -- Peripherique LED sur port I/O 0x20 (ecriture seule)
    -- Correspond a l'espace disponible sur le connecteur externe du Smaky 6
    process(clk)
    begin
        if rising_edge(clk) then
            if cpu_iorq_n = '0' and cpu_wr_n = '0'
               and cpu_a(7 downto 0) = x"20" then
                led_reg <= cpu_do(0);
            end if;
        end if;
    end process;

    led1 <= led_reg;

end architecture;
