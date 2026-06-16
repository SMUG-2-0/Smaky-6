-- ---------------------------------------------------------------------------
-- T80s_ce.vhd — variante de T80s (freecores/T80) avec CLOCK-ENABLE (CEN).
--
-- Identique à T80s, MAIS le cœur T80 ET la logique de génération du bus
-- (RD_n/WR_n/MREQ_n/IORQ_n/DI_Reg) sont gelés ENSEMBLE par CEN. Quand CEN='0',
-- tout le CPU est figé en lockstep : adresse, donnée et signaux de contrôle
-- restent parfaitement stables -> capture fiable pour une mémoire lente (SDRAM),
-- sans les pièges de timing du WAIT_n mid-cycle.
--
-- WAIT_n est laissé à '1' (le stall se fait via CEN).
-- ---------------------------------------------------------------------------
library IEEE;
use IEEE.std_logic_1164.all;
use IEEE.numeric_std.all;
use work.T80_Pack.all;

entity T80s_ce is
    generic(
        Mode    : integer := 0;
        T2Write : integer := 0;
        IOWait  : integer := 1
    );
    port(
        RESET_n : in  std_logic;
        CLK_n   : in  std_logic;
        CEN     : in  std_logic;                       -- '1' : avance ; '0' : gèle
        WAIT_n  : in  std_logic;
        INT_n   : in  std_logic;
        NMI_n   : in  std_logic;
        BUSRQ_n : in  std_logic;
        M1_n    : out std_logic;
        MREQ_n  : out std_logic;
        IORQ_n  : out std_logic;
        RD_n    : out std_logic;
        WR_n    : out std_logic;
        RFSH_n  : out std_logic;
        HALT_n  : out std_logic;
        BUSAK_n : out std_logic;
        A       : out std_logic_vector(15 downto 0);
        DI      : in  std_logic_vector(7 downto 0);
        DO      : out std_logic_vector(7 downto 0)
    );
end T80s_ce;

architecture rtl of T80s_ce is
    signal IntCycle_n : std_logic;
    signal NoRead     : std_logic;
    signal Write      : std_logic;
    signal IORQ       : std_logic;
    signal DI_Reg     : std_logic_vector(7 downto 0);
    signal MCycle     : std_logic_vector(2 downto 0);
    signal TState     : std_logic_vector(2 downto 0);
begin

    u0 : T80
        generic map(Mode => Mode, IOWait => IOWait)
        port map(
            CEN => CEN,
            M1_n => M1_n, IORQ => IORQ, NoRead => NoRead, Write => Write,
            RFSH_n => RFSH_n, HALT_n => HALT_n, WAIT_n => WAIT_n,
            INT_n => INT_n, NMI_n => NMI_n, RESET_n => RESET_n,
            BUSRQ_n => BUSRQ_n, BUSAK_n => BUSAK_n, CLK_n => CLK_n,
            A => A, DInst => DI, DI => DI_Reg, DO => DO,
            MC => MCycle, TS => TState, IntCycle_n => IntCycle_n);

    process (RESET_n, CLK_n)
    begin
        if RESET_n = '0' then
            RD_n   <= '1';
            WR_n   <= '1';
            IORQ_n <= '1';
            MREQ_n <= '1';
            DI_Reg <= "00000000";
        elsif CLK_n'event and CLK_n = '1' then
            if CEN = '1' then                          -- gelé avec le cœur
                RD_n   <= '1';
                WR_n   <= '1';
                IORQ_n <= '1';
                MREQ_n <= '1';
                if MCycle = "001" then
                    if TState = "001" or (TState = "010" and Wait_n = '0') then
                        RD_n   <= not IntCycle_n;
                        MREQ_n <= not IntCycle_n;
                        IORQ_n <= IntCycle_n;
                    end if;
                    if TState = "011" then
                        MREQ_n <= '0';
                    end if;
                else
                    if (TState = "001" or (TState = "010" and Wait_n = '0')) and NoRead = '0' and Write = '0' then
                        RD_n   <= '0';
                        IORQ_n <= not IORQ;
                        MREQ_n <= IORQ;
                    end if;
                    if T2Write = 0 then
                        if TState = "010" and Write = '1' then
                            WR_n   <= '0';
                            IORQ_n <= not IORQ;
                            MREQ_n <= IORQ;
                        end if;
                    else
                        if (TState = "001" or (TState = "010" and Wait_n = '0')) and Write = '1' then
                            WR_n   <= '0';
                            IORQ_n <= not IORQ;
                            MREQ_n <= IORQ;
                        end if;
                    end if;
                end if;
                if TState = "010" and Wait_n = '1' then
                    DI_Reg <= DI;
                end if;
            end if;
        end if;
    end process;

end;
