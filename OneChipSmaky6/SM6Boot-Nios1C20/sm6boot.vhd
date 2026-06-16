-- ---------------------------------------------------------------------------
-- sm6boot.vhd — Smaky 6 qui boote sur SDRAM (M2), carte Nios (EP1C20).
--
-- Séquence :
--   1) bootstrap : recopie ROM18.bin (boot_rom) en SDRAM[0..1994], octet par octet,
--   2) relâche le Z80 (T80s) : 64 kB de RAM = SDRAM, accès octet, WAIT_n pendant
--      la latence SDRAM, périphériques (I/O et lectures non mappées) = 0,
--   3) le code de chargement écrit du texte ("ROM de chargement") à partir de
--      l'adresse 0x4000 (octal 40000).
--
-- Observabilité (pas encore d'écran) :
--   • avant écriture vidéo : led0=boot_done, led1=any_write, led3=sdram_init,
--     led4=cpu_alive, led7=heartbeat
--   • dès une écriture en 0x4000 : led(7..0) = octet écrit (code du 1er caractère,
--     'R'=0x52 attendu) ; led2 latché = zone vidéo touchée.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sm6boot is
    port (
        clk       : in    std_logic;                      -- 50 MHz (PIN_K5)
        reset_n   : in    std_logic;                      -- SW0 actif bas (PIN_W3)
        btn2      : in    std_logic;                      -- SW2 actif bas (PIN_V4) : sélecteur
        btn3      : in    std_logic;                      -- SW3 actif bas (PIN_W4) : sélecteur
        led       : out   std_logic_vector(7 downto 0);
        sdram_clk : out   std_logic;                      -- PIN_L13
        sd_a      : out   std_logic_vector(11 downto 0);
        sd_ba     : out   std_logic_vector(1 downto 0);
        sd_cs_n   : out   std_logic;
        sd_ras_n  : out   std_logic;
        sd_cas_n  : out   std_logic;
        sd_we_n   : out   std_logic;
        sd_cke    : out   std_logic;
        sd_dqm    : out   std_logic_vector(3 downto 0);
        sd_dq     : inout std_logic_vector(31 downto 0)
    );
end entity;

architecture rtl of sm6boot is

    constant ROM_LEN  : integer := 1995;              -- taille ROM18.bin
    constant VID_BASE : std_logic_vector(15 downto 0) := x"4000";

    -- horloge système (PLL à réintroduire plus tard si besoin)
    signal sysclk     : std_logic;

    -- reset / heartbeat
    signal por       : std_logic_vector(3 downto 0) := (others => '0');
    signal rst       : std_logic;
    signal blink_div : unsigned(24 downto 0) := (others => '0');

    -- boot_rom
    signal rom_addr : std_logic_vector(10 downto 0);
    signal rom_data : std_logic_vector(7 downto 0);

    -- contrôleur SDRAM (signaux muxés loader/CPU)
    signal s_req, s_we, s_done, s_ready, s_initdone : std_logic;
    signal s_ben   : std_logic_vector(3 downto 0);
    signal s_addr  : std_logic_vector(21 downto 0);
    signal s_wdata : std_logic_vector(31 downto 0);
    signal s_rdata : std_logic_vector(31 downto 0);

    -- bootstrap loader
    type lstate_t is (L_INIT, L_ZERO, L_ZWAIT, L_ADDR, L_ROMWAIT, L_REQ, L_WAITW, L_DONE);
    signal lstate    : lstate_t := L_INIT;
    signal ld_b      : unsigned(21 downto 0) := (others => '0');  -- index octet
    signal zc        : unsigned(13 downto 0) := (others => '0');  -- compteur mot (zero-fill 64kB)
    signal boot_done : std_logic := '0';
    signal ld_req, ld_we : std_logic;
    signal ld_ben    : std_logic_vector(3 downto 0);
    signal ld_addr   : std_logic_vector(21 downto 0);
    signal ld_wdata  : std_logic_vector(31 downto 0);

    -- CPU T80
    signal cpu_a       : std_logic_vector(15 downto 0);
    signal cpu_do      : std_logic_vector(7 downto 0);
    signal cpu_di      : std_logic_vector(7 downto 0);
    signal cpu_mreq_n, cpu_iorq_n, cpu_rd_n, cpu_wr_n : std_logic;
    signal cpu_m1_n, cpu_rfsh_n : std_logic;
    signal cpu_reset_n, cpu_cen, cpu_int_n : std_logic;
    signal mem_active : std_logic;                 -- cycle mémoire en cours (MREQ, hors refresh)
    signal mem_done   : std_logic := '0';          -- accès SDRAM terminé -> laisse avancer le CPU

    -- timer 50 Hz + interruption
    constant INT_PERIOD : integer := 1000000;   -- 50 MHz / 50 Hz (temps réel)
    signal eni50        : std_logic := '0';      -- validation timer (OUT 0 bit0)
    signal int_cnt      : unsigned(19 downto 0) := (others => '0');
    signal int_req      : std_logic := '0';      -- demande d'interruption
    signal timer_pending: std_logic := '0';      -- port 1 bit3
    signal inta_seen    : std_logic := '0';      -- au moins une INTA (diagnostic)
    signal eni50_seen   : std_logic := '0';      -- eni50 activé (diagnostic)

    -- interface mémoire CPU<->SDRAM
    type mstate_t is (M_IDLE, M_PREP, M_REQ, M_FIN);
    signal mstate  : mstate_t := M_IDLE;
    signal is_write : std_logic;
    signal acc_lane : std_logic_vector(1 downto 0);
    signal acc_addr : std_logic_vector(13 downto 0);   -- adresse mot latchée
    signal acc_wd   : std_logic_vector(7 downto 0);     -- donnée latchée (dès M_IDLE)
    signal di_reg  : std_logic_vector(7 downto 0) := (others => '0');
    signal cm_req, cm_we : std_logic;
    signal cm_ben  : std_logic_vector(3 downto 0);
    signal cm_addr : std_logic_vector(21 downto 0);
    signal cm_wdata: std_logic_vector(31 downto 0);

    -- détecteurs
    signal any_write    : std_logic := '0';   -- le CPU a écrit en mémoire
    signal nz_write     : std_logic := '0';   -- ... avec une valeur non-nulle
    signal video_hit    : std_logic := '0';   -- écriture dans la zone texte
    signal vid_captured : std_logic := '0';   -- 1er octet texte non-nul capturé
    signal video_byte   : std_logic_vector(7 downto 0) := (others => '0');
    signal cpu_alive    : std_logic := '0';
    -- capture des 3 premiers caractères écran (0x4000..0x4002) + comparaison "ROM"
    signal v0, v1, v2   : std_logic_vector(7 downto 0) := (others => '0');
    signal hit0         : std_logic := '0';
    signal match_rom    : std_logic;
    signal max_pc       : std_logic_vector(15 downto 0) := (others => '0'); -- adresse max atteinte (M1)

    -- débogueur : gel au 1er fetch d'instruction hors ROM (>= 0x0800)
    constant ROM_TOP    : unsigned(15 downto 0) := x"0800";
    signal acc_pc       : std_logic_vector(15 downto 0);   -- adresse M1 en cours de service
    signal is_m1_acc    : std_logic;                       -- l'accès courant est un fetch M1
    signal last_m1_pc   : std_logic_vector(15 downto 0) := (others => '0'); -- dernier M1 servi
    signal frozen       : std_logic := '0';
    signal derail_to    : std_logic_vector(15 downto 0) := (others => '0'); -- cible hors ROM
    signal derail_from  : std_logic_vector(15 downto 0) := (others => '0'); -- instruction sauteuse
    signal ret_target   : std_logic_vector(15 downto 0) := (others => '0'); -- où revient le RET 0x0105
    signal w1_addr      : std_logic_vector(15 downto 0) := (others => '0');  -- adresse 1ʳᵉ écriture
    signal w2_addr      : std_logic_vector(15 downto 0) := (others => '0');  -- adresse 2ᵉ écriture
    signal wr_idx       : unsigned(1 downto 0) := (others => '0');

    -- octet -> voie one-hot
    function lane_ben(l : std_logic_vector(1 downto 0)) return std_logic_vector is
    begin
        case l is
            when "00" => return "0001";
            when "01" => return "0010";
            when "10" => return "0100";
            when others => return "1000";
        end case;
    end function;

    function rep4(b : std_logic_vector(7 downto 0)) return std_logic_vector is
    begin
        return b & b & b & b;
    end function;

begin

    -- horloge directe (sans PLL pour ce test) ; SDRAM en opposition de phase
    sysclk    <= clk;
    sdram_clk <= not clk;

    process(sysclk) begin
        if rising_edge(sysclk) then
            por <= por(2 downto 0) & '1';
            blink_div <= blink_div + 1;
        end if;
    end process;
    rst <= '1' when (por(3) = '0' or reset_n = '0') else '0';

    -- ROM de chargement
    u_rom : entity work.boot_rom
        port map (clk => sysclk, addr => rom_addr, data => rom_data);

    -- contrôleur SDRAM
    u_sdram : entity work.sdram_ctrl
        port map (
            clk => sysclk, rst => rst,
            req => s_req, we => s_we, ben => s_ben, addr => s_addr, wdata => s_wdata,
            rdata => s_rdata, done => s_done, ready => s_ready, init_done => s_initdone,
            sd_a => sd_a, sd_ba => sd_ba,
            sd_cs_n => sd_cs_n, sd_ras_n => sd_ras_n, sd_cas_n => sd_cas_n,
            sd_we_n => sd_we_n, sd_cke => sd_cke, sd_dqm => sd_dqm, sd_dq => sd_dq
        );

    -- MUX : loader avant boot_done, CPU après
    s_req   <= ld_req   when boot_done = '0' else cm_req;
    s_we    <= ld_we    when boot_done = '0' else cm_we;
    s_ben   <= ld_ben   when boot_done = '0' else cm_ben;
    s_addr  <= ld_addr  when boot_done = '0' else cm_addr;
    s_wdata <= ld_wdata when boot_done = '0' else cm_wdata;

    -- ============================ BOOTSTRAP LOADER ===========================
    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if rst = '1' then
                lstate    <= L_INIT;
                ld_b      <= (others => '0');
                ld_req    <= '0';
                boot_done <= '0';
            else
                case lstate is
                    when L_INIT =>
                        ld_req <= '0';
                        if s_initdone = '1' then
                            zc     <= (others => '0');
                            lstate <= L_ZERO;
                        end if;

                    -- pré-effacement : toute la RAM 64 kB à 0 (élimine la RAM non-init)
                    when L_ZERO =>
                        ld_we    <= '1';
                        ld_ben   <= "1111";
                        ld_addr  <= "00000000" & std_logic_vector(zc);
                        ld_wdata <= (others => '0');
                        ld_req   <= '1';
                        lstate   <= L_ZWAIT;

                    when L_ZWAIT =>
                        if s_done = '1' then
                            ld_req <= '0';
                            if zc = 16383 then
                                ld_b   <= (others => '0');
                                lstate <= L_ADDR;
                            else
                                zc     <= zc + 1;
                                lstate <= L_ZERO;
                            end if;
                        end if;

                    when L_ADDR =>
                        rom_addr <= std_logic_vector(ld_b(10 downto 0));
                        lstate   <= L_ROMWAIT;

                    when L_ROMWAIT =>           -- latence lecture boot_rom
                        lstate <= L_REQ;

                    when L_REQ =>
                        ld_we    <= '1';
                        ld_ben   <= lane_ben(std_logic_vector(ld_b(1 downto 0)));
                        ld_addr  <= "00" & std_logic_vector(ld_b(21 downto 2));
                        ld_wdata <= rep4(rom_data);
                        ld_req   <= '1';
                        lstate   <= L_WAITW;

                    when L_WAITW =>
                        if s_done = '1' then
                            ld_req <= '0';
                            if ld_b = ROM_LEN - 1 then
                                boot_done <= '1';
                                lstate    <= L_DONE;
                            else
                                ld_b   <= ld_b + 1;
                                lstate <= L_ADDR;
                            end if;
                        end if;

                    when L_DONE =>
                        boot_done <= '1';
                end case;
            end if;
        end if;
    end process;

    -- =============================== CPU T80 ================================
    cpu_reset_n <= '1' when (boot_done = '1' and rst = '0') else '0';

    u_cpu : entity work.T80s_ce
        generic map (Mode => 0, T2Write => 0, IOWait => 1)
        port map (
            RESET_n => cpu_reset_n, CLK_n => sysclk, CEN => cpu_cen, WAIT_n => '1',
            INT_n => cpu_int_n, NMI_n => '1', BUSRQ_n => '1',
            M1_n => cpu_m1_n, MREQ_n => cpu_mreq_n, IORQ_n => cpu_iorq_n,
            RD_n => cpu_rd_n, WR_n => cpu_wr_n, RFSH_n => cpu_rfsh_n,
            HALT_n => open, BUSAK_n => open,
            A => cpu_a, DI => cpu_di, DO => cpu_do
        );

    -- données vers le CPU :
    --   INTA (IORQ+M1) -> 0xFF = RST 38h (IM 0) ; IN périphérique -> 0 ; mémoire -> octet SDRAM
    cpu_di <= x"FF" when (cpu_iorq_n = '0' and cpu_m1_n = '0') else
              x"00" when cpu_iorq_n = '0' else
              di_reg;

    -- timer 50 Hz + interruption (RST 38h via le bus en INTA)
    cpu_int_n <= '0' when int_req = '1' else '1';

    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if rst = '1' then
                eni50 <= '0'; int_cnt <= (others => '0');
                int_req <= '0'; timer_pending <= '0';
                inta_seen <= '0'; eni50_seen <= '0';
            else
                -- tick 50 Hz temps réel
                if int_cnt = INT_PERIOD - 1 then
                    int_cnt <= (others => '0');
                    if eni50 = '1' then
                        int_req       <= '1';
                        timer_pending <= '1';
                    end if;
                else
                    int_cnt <= int_cnt + 1;
                end if;
                -- OUT(0) bit0 = eni50 ; OUT(1) bit3 = acquitte le flag timer
                if cpu_iorq_n = '0' and cpu_wr_n = '0' then
                    if cpu_a(7 downto 0) = x"00" then
                        eni50 <= cpu_do(0);
                        if cpu_do(0) = '1' then eni50_seen <= '1'; end if;
                    elsif cpu_a(7 downto 0) = x"01" and cpu_do(3) = '1' then
                        timer_pending <= '0';
                    end if;
                end if;
                -- acquittement INTA (M1 + IORQ) : retombe la demande
                if cpu_m1_n = '0' and cpu_iorq_n = '0' then
                    int_req   <= '0';
                    inta_seen <= '1';
                end if;
            end if;
        end if;
    end process;

    -- Stall par CLOCK-ENABLE : on gèle TOUT le CPU (cœur + bus) pendant l'accès
    -- SDRAM -> adresse/donnée parfaitement stables (plus de skew sur accès rapprochés).
    mem_active <= '1' when (cpu_mreq_n = '0' and cpu_rfsh_n = '1') else '0';
    cpu_cen    <= '1' when (mem_active = '0' or mem_done = '1') else '0';

    -- interface mémoire CPU <-> SDRAM (octet)
    -- adresse + voie LATCHÉES ensemble (atomique -> pas de swap) ; donnée
    -- combinatoire sur cpu_do (stable pendant le stall -> pas de donnée périmée)
    cm_addr  <= "00000000" & acc_addr;
    cm_we    <= is_write;
    cm_ben   <= lane_ben(acc_lane) when is_write = '1' else "1111";
    cm_wdata <= rep4(acc_wd);

    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if cpu_reset_n = '0' then
                mstate <= M_IDLE;
                cm_req <= '0';
                mem_done     <= '0';
                any_write    <= '0';
                nz_write     <= '0';
                video_hit    <= '0';
                vid_captured <= '0';
                cpu_alive    <= '0';
                hit0         <= '0';
                max_pc       <= (others => '0');
                frozen       <= '0';
                last_m1_pc   <= (others => '0');
                ret_target   <= (others => '0');
                wr_idx       <= (others => '0');
            else
                case mstate is
                    when M_IDLE =>
                        cm_req <= '0';
                        -- cycle mémoire réel (hors refresh), sauf si gelé (débogueur)
                        if cpu_mreq_n = '0' and cpu_rfsh_n = '1' and frozen = '0' then
                            -- déraillement : 1er fetch d'instruction hors ROM -> on gèle
                            if cpu_m1_n = '0' and unsigned(cpu_a) >= ROM_TOP then
                                frozen      <= '1';
                                derail_to   <= cpu_a;          -- où il saute
                                derail_from <= last_m1_pc;     -- d'où (instruction fautive)
                                -- on NE sert PAS l'accès : CPU figé (wait_n reste à 0)
                            else
                                is_write  <= cpu_rd_n;         -- rd_n=1 => écriture
                                acc_lane  <= cpu_a(1 downto 0);
                                acc_addr  <= cpu_a(15 downto 2);
                                acc_wd    <= cpu_do;           -- donnée capturée ici (WR déjà actif)
                                -- sonde : adresses des 2 premières écritures (PUSH du CALL)
                                if cpu_rd_n = '1' then
                                    if wr_idx = 0 then
                                        w1_addr <= cpu_a; wr_idx <= "01";
                                    elsif wr_idx = 1 then
                                        w2_addr <= cpu_a; wr_idx <= "10";
                                    end if;
                                end if;
                                is_m1_acc <= not cpu_m1_n;
                                acc_pc    <= cpu_a;
                                cpu_alive <= '1';
                                if cpu_m1_n = '0'
                                   and unsigned(cpu_a) > unsigned(max_pc) then
                                    max_pc <= cpu_a;
                                end if;
                                -- cible de retour du RET en 0x0105
                                if cpu_m1_n = '0' and last_m1_pc = x"0105" then
                                    ret_target <= cpu_a;
                                end if;
                                mstate <= M_REQ;       -- CPU gelé (CEN) : signaux déjà stables
                            end if;
                        end if;

                    when M_PREP =>                          -- inutilisé (CEN)
                        mstate <= M_REQ;

                    when M_REQ =>
                        cm_req <= '1';
                        -- détecteurs d'écriture
                        if is_write = '1' then
                            any_write <= '1';
                            if cpu_do /= x"00" then
                                nz_write <= '1';
                            end if;
                            -- zone texte 0x4000..0x40FF (au-dessous de la pile 0x4600)
                            if cpu_a(15 downto 8) = x"40" then
                                video_hit <= '1';
                                if cpu_do /= x"00" and vid_captured = '0' then
                                    video_byte   <= cpu_do;   -- 1er caractère non-nul
                                    vid_captured <= '1';
                                end if;
                            end if;
                            -- capture des 3 premières cellules écran (dernière écriture gagne)
                            if cpu_a = x"4000" then v0 <= cpu_do; hit0 <= '1'; end if;
                            if cpu_a = x"4001" then v1 <= cpu_do; end if;
                            if cpu_a = x"4002" then v2 <= cpu_do; end if;
                        end if;
                        if s_done = '1' then
                            cm_req <= '0';
                            if is_write = '0' then
                                case acc_lane is
                                    when "00"   => di_reg <= s_rdata(7 downto 0);
                                    when "01"   => di_reg <= s_rdata(15 downto 8);
                                    when "10"   => di_reg <= s_rdata(23 downto 16);
                                    when others => di_reg <= s_rdata(31 downto 24);
                                end case;
                            end if;
                            -- mémoriser le dernier fetch d'instruction servi
                            if is_m1_acc = '1' then
                                last_m1_pc <= acc_pc;
                            end if;
                            mem_done <= '1';               -- débloque : CEN=1, le CPU avance
                            mstate   <= M_FIN;
                        end if;

                    when M_FIN =>
                        mem_done <= '1';                   -- CEN=1 : le CPU finit son cycle
                        if mem_active = '0' then           -- MREQ retombé -> cycle terminé
                            mem_done <= '0';
                            mstate   <= M_IDLE;
                        end if;
                end case;
            end if;
        end if;
    end process;

    -- =============================== LEDS ===================================
    match_rom <= '1' when (v0 = x"52" and v1 = x"4F" and v2 = x"4D") else '0';  -- "ROM"

    -- Affichage. Si gelé (déraillement) : 2 poussoirs sélectionnent l'octet montré
    --   rien        -> derail_to  (octet bas)   : où le PC a sauté hors ROM
    --   SW2         -> derail_to  (octet haut)
    --   SW3         -> derail_from (octet bas)  : l'instruction qui a fait le saut
    --   SW2+SW3     -> derail_from (octet haut)
    -- Affichage :
    --   match "ROM"      -> tout clignote (succès)
    --   gelé (déraillement) : rien=derail_to bas, SW2=derail_to haut,
    --                         SW3=derail_from bas, SW2+SW3=derail_from haut
    --   sinon (en cours) : rien=max_pc bas, SW2=max_pc haut (adresse max atteinte)
    process(frozen, derail_to, derail_from, btn2, btn3, match_rom, blink_div, max_pc)
    begin
        if match_rom = '1' then
            led <= (others => blink_div(24));  -- 🎉 "ROM" en 0x4000 : CLIGNOTE = succès
        elsif frozen = '1' then
            if btn2 = '0' and btn3 = '0' then
                led <= derail_from(15 downto 8);
            elsif btn2 = '0' then
                led <= derail_to(15 downto 8);
            elsif btn3 = '0' then
                led <= derail_from(7 downto 0);
            else
                led <= derail_to(7 downto 0);
            end if;
        else
            -- rien=max_pc bas, SW2=max_pc haut, SW3=ret_target bas, SW2+SW3=ret_target haut
            -- SONDE adresses des 2 PUSH : rien=w1 bas, SW2=w1 haut, SW3=w2 bas, SW2+SW3=w2 haut
            if btn2 = '0' and btn3 = '0' then
                led <= w2_addr(15 downto 8);
            elsif btn3 = '0' then
                led <= w2_addr(7 downto 0);
            elsif btn2 = '0' then
                led <= w1_addr(15 downto 8);
            else
                led <= w1_addr(7 downto 0);
            end if;
        end if;
    end process;

end architecture;
