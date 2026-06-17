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

entity sm6disk is
    port (
        clk       : in    std_logic;                      -- 50 MHz (PIN_K5)
        reset_n   : in    std_logic;                      -- SW0 actif bas (PIN_W3)
        btn1      : in    std_logic;                      -- SW1 actif bas (PIN_Y4) : gel machine
        btn2      : in    std_logic;                      -- SW2 actif bas (PIN_V4) : sélecteur
        btn3      : in    std_logic;                      -- SW3 actif bas (PIN_W4) : sélecteur
        ps2_clk   : in    std_logic;                      -- clavier PS/2 CLK  (PIN_U20, J12)
        ps2_data  : in    std_logic;                      -- clavier PS/2 DATA (PIN_J15, J12)
        sd_cs     : out   std_logic;                      -- micro-SD CS   (PIN_J14)
        sd_sclk   : out   std_logic;                      -- micro-SD CLK  (PIN_J18)
        sd_mosi   : out   std_logic;                      -- micro-SD MOSI (PIN_W18)
        sd_miso   : in    std_logic;                      -- micro-SD MISO (PIN_V19)
        led       : out   std_logic_vector(7 downto 0);
        video     : out   std_logic;                      -- VGA video  (PIN_C19)
        hsync     : out   std_logic;                      -- VGA hsync  (PIN_D20)
        vsync     : out   std_logic;                      -- VGA vsync  (PIN_D19)
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

architecture rtl of sm6disk is

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

    -- ====================== VRAM vidéo + contrôleur VGA =====================
    signal va_addr  : std_logic_vector(10 downto 0);   -- port A (snoop CPU)
    signal va_we    : std_logic;
    signal ld_rom_addr : std_logic_vector(10 downto 0);   -- adresse boot_rom (loader bootstrap)

    -- clavier PS/2
    signal ps2_scancode : std_logic_vector(7 downto 0);
    signal ps2_valid    : std_logic;
    signal ps2_last     : std_logic_vector(7 downto 0) := (others => '0'); -- dernier scancode (LED)
    signal kb_char      : std_logic_vector(7 downto 0);   -- ASCII traduit
    signal kb_char_valid: std_logic;
    signal kb_fn        : std_logic_vector(6 downto 0);   -- super-shift (fn_keys)
    -- FIFO clavier (8 entrées de 7 bits)
    type kbfifo_t is array(0 to 7) of std_logic_vector(6 downto 0);
    signal kb_fifo      : kbfifo_t;
    signal kb_wr, kb_rd : unsigned(2 downto 0) := (others => '0');
    signal kb_count     : unsigned(3 downto 0) := (others => '0');
    signal kb_state     : unsigned(1 downto 0) := "00";   -- 00 idle, 01 pending, 10 gap
    signal kb_latch     : std_logic := '0';               -- strobe (bit2 de $1)
    signal kb_curcode   : std_logic_vector(6 downto 0) := (others => '0');
    signal kb_gapcnt    : unsigned(2 downto 0) := (others => '0');
    signal kb_tick      : std_logic;                       -- impulsion 50 Hz
    signal io_rd0, io_rd0_d : std_logic := '0';            -- IN $0 en cours
    signal kb_push, kb_pop  : std_logic;
    signal kb_port0, kb_port1, kb_port3 : std_logic_vector(7 downto 0);

    -- carte micro-SD (test : lecture du bloc 0)
    signal sd_rd_req  : std_logic := '0';
    signal sd_busy, sd_ready, sd_err : std_logic;
    signal sd_bvalid  : std_logic;
    signal sd_bdata   : std_logic_vector(7 downto 0);
    signal sd_bindex  : std_logic_vector(8 downto 0);
    signal sd_dbg_state, sd_dbg_r1 : std_logic_vector(7 downto 0);

    signal vb_addr  : std_logic_vector(10 downto 0);   -- port B (lecture VGA)
    signal vb_data  : std_logic_vector(7 downto 0);    -- code caractère lu
    signal crom_addr: std_logic_vector(10 downto 0);
    signal crom_data: std_logic_vector(7 downto 0);    -- octet de fonte

    signal vpix : std_logic := '0';
    signal vhc  : unsigned(9 downto 0) := (others => '0');  -- 0..799
    signal vvc  : unsigned(9 downto 0) := (others => '0');  -- 0..524
    signal vhrel, vvrel : unsigned(9 downto 0);
    signal v_intxt : std_logic;
    signal cx1, cx2 : unsigned(2 downto 0) := (others => '0');   -- char_x pipeliné
    signal it1, it2 : std_logic := '0';                          -- in_text pipeliné
    signal iv1, iv2 : std_logic := '0';                          -- inverse pipeliné

    -- ===================== WD1002 (disque dur, ports $20-$27) ===============
    signal wd_seccount : std_logic_vector(7 downto 0) := (others => '0');
    signal wd_secnum   : std_logic_vector(7 downto 0) := (others => '0');
    signal wd_cyllow   : std_logic_vector(7 downto 0) := (others => '0');
    signal wd_cylhigh  : std_logic_vector(7 downto 0) := (others => '0');
    signal wd_head     : std_logic_vector(7 downto 0) := (others => '0');
    signal wd_read     : std_logic := '0';                 -- mode lecture secteur
    signal wd_idx      : unsigned(7 downto 0) := (others => '0');   -- octet 0..255
    signal wd_lba      : unsigned(15 downto 0) := (others => '0');  -- n° secteur
    signal wd_valid    : std_logic := '0';                 -- secteur lisible
    signal disk_addr   : std_logic_vector(8 downto 0);     -- index dans le tampon SD (512 o)
    signal disk_data   : std_logic_vector(7 downto 0);
    signal disk_byte   : std_logic_vector(7 downto 0);
    -- tampon SD : 1 bloc de 512 o = 2 secteurs Smaky (256 o)
    type sdbuf_t is array(0 to 511) of std_logic_vector(7 downto 0);
    signal sd_buf      : sdbuf_t;
    signal sd_rd_lba   : std_logic_vector(31 downto 0) := (others => '0'); -- n° bloc SD demandé
    signal wd_busy     : std_logic := '0';                 -- lecture SD en cours (statut BSY)
    signal wd_rd_pending : std_logic := '0';               -- read demandé, attend l'init SD
    signal sd_busy_d   : std_logic := '0';
    signal sd_init_done : std_logic := '0';                -- carte SD initialisée (latché)
    signal wd_status   : std_logic_vector(7 downto 0);     -- statut WD1002 ($27)
    signal deliver     : std_logic_vector(7 downto 0) := (others => '0'); -- octet figé pendant l'IN $20
    signal io_port     : std_logic_vector(7 downto 0) := (others => '0'); -- n° de port figé au début du cycle I/O
    signal iorq_n_d    : std_logic := '1';
    signal wd_din      : std_logic_vector(7 downto 0);
    signal io_rd20     : std_logic;
    signal io_rd20_d   : std_logic := '0';
    signal io_done     : std_logic := '0';     -- IN $20 : 1 cycle de gel puis libère

    -- diagnostic WD : valeur lue à IN $27 + jalons
    signal dbg_in27      : std_logic_vector(7 downto 0) := (others => '0');
    signal dbg_in27_seen : std_logic := '0';   -- au moins un IN $27
    signal dbg_found     : std_logic := '0';   -- fetch M1 @ 0x031E (disque détecté)
    signal dbg_rdcmd     : std_logic := '0';   -- OUT $27 = 0x20 (commande read émise)
    signal dbg_in20_seen : std_logic := '0';   -- au moins un IN $20 (transfert secteur)
    signal dbg_lba       : std_logic_vector(15 downto 0) := (others => '0'); -- secteur du 1er read
    signal dbg_b0, dbg_b1, dbg_b2, dbg_b3 : std_logic_vector(7 downto 0) := (others => '0'); -- 4 1ers octets
    signal dbg_r0, dbg_r1, dbg_r2, dbg_r3 : std_logic_vector(7 downto 0) := (others => '0'); -- RAM 0x5800-3 écrits
    signal dbg_cap       : std_logic := '0';

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
                        ld_rom_addr <= std_logic_vector(ld_b(10 downto 0));
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
    -- le CPU ne démarre qu'après le bootstrap ET la 1ʳᵉ init de la carte SD (latché : une
    -- erreur de lecture ultérieure ne reset PAS le CPU)
    cpu_reset_n <= '1' when (boot_done = '1' and rst = '0' and sd_init_done = '1') else '0';
    wd_status   <= x"80" when wd_busy = '1' else x"50";   -- BSY pendant la lecture SD, sinon prêt
    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if rst = '1' then sd_init_done <= '0';
            elsif sd_ready = '1' then sd_init_done <= '1'; end if;
        end if;
    end process;

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

    -- WD1002 : octet disque (mode read, secteur dans le sous-ensemble) ou 0
    disk_byte <= disk_data when wd_valid = '1' else (others => '0');
    -- valeur lue sur les ports WD1002 ($20-$27), sinon 0 pour les autres ports I/O.
    -- Décodage sur 'io_port' (n° de port FIGÉ au début du cycle I/O), pas sur cpu_a instantané :
    -- pendant l'IN (C) de l'INIR, cpu_a passe tôt à HL (write) ; io_port reste = 0x20.
    -- IN $20 -> 'deliver' (octet figé au début de l'IN).
    wd_din <= deliver      when (io_port = x"20" and wd_read = '1') else
              wd_status    when io_port = x"27" else   -- statut : 0x80 BSY (lecture SD) / 0x50 prêt
              wd_seccount  when io_port = x"22" else
              wd_secnum    when io_port = x"23" else
              wd_cyllow    when io_port = x"24" else
              wd_cylhigh   when io_port = x"25" else
              wd_head      when io_port = x"26" else
              kb_port0     when io_port = x"00" else  -- clavier : char|0x80 ou fn_keys
              kb_port1     when io_port = x"01" else  -- bit2=strobe, bit3=timer 50 Hz
              kb_port3     when io_port = x"03" else  -- bit2=strobe
              x"FF";                                  -- non décodé = bus flottant (open bus)
    -- données vers le CPU :
    --   INTA (IORQ+M1) -> 0xFF = RST 38h (IM 0) ; IN périphérique -> wd_din ; mémoire -> SDRAM
    cpu_di <= x"FF" when (cpu_iorq_n = '0' and cpu_m1_n = '0') else
              wd_din when cpu_iorq_n = '0' else
              di_reg;

    -- adresse dans le tampon SD : bit 8 = secteur pair/impair du bloc (LBA mod 2), bits 7:0 = index
    disk_addr <= std_logic_vector(wd_lba(0 downto 0)) & std_logic_vector(wd_idx);
    -- tampon SD 512 o : écrit par le flux SD (sd_bvalid/sd_bindex/sd_bdata), lu par disk_addr
    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if sd_bvalid = '1' then
                sd_buf(to_integer(unsigned(sd_bindex))) <= sd_bdata;
            end if;
            disk_data <= sd_buf(to_integer(unsigned(disk_addr)));
        end if;
    end process;
    io_rd20 <= '1' when (cpu_iorq_n = '0' and cpu_rd_n = '0'
                          and cpu_a(7 downto 0) = x"20" and wd_read = '1') else '0';

    -- timer 50 Hz + interruption (RST 38h via le bus en INTA)
    -- INT_n masqué par la bascule eni50 (comme le matériel Smaky) : la ROM/SAMOS baissent eni50
    -- pendant les lectures disque (INIR) pour ne pas que l'ISR corrompe B/C. Hors lecture,
    -- eni50=1 -> l'ISR 50 Hz tourne (RTC, clavier...).
    cpu_int_n <= '0' when (int_req = '1' and eni50 = '1') else '1';

    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if rst = '1' then
                eni50 <= '0'; int_cnt <= (others => '0');
                int_req <= '0'; timer_pending <= '0';
                inta_seen <= '0'; eni50_seen <= '0';
                wd_read <= '0'; wd_idx <= (others => '0');
                wd_lba <= (others => '0'); wd_valid <= '0'; io_rd20_d <= '0'; io_done <= '0';
                wd_busy <= '0'; wd_rd_pending <= '0'; sd_rd_req <= '0'; sd_busy_d <= '0';
                dbg_in27 <= (others => '0'); dbg_in27_seen <= '0';
                dbg_rdcmd <= '0'; dbg_in20_seen <= '0';
                dbg_lba <= (others => '0'); dbg_b0 <= (others => '0'); dbg_b1 <= (others => '0'); dbg_b2 <= (others => '0'); dbg_b3 <= (others => '0'); dbg_cap <= '0';
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
                -- OUT(0) bit0 = eni50 ; OUT(1) bit3 = acquitte le flag timer ; WD1002 $22-$27
                if cpu_iorq_n = '0' and cpu_wr_n = '0' then
                    if cpu_a(7 downto 0) = x"00" then
                        eni50 <= cpu_do(0);
                        if cpu_do(0) = '1' then eni50_seen <= '1'; end if;
                    elsif cpu_a(7 downto 0) = x"01" and cpu_do(3) = '1' then
                        timer_pending <= '0';
                    elsif cpu_a(7 downto 0) = x"22" then wd_seccount <= cpu_do;
                    elsif cpu_a(7 downto 0) = x"23" then wd_secnum   <= cpu_do;
                    elsif cpu_a(7 downto 0) = x"24" then wd_cyllow   <= cpu_do;
                    elsif cpu_a(7 downto 0) = x"25" then wd_cylhigh  <= cpu_do;
                    elsif cpu_a(7 downto 0) = x"26" then wd_head     <= cpu_do;
                    elsif cpu_a(7 downto 0) = x"27" then          -- commande WD1002
                        if cpu_do = x"20" then                   -- READ SECTOR
                            wd_read <= '1';
                            wd_idx  <= (others => '0');
                            dbg_rdcmd <= '1';
                            -- LBA = ((cyl*6)+head)*32 + secteur
                            wd_lba  <= resize(
                                ((unsigned(wd_cylhigh) & unsigned(wd_cyllow)) * 6
                                 + resize(unsigned(wd_head(4 downto 0)), 16)) * 32
                                + resize(unsigned(wd_secnum), 16), 16);
                            wd_busy <= '1';            -- lance la lecture SD (statut BSY)
                            wd_rd_pending <= '1';
                        elsif cpu_do = x"30" then                -- WRITE SECTOR (lecture seule : ignoré)
                            wd_read <= '0'; wd_idx <= (others => '0');
                        else
                            wd_read <= '0';                      -- seek / autre
                        end if;
                    end if;
                end if;
                wd_valid <= '1';   -- disque complet sur SD : tout secteur est lisible
                -- gestion de la lecture SD : déclenche le bloc (LBA/2) quand la carte est prête,
                -- retombe BSY quand le bloc est chargé dans le tampon (front descendant de sd_busy)
                sd_busy_d <= sd_busy;
                sd_rd_req <= '0';
                if wd_rd_pending = '1' and sd_ready = '1' and sd_busy = '0' then
                    sd_rd_req     <= '1';
                    sd_rd_lba     <= std_logic_vector(resize(wd_lba(15 downto 1), 32));
                    wd_rd_pending <= '0';
                elsif wd_busy = '1' and wd_rd_pending = '0'
                      and sd_busy = '0' and sd_busy_d = '1' then
                    wd_busy <= '0';
                end if;
                -- verrou du n° de port au DÉBUT du cycle I/O (cpu_a transitionne en cours d'IN (C))
                iorq_n_d <= cpu_iorq_n;
                if cpu_iorq_n = '0' and iorq_n_d = '1' then
                    io_port <= cpu_a(7 downto 0);
                end if;
                -- IN $20 : figer l'octet livré au DÉBUT de l'IN (front montant), le présenter
                -- stable toute la durée de l'IN (IOWait relatche DI plusieurs fois), puis
                -- post-incrémenter à la FIN de l'IN. Sémantique WD : rendre byte[idx], puis idx++.
                io_done   <= io_rd20;
                io_rd20_d <= io_rd20;
                if io_rd20 = '1' and io_rd20_d = '0' then       -- front montant : fige l'octet
                    deliver <= disk_byte;
                end if;
                if io_rd20 = '0' and io_rd20_d = '1' and wd_read = '1' then  -- front descendant
                    wd_idx <= wd_idx + 1;
                end if;
                -- diagnostic : que rend IN $27, et a-t-on lu $20 ?
                if cpu_iorq_n = '0' and cpu_rd_n = '0' and cpu_a(7 downto 0) = x"27" then
                    dbg_in27 <= wd_din;
                    dbg_in27_seen <= '1';
                end if;
                if io_rd20 = '1' then dbg_in20_seen <= '1'; end if;
                -- capture du 1er secteur lu : octets aux index 0,1,8,9 (entrée "SYS     SY")
                if io_rd20 = '1' and dbg_cap = '0' then
                    if wd_idx = 0 then dbg_lba <= std_logic_vector(wd_lba); dbg_b0 <= disk_byte; end if;
                    if wd_idx = 1 then dbg_b1 <= disk_byte; end if;
                    if wd_idx = 8 then dbg_b2 <= disk_byte; end if;
                    if wd_idx = 9 then dbg_b3 <= disk_byte; dbg_cap <= '1'; end if;
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
    -- CEN=0 si SW1 enfoncé (gel machine) ou pendant un accès SDRAM
    cpu_cen    <= '0' when (btn1 = '0' or (mem_active = '1' and mem_done = '0')) else '1';

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
                dbg_found    <= '0';
            else
                case mstate is
                    when M_IDLE =>
                        cm_req <= '0';
                        -- cycle mémoire réel (hors refresh), sauf si gelé (débogueur)
                        if cpu_mreq_n = '0' and cpu_rfsh_n = '1' then
                            -- débogueur de déraillement DÉSACTIVÉ : le boot exécute légitimement
                            -- du code en haute mémoire (stub 0x57C0, puis SYS recopié en 0x0000).
                            -- Capture du 1er M1 hors ROM pour info, SANS geler ; on sert toujours.
                            if cpu_m1_n = '0' and unsigned(cpu_a) >= ROM_TOP and frozen = '0' then
                                frozen      <= '1';
                                derail_to   <= cpu_a;
                                derail_from <= last_m1_pc;
                            end if;
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
                                -- diagnostic : fetch M1 @ 0x031E = chemin "disque détecté"
                                if cpu_m1_n = '0' and cpu_a = x"031E" then
                                    dbg_found <= '1';
                                end if;
                                -- cible de retour du RET en 0x0105
                                if cpu_m1_n = '0' and last_m1_pc = x"0105" then
                                    ret_target <= cpu_a;
                                end if;
                                mstate <= M_REQ;       -- CPU gelé (CEN) : signaux déjà stables
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
                            -- SNOOP : ce que le CPU écrit réellement en RAM 0x5800-0x5803
                            -- (destination de l'INIR du catalogue ; attendu "SYS ")
                            if cpu_a = x"5800" then dbg_r0 <= cpu_do; end if;
                            if cpu_a = x"5801" then dbg_r1 <= cpu_do; end if;
                            if cpu_a = x"5802" then dbg_r2 <= cpu_do; end if;
                            if cpu_a = x"5803" then dbg_r3 <= cpu_do; end if;
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
    -- DIAGNOSTIC WD1002 :
    --   rien      -> dbg_in27 = valeur rendue à IN $27 (attendu 0x50 = 01010000)
    --   SW2 (V4)  -> jalons : D0=IN$27 vu, D1=disque détecté (M1@031E),
    --                D2=commande read émise, D3=IN$20 vu, D7=heartbeat
    --   rien      -> dbg_in27 (statut IN $27, attendu 0x50)
    --   SW2       -> jalons (D0 IN$27, D1 détecté, D2 read cmd, D3 IN$20, D7 heartbeat)
    --   SW3       -> dbg_byte0 = 1er octet du secteur lu (attendu 'S' = 0x53)
    --   SW2+SW3   -> dbg_lba bas = n° secteur du 1er read (attendu 0x00)
    -- SNOOP RAM : ce que le CPU a écrit en 0x5800-0x5803 (catalogue en RAM, attendu "SYS ") :
    --   rien=RAM[5800]('S')  SW3=RAM[5801]('Y')  SW2=RAM[5802]('S')  SW2+SW3=RAM[5803](' ')
    -- LED : nombre d'écritures CPU capturées dans 0x58xx (attendu 256 = 0x100 -> figé)
    --   SW3 relâché -> dcap_cnt(7:0)   ; SW3 enfoncé -> D0=figé, D1=cnt(8), D2=cnt(9), D7=heartbeat
    -- LED : PC de la 1ère écriture 0x58xx + 1ère adresse (quelle instruction écrit, et où)
    --   rien=PC bas (attendu ~0x52/0x53 = INIR)  SW3=PC haut (attendu 0x03)
    --   SW2=wa0 (adresse, attendu 0x00)          SW2+SW3=wa3
    -- récepteur clavier PS/2 -> scancode, puis traduction -> ASCII
    u_ps2 : entity work.ps2_rx
        port map (clk => sysclk, ps2_clk => ps2_clk, ps2_data => ps2_data,
                  scancode => ps2_scancode, valid => ps2_valid);
    u_kbtr : entity work.ps2_to_smaky
        port map (clk => sysclk, scancode => ps2_scancode, valid => ps2_valid,
                  char => kb_char, char_valid => kb_char_valid, fn_keys => kb_fn);
    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if ps2_valid = '1' then ps2_last <= ps2_scancode; end if;
        end if;
    end process;

    -- ===== carte micro-SD : lecture du bloc demandé par le WD1002 =====
    u_sd : entity work.sd_spi
        port map (clk => sysclk, reset => rst,
                  cs_n => sd_cs, sclk => sd_sclk, mosi => sd_mosi, miso => sd_miso,
                  rd_req => sd_rd_req, rd_lba => sd_rd_lba,
                  busy => sd_busy, ready => sd_ready, err => sd_err,
                  bvalid => sd_bvalid, bdata => sd_bdata, bindex => sd_bindex,
                  dbg_state => sd_dbg_state, dbg_r1 => sd_dbg_r1);

    -- LED : SW3 relâché = scancode PS/2 ; SW3 enfoncé seul = dbg_state (init SD, 0110_0110=READY) ;
    --       SW3+SW2 = activité disque (D0 wd_busy, D1 sd_busy, D2 sd_ready, D3 sd_err, D7 heartbeat)
    process(btn2, btn3, ps2_last, sd_dbg_state, wd_busy, sd_busy, sd_ready, sd_err, blink_div)
    begin
        if btn3 = '1' then
            led <= ps2_last;
        elsif btn2 = '1' then
            led <= sd_dbg_state;
        else
            led <= (0 => wd_busy, 1 => sd_busy, 2 => sd_ready, 3 => sd_err,
                    7 => blink_div(24), others => '0');
        end if;
    end process;

    -- ====================== Interface clavier Smaky =======================
    -- (cf. simulateur) port $0 = char|0x80 quand strobe armé, sinon 0 (fn_keys) ;
    --  $1 bit2 = strobe, bit3 = timer 50 Hz ; $3 bit2 = strobe ; cadence 50 Hz.
    kb_tick  <= '1' when int_cnt = to_unsigned(INT_PERIOD - 1, int_cnt'length) else '0';
    io_rd0   <= '1' when (cpu_iorq_n = '0' and cpu_rd_n = '0' and io_port = x"00") else '0';
    kb_push  <= '1' when (kb_char_valid = '1' and kb_count < 8) else '0';
    kb_pop   <= '1' when (kb_tick = '1' and kb_state = "00" and kb_count > 0) else '0';
    kb_port0 <= '1' & kb_curcode when kb_latch = '1' else '0' & kb_fn;  -- char|0x80 ou super-shift
    kb_port1 <= (3 => timer_pending, 2 => kb_latch, others => '0');
    kb_port3 <= (2 => kb_latch, others => '0');

    process(sysclk)
    begin
        if rising_edge(sysclk) then
            if rst = '1' then
                kb_wr <= (others => '0'); kb_rd <= (others => '0');
                kb_count <= (others => '0'); kb_state <= "00";
                kb_latch <= '0'; kb_gapcnt <= (others => '0'); io_rd0_d <= '0';
            else
                io_rd0_d <= io_rd0;
                -- push : nouvel ASCII du clavier dans la FIFO
                if kb_push = '1' then
                    kb_fifo(to_integer(kb_wr)) <= kb_char(6 downto 0);
                    kb_wr <= kb_wr + 1;
                end if;
                -- pop (tick 50 Hz, état idle) : armer le strobe avec le prochain char
                if kb_pop = '1' then
                    kb_curcode <= kb_fifo(to_integer(kb_rd));
                    kb_rd      <= kb_rd + 1;
                    kb_latch   <= '1';
                    kb_state   <= "01";          -- pending
                end if;
                -- compteur FIFO
                if kb_push = '1' and kb_pop = '0' then
                    kb_count <= kb_count + 1;
                elsif kb_pop = '1' and kb_push = '0' then
                    kb_count <= kb_count - 1;
                end if;
                -- fin de IN $0 (front descendant) : la lecture efface le strobe -> gap
                if io_rd0 = '0' and io_rd0_d = '1' and kb_state = "01" then
                    kb_latch  <= '0';
                    kb_state  <= "10";           -- gap
                    kb_gapcnt <= to_unsigned(2, 3);
                end if;
                -- gap : quelques ticks à strobe=0 avant le char suivant
                if kb_tick = '1' and kb_state = "10" then
                    if kb_gapcnt = 0 then kb_state <= "00";
                    else kb_gapcnt <= kb_gapcnt - 1; end if;
                end if;
            end if;
        end if;
    end process;

    -- ========================= VRAM + char-gen ============================
    rom_addr <= ld_rom_addr;     -- boot_rom : adresse du loader (bootstrap ROM18 -> SDRAM)

    -- Snoop : toute écriture CPU dans 0x4000-0x47FF est copiée en VRAM (port A).
    va_addr <= cpu_a(10 downto 0);
    va_we   <= '1' when (mstate = M_REQ and is_write = '1'
                          and cpu_a(15 downto 11) = "01000") else '0';

    u_vram : entity work.vram
        port map (clk => sysclk,
                  addr_a => va_addr, din_a => cpu_do, we_a => va_we, dout_a => open,
                  addr_b => vb_addr, dout_b => vb_data);

    u_crom : entity work.char_rom
        port map (clk => sysclk, addr => crom_addr, data => crom_data);

    -- ============================ Contrôleur VGA ===========================
    vhrel <= vhc - 64;
    vvrel <= vvc - 80;
    v_intxt <= '1' when (vhc >= 64 and vhc < 576 and vvc >= 80 and vvc < 400) else '0';
    -- cellule = ligne(4:0) & colonne(5:0) ; adresse fonte = code(6:0) & char_y(3:0)
    vb_addr   <= std_logic_vector(vvrel(8 downto 4)) & std_logic_vector(vhrel(8 downto 3));
    crom_addr <= vb_data(6 downto 0) & std_logic_vector(vvrel(3 downto 0));

    process(sysclk)
    begin
        if rising_edge(sysclk) then
            vpix <= not vpix;
            if vpix = '1' then                         -- 1 pixel tous les 2 cycles (25 MHz)
                if vhc = 799 then
                    vhc <= (others => '0');
                    if vvc = 524 then vvc <= (others => '0'); else vvc <= vvc + 1; end if;
                else
                    vhc <= vhc + 1;
                end if;
                if vhc >= 656 and vhc < 752 then hsync <= '0'; else hsync <= '1'; end if;
                if vvc >= 490 and vvc < 492 then vsync <= '0'; else vsync <= '1'; end if;

                -- pipeline pour aligner sur la latence VRAM(1)+char_rom(1)
                cx1 <= vhrel(2 downto 0); cx2 <= cx1;
                it1 <= v_intxt;           it2 <= it1;
                iv1 <= vb_data(7);                         -- bit inverse vidéo
                if it2 = '1' and (crom_data(to_integer(cx2)) xor iv1) = '1' then
                    video <= '1';
                else
                    video <= '0';
                end if;
            end if;
        end if;
    end process;

end architecture;
