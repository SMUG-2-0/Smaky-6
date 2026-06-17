-- ---------------------------------------------------------------------------
-- sd_spi.vhd — lecteur de carte micro-SD en mode SPI (lecture de blocs 512 o).
--
-- Séquence d'init : 80+ clocks CS haut, CMD0 (idle), CMD8 (if-cond), ACMD41
-- (CMD55+ACMD41, HCS) jusqu'à prêt, CMD58 (OCR -> CCS = adressage bloc/octet).
-- Lecture : CMD17 (READ_SINGLE_BLOCK) -> attente token 0xFE -> 512 o -> 2 CRC.
--
-- Horloge SPI lente (~390 kHz) pendant l'init (exigé par la spec), rapide
-- (~6 MHz) ensuite. SPI mode 0. Sortie en flux : bvalid/bdata/bindex (0..511).
--
-- NOTE : module à roder sur matériel (les cartes SD sont capricieuses).
-- ---------------------------------------------------------------------------
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sd_spi is
    generic (
        DIV_SLOW : integer := 64;     -- demi-période SPI init (~390 kHz @ 50 MHz)
        DIV_FAST : integer := 4       -- demi-période SPI data (~6 MHz)
    );
    port (
        clk    : in  std_logic;                       -- 50 MHz
        reset  : in  std_logic;
        -- bus SPI
        cs_n   : out std_logic;
        sclk   : out std_logic;
        mosi   : out std_logic;
        miso   : in  std_logic;
        -- interface lecture de bloc
        rd_req : in  std_logic;                        -- impulsion : lance une lecture
        rd_lba : in  std_logic_vector(31 downto 0);    -- n° de bloc (unités 512 o, SDHC)
        busy   : out std_logic;                        -- lecture en cours
        ready  : out std_logic;                        -- carte initialisée
        err    : out std_logic;
        -- flux des 512 octets du bloc
        bvalid : out std_logic;                        -- impulsion par octet
        bdata  : out std_logic_vector(7 downto 0);
        bindex : out std_logic_vector(8 downto 0)      -- 0..511
    );
end entity;

