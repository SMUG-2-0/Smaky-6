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
        DIV_SLOW : integer := 128;    -- demi-période SPI init (~195 kHz @ 50 MHz, marge)
        DIV_FAST : integer := 128     -- demi-période SPI data (= init : fiable sur câble bricolé)
    );
    port (
        clk    : in  std_logic;                       -- 50 MHz
        reset  : in  std_logic;
        -- bus SPI
        cs_n   : out std_logic;
        sclk   : out std_logic;
        mosi   : out std_logic;
        miso   : in  std_logic;
        -- interface lecture / écriture de bloc
        rd_req : in  std_logic;                        -- impulsion : lance une lecture
        wr_req : in  std_logic;                        -- impulsion : lance une écriture
        rd_lba : in  std_logic_vector(31 downto 0);    -- n° de bloc (unités 512 o, SDHC)
        wdata  : in  std_logic_vector(7 downto 0);     -- octet du tampon à l'index bindex (écriture)
        busy   : out std_logic;                        -- accès en cours
        ready  : out std_logic;                        -- carte initialisée
        err    : out std_logic;
        -- flux des 512 octets du bloc lu
        bvalid : out std_logic;                        -- impulsion par octet (remplissage tampon)
        bdata  : out std_logic_vector(7 downto 0);
        bindex : out std_logic_vector(8 downto 0);     -- 0..511 (index lecture ET écriture)
        -- diagnostic
        dbg_state : out std_logic_vector(7 downto 0);  -- (7:4)=état, (3:0)=init_step
        dbg_r1    : out std_logic_vector(7 downto 0)   -- dernière réponse R1 de la carte
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
                      M_INIT_SEQ, M_READY, M_RD_TOKEN, M_RD_DATA, M_RD_CRC,
                      M_WR_TOKEN, M_WR_DATA, M_WR_CRC, M_WR_RESP, M_WR_BUSY, M_WR_DONE,
                      M_RD_RETRY, M_WR_RETRY, M_ERR);
    signal mstate   : mstate_t := M_RST;
    signal retstate : mstate_t := M_RST;        -- où revenir après SENDCMD/GETR1
    signal cmd_buf  : std_logic_vector(47 downto 0);  -- 6 octets de commande
    signal cmd_idx  : integer range 0 to 15 := 0;   -- jusqu'à 10 (powerup) et 6 (commande)
    signal r1       : std_logic_vector(7 downto 0);
    signal extra_n  : integer range 0 to 4 := 0;       -- octets supplémentaires (R3/R7)
    signal poll_cnt : integer range 0 to 65535 := 0;
    signal init_step: integer range 0 to 7 := 0;
    signal byte_idx : integer range 0 to 512 := 0;
    signal rd_tries : integer range 0 to 15 := 0;   -- ré-essais d'un CMD17 qui échoue
    signal wr_tries : integer range 0 to 15 := 0;   -- ré-essais d'un CMD24 dont le token est rejeté
    signal acmd41_tries : integer range 0 to 65535 := 0;

    -- construit une commande SPI : 0x40|cmd, arg(32), crc|0x01
    function mkcmd(cmd : integer; arg : std_logic_vector(31 downto 0); crc : std_logic_vector(7 downto 0))
        return std_logic_vector is
    begin
        return std_logic_vector(to_unsigned(16#40# + cmd, 8)) & arg & crc;
    end function;
begin
    sclk  <= sclk_i;
    dbg_r1 <= r1;
    with mstate select dbg_state(7 downto 4) <=
        "0000" when M_RST,      "0001" when M_POWUP,   "0010" when M_INIT_SEQ,
        "0011" when M_SENDCMD,  "0100" when M_GETR1,   "0101" when M_EXTRA,
        "0110" when M_READY,    "0111" when M_RD_TOKEN,"1000" when M_RD_DATA,
        "1001" when M_RD_CRC,   "1111" when M_ERR,     "1110" when others;
    dbg_state(3 downto 0) <= std_logic_vector(to_unsigned(init_step, 4));
    busy  <= '0' when mstate = M_READY else '1';
    ready <= '1' when (mstate = M_READY or mstate = M_RD_TOKEN or mstate = M_RD_DATA
                       or mstate = M_RD_CRC or mstate = M_WR_TOKEN or mstate = M_WR_DATA
                       or mstate = M_WR_CRC or mstate = M_WR_RESP or mstate = M_WR_BUSY
                       or mstate = M_WR_DONE or mstate = M_RD_RETRY
                       or mstate = M_WR_RETRY) else '0';
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
                            if phase = '0' then           -- front montant : on lève juste l'horloge
                                sclk_i <= '1';
                                phase  <= '1';
                            else                          -- front descendant : MISO stable (période
                                sclk_i <= '0';            -- haute écoulée) -> on l'échantillonne ici
                                phase  <= '0';
                                rx_sh  <= rx_sh(6 downto 0) & miso;
                                if bitc = 0 then
                                    rx_byte  <= rx_sh(6 downto 0) & miso;
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
                                -- pas de R1 : si c'est un CMD17, on ré-essaie ; sinon erreur (init)
                                if retstate = M_RD_TOKEN and rd_tries > 0 then
                                    rd_tries <= rd_tries - 1; cs_n <= '1'; byte_idx <= 0;
                                    mstate <= M_RD_RETRY;
                                else
                                    mstate <= M_ERR;
                                end if;
                            else
                                tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1;
                            end if;
                        end if;

                    when M_EXTRA =>                       -- lit extra_n octets (R3/R7), ignorés
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= extra_n then mstate <= retstate;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    -- ---- lecture / écriture d'un bloc à la demande ----
                    when M_READY =>
                        cs_n <= '1'; fast <= '1';
                        if rd_req = '1' then
                            cs_n <= '0';
                            cmd_buf <= mkcmd(17, rd_lba, x"01"); extra_n <= 0;
                            rd_tries <= 10;                       -- jusqu'à 10 ré-essais du CMD17
                            retstate <= M_RD_TOKEN; mstate <= M_SENDCMD;
                        elsif wr_req = '1' then
                            cs_n <= '0';
                            cmd_buf <= mkcmd(24, rd_lba, x"01"); extra_n <= 0;  -- WRITE_BLOCK
                            wr_tries <= 3;                        -- jusqu'à 3 ré-essais si token rejeté
                            byte_idx <= 0; retstate <= M_WR_TOKEN; mstate <= M_SENDCMD;
                        end if;

                    when M_RD_TOKEN =>                    -- attend le token de données 0xFE
                        cs_n <= '0';
                        if spi_busy = '0' and spi_start = '0' then
                            if rx_byte = x"FE" then byte_idx <= 0; mstate <= M_RD_DATA;
                            elsif poll_cnt >= 2000 then   -- pas de token : on ré-essaie le CMD17
                                if rd_tries > 0 then
                                    rd_tries <= rd_tries - 1; cs_n <= '1'; byte_idx <= 0;
                                    mstate <= M_RD_RETRY;
                                else cs_n <= '1'; mstate <= M_READY; end if;  -- abandon (sert périmé)
                            else tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1; end if;
                        end if;

                    when M_RD_RETRY =>                    -- désélection puis nouvelle tentative de CMD17
                        cs_n <= '1';
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= 3 then
                                cs_n <= '0'; cmd_buf <= mkcmd(17, rd_lba, x"01"); extra_n <= 0;
                                poll_cnt <= 0; retstate <= M_RD_TOKEN; mstate <= M_SENDCMD;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
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

                    -- ---- écriture d'un bloc (CMD24 déjà envoyée) ----
                    when M_WR_TOKEN =>                    -- octet de garde puis token de données 0xFE
                        cs_n <= '0';
                        if spi_busy = '0' and spi_start = '0' then
                            if    byte_idx = 0 then tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= 1;
                            elsif byte_idx = 1 then tx_byte <= x"FE"; spi_start <= '1'; byte_idx <= 2;
                            else  byte_idx <= 0; bindex <= (others => '0'); poll_cnt <= 0;
                                  mstate <= M_WR_DATA; end if;
                        end if;

                    when M_WR_DATA =>                     -- 512 octets depuis le tampon (wdata @ bindex)
                        cs_n   <= '0';
                        bindex <= std_logic_vector(to_unsigned(byte_idx, 9));
                        if spi_busy = '0' and spi_start = '0' then
                            if poll_cnt < 4 then         -- laisse wdata se stabiliser (latence bindex->wdata)
                                poll_cnt <= poll_cnt + 1;
                            elsif byte_idx >= 512 then
                                byte_idx <= 0; mstate <= M_WR_CRC;
                            else
                                tx_byte <= wdata; spi_start <= '1';
                                byte_idx <= byte_idx + 1; poll_cnt <= 0;
                            end if;
                        end if;

                    when M_WR_CRC =>                      -- 2 octets CRC (factices)
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= 2 then poll_cnt <= 0; mstate <= M_WR_RESP;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    when M_WR_RESP =>                     -- token de réponse data (xxx0_0101 = accepté)
                        if spi_busy = '0' and spi_start = '0' then
                            if rx_byte /= x"FF" then         -- token reçu : on en vérifie le verdict
                                r1 <= rx_byte;               -- (diagnostic : visible sur dbg_r1)
                                if (rx_byte and x"1F") = x"05" then  -- 0b???0_0101 = données acceptées
                                    poll_cnt <= 0;           -- on enclenche un transfert pour que
                                    tx_byte <= x"FF"; spi_start <= '1';  -- M_WR_BUSY lise un octet FRAIS
                                    mstate <= M_WR_BUSY;             -- (sinon il consommerait le token,
                                elsif wr_tries > 0 then              --  /= 0x00, et sauterait l'attente busy)
                                    wr_tries <= wr_tries - 1;        -- rejet CRC (0x0B) / write-err (0x0D) :
                                    cs_n <= '1'; byte_idx <= 0; mstate <= M_WR_RETRY;  -- ré-essai du CMD24
                                else
                                    cs_n <= '1'; mstate <= M_ERR;    -- rejet persistant : erreur dure
                                end if;
                            elsif poll_cnt >= 1000 then       -- pas de token : ré-essai, sinon erreur
                                if wr_tries > 0 then
                                    wr_tries <= wr_tries - 1; cs_n <= '1'; byte_idx <= 0;
                                    mstate <= M_WR_RETRY;
                                else cs_n <= '1'; mstate <= M_ERR; end if;
                            else tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1; end if;
                        end if;

                    when M_WR_BUSY =>                     -- la carte tient MISO bas pendant l'écriture
                        if spi_busy = '0' and spi_start = '0' then
                            if rx_byte /= x"00" then cs_n <= '1'; byte_idx <= 0; mstate <= M_WR_DONE;
                            elsif poll_cnt >= 60000 then cs_n <= '1'; byte_idx <= 0; mstate <= M_WR_DONE; -- sécurité (~2,5 s)
                            else tx_byte <= x"FF"; spi_start <= '1'; poll_cnt <= poll_cnt + 1; end if;
                        end if;

                    when M_WR_DONE =>                     -- désélection : CS haut + clocks de garde, sinon
                        cs_n <= '1';                      -- la carte reste occupée et le CMD17 suivant rate
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= 3 then mstate <= M_READY;
                            else tx_byte <= x"FF"; spi_start <= '1'; byte_idx <= byte_idx + 1; end if;
                        end if;

                    when M_WR_RETRY =>                    -- désélection (clocks de garde) puis ré-émission
                        cs_n <= '1';                      -- du CMD24 ; le tampon CPU est ré-envoyé tel quel
                        if spi_busy = '0' and spi_start = '0' then
                            if byte_idx >= 3 then
                                cs_n <= '0'; cmd_buf <= mkcmd(24, rd_lba, x"01"); extra_n <= 0;
                                byte_idx <= 0; poll_cnt <= 0; retstate <= M_WR_TOKEN; mstate <= M_SENDCMD;
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
