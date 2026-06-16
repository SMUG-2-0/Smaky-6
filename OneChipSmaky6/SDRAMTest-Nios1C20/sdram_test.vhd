-- ---------------------------------------------------------------------------
-- sdram_test.vhd — Autotest SDRAM (M1) pour la Nios Development Board (EP1C20).
--
-- Écrit un motif unique à N adresses de la SDRAM, le relit et compare.
-- Affichage sur les 8 LED de la carte :
--   • EN COURS / bloqué : D0 clignote (~3 Hz)  -> le test tourne mais n'a pas fini
--                         (si init SDRAM bloquée, on reste ici)
--   • SUCCÈS  : D7 clignote (~1.5 Hz), reste éteint ailleurs
--   • ÉCHEC   : D6 allumé fixe + D0..D5 = 6 bits de poids faible de l'adresse fautive
--
-- Motif(i) = i(15..0) & not i(15..0)  (distinct par adresse, exerce les 2 polarités).
-- L'horloge physique SDRAM (PIN_L13) = not clk (déphasage 180°, marge 1/2 cycle @ 50 MHz).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sdram_test is
    port (
        clk        : in    std_logic;                      -- 50 MHz (PIN_K5)
        reset_n    : in    std_logic;                      -- SW0 actif bas (PIN_W3)
        led        : out   std_logic_vector(7 downto 0);   -- D0..D7
        -- SDRAM (MT48LC4M32B2)
        sdram_clk  : out   std_logic;                      -- PIN_L13
        sd_a       : out   std_logic_vector(11 downto 0);
        sd_ba      : out   std_logic_vector(1 downto 0);
        sd_cs_n    : out   std_logic;
        sd_ras_n   : out   std_logic;
        sd_cas_n   : out   std_logic;
        sd_we_n    : out   std_logic;
        sd_cke     : out   std_logic;
        sd_dqm     : out   std_logic_vector(3 downto 0);
        sd_dq      : inout std_logic_vector(31 downto 0)
    );
end entity;

architecture rtl of sdram_test is

    constant N : integer := 1024;   -- nb d'adresses testées (croise plusieurs lignes)

    -- reset : power-on reset combiné au bouton
    signal por  : std_logic_vector(3 downto 0) := (others => '0');
    signal rst  : std_logic;

    -- interface contrôleur
    signal c_req, c_we, c_done, c_ready, c_initdone : std_logic;
    signal c_addr  : std_logic_vector(21 downto 0);
    signal c_wdata : std_logic_vector(31 downto 0);
    signal c_rdata : std_logic_vector(31 downto 0);

    -- FSM de test
    type tstate_t is (T_INIT, T_WRITE, T_WAITW, T_READ, T_WAITR, T_PASS, T_FAIL);
    signal ts   : tstate_t := T_INIT;
    signal idx  : integer range 0 to N := 0;
    signal fail_addr : std_logic_vector(21 downto 0) := (others => '0');

    -- clignotement
    signal blink_div : unsigned(24 downto 0) := (others => '0');

    -- motif attendu pour l'index courant
    function pattern(i : integer) return std_logic_vector is
        variable v : std_logic_vector(15 downto 0);
    begin
        v := std_logic_vector(to_unsigned(i mod 65536, 16));
        return v & (not v);
    end function;