architecture rtl of sd_spi is
    -- ----- moteur de transfert d'octet SPI -----
    type sstate_t is (SP_IDLE, SP_RUN);
    signal sstate  : sstate_t := SP_IDLE;
    signal spi_start : std_logic := '0';
    signal spi_busy  : std_logic := '0';
    signal tx_byte   : std_logic_vector(7 downto 0) := (others => '1');
    signal rx_byte   : std_logic_vector(7 downto 0) := (others => '0');
    signal rx_sh     : std_logic_vector(7 downto 0);
    signal bitc      : integer range 0 to 7 := 7;
    signal phase     : std_logic := '0';
    signal divcnt    : integer range 0 to 65535 := 0;
    signal fast      : std_logic := '0';   -- horloge rapide après init
    signal sclk_i    : std_logic := '0';

    -- ----- FSM principale -----
    type mstate_t is (M_RST, M_POWUP, M_SENDCMD, M_GETR1, M_EXTRA,
                      M_INIT_SEQ, M_READY, M_RD_TOKEN, M_RD_DATA, M_RD_CRC, M_ERR);
    signal mstate   : mstate_t := M_RST;
    signal retstate : mstate_t := M_RST;        -- où revenir après SENDCMD/GETR1
    signal cmd_buf  : std_logic_vector(47 downto 0);  -- 6 octets de commande
    signal cmd_idx  : integer range 0 to 6 := 0;
    signal r1       : std_logic_vector(7 downto 0);
    signal extra_n  : integer range 0 to 4 := 0;       -- octets supplémentaires (R3/R7)
    signal poll_cnt : integer range 0 to 65535 := 0;
    signal init_step: integer range 0 to 7 := 0;
    signal byte_idx : integer range 0 to 512 := 0;
    signal acmd41_tries : integer range 0 to 65535 := 0;

    -- construit une commande SPI : 0x40|cmd, arg(32), crc|0x01
    function mkcmd(cmd : integer; arg : std_logic_vector(31 downto 0); crc : std_logic_vector(7 downto 0))
        return std_logic_vector is
    begin
        return std_logic_vector(to_unsigned(16#40# + cmd, 8)) & arg & crc;
    end function;
begin
    sclk  <= sclk_i;
    busy  <= '0' when mstate = M_READY else '1';
    ready <= '1' when (mstate = M_READY or mstate = M_RD_TOKEN or mstate = M_RD_DATA
                       or mstate = M_RD_CRC) else '0';
    err   <= '1' when mstate = M_ERR else '0';

    -- ============ moteur SPI : transfère tx_byte, reçoit rx_byte ============
    process(clk)
        variable hp : integer;
    begin
        if rising_edge(clk) then
            if reset = '1' then
                sstate <= SP_IDLE; spi_busy <= '0'; sclk_i <= '0'; mosi <= '1';
            else
                if fast = '1' then hp := DIV_FAST; else hp := DIV_SLOW; end if;
                case sstate is
                    when SP_IDLE =>
                        if spi_start = '1' then
                            bitc <= 7; phase <= '0'; divcnt <= 0;
                            sclk_i <= '0'; mosi <= tx_byte(7);
                            spi_busy <= '1'; sstate <= SP_RUN;
                        end if;
                    when SP_RUN =>
                        if divcnt >= hp - 1 then
                            divcnt <= 0;
                            if phase = '0' then           -- front montant : échantillonne MISO
                                sclk_i <= '1';
                                rx_sh  <= rx_sh(6 downto 0) & miso;
                                phase  <= '1';
                            else                          -- front descendant : bit suivant
                                sclk_i <= '0';
                                phase  <= '0';
                                if bitc = 0 then
                                    rx_byte  <= rx_sh;
                                    spi_busy <= '0';
                                    sstate   <= SP_IDLE;
                                else
                                    bitc <= bitc - 1;
                                    mosi <= tx_byte(bitc - 1);
                                end if;
                            end if;
                        else
                            divcnt <= divcnt + 1;
                        end if;
                end case;
            end if;
        end if;
    end process;

    -- ===================== FSM principale (init + lecture) =====================
    process(clk)
    begin
        if rising_edge(clk) then
            if reset = '1' then
                mstate <= M_RST; cs_n <= '1'; fast <= '0'; spi_start <= '0';
                bvalid <= '0'; init_step <= 0; acmd41_tries <= 0;
            else
                spi_start <= '0';
                bvalid    <= '0';
                case mstate is

                    when M_RST =>
                        cs_n <= '1'; fast <= '0'; cmd_idx <= 0; poll_cnt <= 0;
                        mstate <= M_POWUP;

                    when M_POWUP =>                      -- 80 clocks CS haut, MOSI haut
                        cs_n <= '1';
                        if spi_busy = '0' and spi_start = '0' then
                            if cmd_idx >= 10 then        -- 10 octets = 80 clocks
                                cmd_idx <= 0; init_step <= 0; mstate <= M_INIT_SEQ;
                            else
                                tx_byte <= x"FF"; spi_start <= '1'; cmd_idx <= cmd_idx + 1;
                            end if;
                        end if;

                    -- ---- séquence d'init : enchaîne CMD0, CMD8, ACMD41..., CMD58 ----
                    when M_INIT_SEQ =>
                        cs_n <= '0';
                        case init_step is
                            when 0 => cmd_buf <= mkcmd(0,  x"00000000", x"95"); extra_n <= 0; -- CMD0
                                      retstate <= M_INIT_SEQ; init_step <= 1; mstate <= M_SENDCMD;
                            when 1 => cmd_buf <= mkcmd(8,  x"000001AA", x"87"); extra_n <= 4; -- CMD8
                                      retstate <= M_INIT_SEQ; init_step <= 2; mstate <= M_SENDCMD;
                            when 2 => cmd_buf <= mkcmd(55, x"00000000", x"01"); extra_n <= 0; -- CMD55
                                      retstate <= M_INIT_SEQ; init_step <= 3; mstate <= M_SENDCMD;
                            when 3 => cmd_buf <= mkcmd(41, x"40000000", x"01"); extra_n <= 0; -- ACMD41 (HCS)
                                      retstate <= M_INIT_SEQ; init_step <= 4; mstate <= M_SENDCMD;
                            when 4 =>                     -- ACMD41 prêt ? r1=0x00, sinon reboucle
                                      if r1 = x"00" then init_step <= 5;
                                      elsif acmd41_tries >= 20000 then mstate <= M_ERR;
                                      else acmd41_tries <= acmd41_tries + 1; init_step <= 2; end if;
                            when 5 => cmd_buf <= mkcmd(58, x"00000000", x"01"); extra_n <= 4; -- CMD58 (OCR)
                                      retstate <= M_INIT_SEQ; init_step <= 6; mstate <= M_SENDCMD;
                            when others =>                -- init terminée
                                      fast <= '1'; cs_n <= '1'; mstate <= M_READY;
                        end case;

                    -- ---- envoi des 6 octets de cmd_buf, puis attente R1 ----
                    when M_SENDCMD =>
                        cs_n <= '0';
                        if spi_busy = '0' and spi_start = '0' then
                            if cmd_idx >= 6 then
                                cmd_idx <= 0; poll_cnt <= 0; mstate <= M_GETR1;
                            else
                                tx_byte <= cmd_buf(47 downto 40);          -- octet de poids fort
                                cmd_buf <= cmd_buf(39 downto 0) & x"FF";   -- décale à gauche
                                spi_start <= '1'; cmd_idx <= cmd_idx + 1;
                            end if;
                        end if;

                    when M_GETR1 =>                       -- poll jusqu'à un octet bit7=0
                        if spi_busy = '0' and spi_start = '0' then
                            if rx_byte(7) = '0' then
                                r1 <= rx_byte;
                                if extra_n > 0 then byte_idx <= 0; mstate <= M_EXTRA;
                                else mstate <= retstate; end if;
                            elsif poll_cnt >= 1000 then
                                mstate <= M_ERR;
                            else
                                tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1;
                            end if;
                        end if;

                    when M_EXTRA =>                       -- lit extra_n octets (R3/R7), ignorés
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= extra_n then mstate <= retstate;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    -- ---- lecture d'un bloc à la demande ----
                    when M_READY =>
                        cs_n <= '1'; fast <= '1';
                        if rd_req = '1' then
                            cs_n <= '0';
                            cmd_buf <= mkcmd(17, rd_lba, x"01"); extra_n <= 0;
                            retstate <= M_RD_TOKEN; mstate <= M_SENDCMD;
                        end if;

                    when M_RD_TOKEN =>                    -- attend le token de données 0xFE
                        cs_n <= '0';
                        if spi_busy = '0' and spi_start = '0' then
                            if rx_byte = x"FE" then byte_idx <= 0; mstate <= M_RD_DATA;
                            elsif poll_cnt >= 20000 then mstate <= M_ERR;
                            else tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1; end if;
                        end if;

                    when M_RD_DATA =>                     -- 512 octets de données
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx > 0 then          -- octet précédent dispo dans rx_byte
                                bdata  <= rx_byte;
                                bindex <= std_logic_vector(to_unsigned(byte_idx - 1, 9));
                                bvalid <= '1';
                            end if;
                            if byte_idx >= 512 then byte_idx <= 0; mstate <= M_RD_CRC;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    when M_RD_CRC =>                      -- 2 octets CRC, ignorés
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= 2 then cs_n <= '1'; poll_cnt <= 0; mstate <= M_READY;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    when M_ERR =>
                        cs_n <= '1'; fast <= '0';
                        -- reste en erreur (diagnostic) ; un reset relance

                    when others => mstate <= M_RST;
                end case;
            end if;
        end if;
    end process;
end architecture;
