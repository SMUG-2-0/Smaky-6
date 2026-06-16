-- ---------------------------------------------------------------------------
-- sdram_ctrl.vhd — Contrôleur SDRAM léger, mono-accès, autonome (pas Avalon).
--
-- Cible immédiate : Micron MT48LC4M32B2 de la Nios Development Board (1C20)
--   4 banques x 4096 lignes x 256 colonnes x 32 bits = 16 MB.
-- Horloge : 50 MHz (période 20 ns) -> toutes les temporisations très relâchées
--   (le chip tient 100-143 MHz). CAS latency = 2. Accès mot unique avec
--   auto-precharge (A10=1) : simple et correct, suffisant pour un Z80.
--
-- Interface utilisateur (synchrone, mono-accès) :
--   - ready=1 en IDLE : le contrôleur peut accepter une requête.
--   - poser req=1 avec we/addr/wdata ; le contrôleur exécute l'accès.
--   - done : impulsion 1 cycle en fin d'accès (pour un READ, rdata est valide
--     au même cycle). Relâcher req après done.
--   - init_done=1 une fois la séquence d'initialisation SDRAM terminée.
--
-- Mapping adresse mot (22 bits) : addr(21..20)=banque, addr(19..8)=ligne(12),
--   addr(7..0)=colonne(8).
--
-- L'horloge physique de la SDRAM (pin L13) est générée AU NIVEAU SUPÉRIEUR
-- (sdram_clk <= not clk) : ce contrôleur ne pilote que les signaux de commande.
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sdram_ctrl is
    generic (
        -- Temporisations en cycles d'horloge (généreuses @ 50 MHz).
        INIT_WAIT  : integer := 5200;   -- >= 100 us avant init
        T_RP       : integer := 3;      -- precharge -> cmd
        T_RCD      : integer := 3;      -- active -> read/write
        T_RC       : integer := 8;      -- refresh / active cycle
        T_MRD      : integer := 3;      -- load mode register
        CAS_LAT    : integer := 2;      -- latence CAS
        T_WR       : integer := 3;      -- write recovery + precharge
        REFRESH_INT: integer := 700     -- intervalle auto-refresh (<15.6 us)
    );
    port (
        clk       : in  std_logic;
        rst       : in  std_logic;      -- reset synchrone, actif haut
        -- interface utilisateur
        req       : in  std_logic;
        we        : in  std_logic;
        ben       : in  std_logic_vector(3 downto 0) := "1111";  -- octets à écrire (1=écrit)
        addr      : in  std_logic_vector(21 downto 0);
        wdata     : in  std_logic_vector(31 downto 0);
        rdata     : out std_logic_vector(31 downto 0);
        done      : out std_logic;
        ready     : out std_logic;
        init_done : out std_logic;
        -- broches SDRAM
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

architecture rtl of sdram_ctrl is

    -- Commandes SDRAM encodées (ras_n, cas_n, we_n) ; cs_n=0 sauf INHIBIT.
    -- NOP=111, ACTIVE=011, READ=101, WRITE=100, PRECHARGE=010,
    -- AUTO_REFRESH=001, LOAD_MODE=000.
    type state_t is (
        S_RESET, S_INITWAIT, S_PRECHARGE_ALL, S_TRP,
        S_REFRESH_INIT, S_TRC_INIT, S_LOADMODE, S_TMRD,
        S_IDLE, S_ACTIVE, S_TRCD, S_READ, S_CASWAIT, S_READCAP, S_RDWAIT,
        S_WRITE, S_WRWAIT, S_DEASSERT, S_REFRESH, S_TRC
    );
    signal state : state_t := S_RESET;

    signal cnt        : integer range 0 to INIT_WAIT := 0;  -- compteur d'attente
    signal refcnt     : integer range 0 to REFRESH_INT := 0; -- timer refresh
    signal ref_due    : std_logic := '0';
    signal init_refs  : integer range 0 to 8 := 0;          -- 8 refresh d'init

    -- requête latchée
    signal a_bank : std_logic_vector(1 downto 0);
    signal a_row  : std_logic_vector(11 downto 0);
    signal a_col  : std_logic_vector(11 downto 0);
    signal r_we   : std_logic;
    signal r_ben  : std_logic_vector(3 downto 0);
    signal r_wd   : std_logic_vector(31 downto 0);

    -- registres de commande
    signal cmd     : std_logic_vector(2 downto 0); -- ras,cas,we
    signal cs_n_i  : std_logic;
    signal dq_drive: std_logic;                    -- 1 = on pilote DQ (write)
    signal dq_out  : std_logic_vector(31 downto 0);

    constant MODE_REG : std_logic_vector(11 downto 0) := "000000100000"; -- CL2, BL1, séquentiel
begin

    -- Sorties de commande
    sd_cs_n  <= cs_n_i;
    sd_ras_n <= cmd(2);
    sd_cas_n <= cmd(1);
    sd_we_n  <= cmd(0);
    sd_cke   <= '1';
    sd_dq    <= dq_out when dq_drive = '1' else (others => 'Z');
    ready    <= '1' when state = S_IDLE else '0';

    -- Timer de rafraîchissement
    process(clk)
    begin
        if rising_edge(clk) then
            if rst = '1' then
                refcnt  <= 0;
                ref_due <= '0';
            else
                if state = S_REFRESH then
                    refcnt  <= 0;
                    ref_due <= '0';
                elsif refcnt = REFRESH_INT then
                    ref_due <= '1';
                else
                    refcnt <= refcnt + 1;
                end if;
            end if;
        end if;
    end process;

    -- FSM principale
    process(clk)
    begin
        if rising_edge(clk) then
            -- valeurs par défaut chaque cycle
            cmd      <= "111";        -- NOP
            cs_n_i   <= '0';
            dq_drive <= '0';
            sd_a     <= (others => '0');
            sd_ba    <= (others => '0');
            sd_dqm   <= (others => '1');
            done     <= '0';

            if rst = '1' then
                state     <= S_RESET;
                cnt       <= 0;
                init_refs <= 0;
                init_done <= '0';
            else
                case state is

                    when S_RESET =>
                        init_done <= '0';
                        cnt       <= 0;
                        state     <= S_INITWAIT;

                    -- attente >=100us, CKE haut, NOP
                    when S_INITWAIT =>
                        if cnt = INIT_WAIT then
                            cnt   <= 0;
                            state <= S_PRECHARGE_ALL;
                        else
                            cnt <= cnt + 1;
                        end if;

                    when S_PRECHARGE_ALL =>
                        cmd     <= "010";          -- PRECHARGE
                        sd_a(10)<= '1';            -- toutes banques
                        cnt     <= 0;
                        state   <= S_TRP;

                    when S_TRP =>
                        if cnt = T_RP then
                            cnt       <= 0;
                            init_refs <= 0;
                            state     <= S_REFRESH_INIT;
                        else
                            cnt <= cnt + 1;
                        end if;

                    when S_REFRESH_INIT =>
                        cmd   <= "001";            -- AUTO_REFRESH
                        cnt   <= 0;
                        state <= S_TRC_INIT;

                    when S_TRC_INIT =>
                        if cnt = T_RC then
                            cnt <= 0;
                            if init_refs = 7 then
                                state <= S_LOADMODE;
                            else
                                init_refs <= init_refs + 1;
                                state     <= S_REFRESH_INIT;
                            end if;
                        else
                            cnt <= cnt + 1;
                        end if;

                    when S_LOADMODE =>
                        cmd   <= "000";            -- LOAD MODE REGISTER
                        sd_a  <= MODE_REG;
                        sd_ba <= "00";
                        cnt   <= 0;
                        state <= S_TMRD;

                    when S_TMRD =>
                        if cnt = T_MRD then
                            cnt       <= 0;
                            init_done <= '1';
                            state     <= S_IDLE;
                        else
                            cnt <= cnt + 1;
                        end if;

                    -- prêt : refresh prioritaire, sinon accès
                    when S_IDLE =>
                        init_done <= '1';
                        if ref_due = '1' then
                            state <= S_REFRESH;
                        elsif req = '1' then
                            a_bank <= addr(21 downto 20);
                            a_row  <= addr(19 downto 8);
                            a_col  <= "0000" & addr(7 downto 0);
                            r_we   <= we;
                            r_ben  <= ben;
                            r_wd   <= wdata;
                            state  <= S_ACTIVE;
                        end if;

                    when S_ACTIVE =>
                        cmd   <= "011";            -- ACTIVE
                        sd_a  <= a_row;
                        sd_ba <= a_bank;
                        cnt   <= 0;
                        state <= S_TRCD;

                    when S_TRCD =>
                        if cnt = T_RCD then
                            cnt <= 0;
                            if r_we = '1' then
                                state <= S_WRITE;
                            else
                                state <= S_READ;
                            end if;
                        else
                            cnt <= cnt + 1;
                        end if;

                    -- READ avec auto-precharge (A10=1)
                    when S_READ =>
                        cmd      <= "101";         -- READ
                        sd_a     <= a_col;
                        sd_a(10) <= '1';           -- auto-precharge
                        sd_ba    <= a_bank;
                        sd_dqm   <= (others => '0');
                        cnt      <= 0;
                        state    <= S_CASWAIT;

                    when S_CASWAIT =>
                        sd_dqm <= (others => '0');
                        if cnt = CAS_LAT - 1 then
                            cnt   <= 0;
                            state <= S_READCAP;
                        else
                            cnt <= cnt + 1;
                        end if;

                    when S_READCAP =>
                        rdata  <= sd_dq;           -- capture donnée
                        done   <= '1';
                        cnt    <= 0;
                        state  <= S_RDWAIT;        -- attendre tRP (auto-precharge)

                    when S_RDWAIT =>
                        if cnt = T_RP then
                            cnt   <= 0;
                            state <= S_DEASSERT;
                        else
                            cnt <= cnt + 1;
                        end if;

                    -- WRITE avec auto-precharge : donnée au cycle de commande
                    when S_WRITE =>
                        cmd      <= "100";         -- WRITE
                        sd_a     <= a_col;
                        sd_a(10) <= '1';           -- auto-precharge
                        sd_ba    <= a_bank;
                        sd_dqm   <= not r_ben;      -- masque : seuls les octets activés
                        dq_drive <= '1';
                        dq_out   <= r_wd;
                        cnt      <= 0;
                        state    <= S_WRWAIT;

                    when S_WRWAIT =>
                        if cnt = T_WR then
                            cnt   <= 0;
                            done  <= '1';
                            state <= S_DEASSERT;
                        else
                            cnt <= cnt + 1;
                        end if;

                    -- Attend que l'utilisateur relâche req (handshake niveau) avant
                    -- d'accepter un nouvel accès -> aucune requête perdue.
                    when S_DEASSERT =>
                        if req = '0' then
                            state <= S_IDLE;
                        end if;

                    when S_REFRESH =>
                        cmd   <= "001";            -- AUTO_REFRESH
                        cnt   <= 0;
                        state <= S_TRC;

                    when S_TRC =>
                        if cnt = T_RC then
                            cnt   <= 0;
                            state <= S_IDLE;
                        else
                            cnt <= cnt + 1;
                        end if;

                end case;
            end if;
        end if;
    end process;

end architecture;