begin

    -- horloge SDRAM (déphasée)
    sdram_clk <= not clk;

    -- power-on reset + bouton
    process(clk)
    begin
        if rising_edge(clk) then
            por <= por(2 downto 0) & '1';
        end if;
    end process;
    rst <= '1' when (por(3) = '0' or reset_n = '0') else '0';

    -- compteur de clignotement
    process(clk)
    begin
        if rising_edge(clk) then
            blink_div <= blink_div + 1;
        end if;
    end process;

    -- contrôleur SDRAM
    u_sdram : entity work.sdram_ctrl
        port map (
            clk => clk, rst => rst,
            req => c_req, we => c_we, addr => c_addr, wdata => c_wdata,
            rdata => c_rdata, done => c_done, ready => c_ready, init_done => c_initdone,
            sd_a => sd_a, sd_ba => sd_ba,
            sd_cs_n => sd_cs_n, sd_ras_n => sd_ras_n, sd_cas_n => sd_cas_n,
            sd_we_n => sd_we_n, sd_cke => sd_cke, sd_dqm => sd_dqm, sd_dq => sd_dq
        );

    -- FSM de test
    process(clk)
    begin
        if rising_edge(clk) then
            -- c_req est maintenu en niveau (pas de default) : on l'arme dans
            -- T_WRITE/T_READ et on le relâche à la réception de done.
            if rst = '1' then
                ts    <= T_INIT;
                idx   <= 0;
                c_req <= '0';
            else
                case ts is

                    when T_INIT =>
                        if c_initdone = '1' then
                            idx <= 0;
                            ts  <= T_WRITE;
                        end if;

                    when T_WRITE =>
                        if c_ready = '1' then
                            c_addr  <= std_logic_vector(to_unsigned(idx, 22));
                            c_wdata <= pattern(idx);
                            c_we    <= '1';
                            c_req   <= '1';
                            ts      <= T_WAITW;
                        end if;

                    when T_WAITW =>
                        if c_done = '1' then
                            c_req <= '0';           -- relâche req
                            if idx = N - 1 then
                                idx <= 0;
                                ts  <= T_READ;
                            else
                                idx <= idx + 1;
                                ts  <= T_WRITE;
                            end if;
                        end if;

                    when T_READ =>
                        if c_ready = '1' then
                            c_addr <= std_logic_vector(to_unsigned(idx, 22));
                            c_we   <= '0';
                            c_req  <= '1';
                            ts     <= T_WAITR;
                        end if;

                    when T_WAITR =>
                        if c_done = '1' then
                            c_req <= '0';           -- relâche req
                            if c_rdata /= pattern(idx) then
                                fail_addr <= std_logic_vector(to_unsigned(idx, 22));
                                ts        <= T_FAIL;
                            elsif idx = N - 1 then
                                ts <= T_PASS;
                            else
                                idx <= idx + 1;
                                ts  <= T_READ;
                            end if;
                        end if;

                    when T_PASS => null;        -- état terminal succès
                    when T_FAIL => null;        -- état terminal échec

                end case;
            end if;
        end if;
    end process;

    -- affichage LED — MODE DIAGNOSTIC (M1 debug)
    --   led(2..0) = numéro d'état de la FSM de test (voir ci-dessous)
    --   led(3)    = c_initdone (init SDRAM terminée ?)
    --   led(4)    = c_ready    (contrôleur en IDLE ?)
    --   led(7)    = heartbeat (~1.5 Hz) -> prouve que la config tourne
    -- États : 0=T_INIT 1=T_WRITE 2=T_WAITW 3=T_READ 4=T_WAITR 5=T_PASS 6=T_FAIL
    process(ts, blink_div, c_initdone, c_ready, fail_addr)
        variable st : std_logic_vector(2 downto 0);
    begin
        led <= (others => '0');
        case ts is
            when T_PASS =>
                led(7) <= blink_div(24);            -- ✅ succès : D7 clignote seul
            when T_FAIL =>
                led(6) <= '1';                      -- ❌ échec : D6 + adresse fautive
                led(5 downto 0) <= fail_addr(5 downto 0);
            when others =>                          -- en cours / bloqué : diagnostic
                case ts is
                    when T_INIT  => st := "000";
                    when T_WRITE => st := "001";
                    when T_WAITW => st := "010";
                    when T_READ  => st := "011";
                    when others  => st := "100";    -- T_WAITR
                end case;
                led(2 downto 0) <= st;
                led(3) <= c_initdone;
                led(4) <= c_ready;
                led(7) <= blink_div(24);            -- heartbeat
        end case;
    end process;

end architecture;
