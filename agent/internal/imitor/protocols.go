package imitor

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

// parseRESP разбирает один запрос клиента: массив bulk-строк или inline-команду.
// used — сколько байт съедено, needMore — данных пока не хватает. Кадрирование frameRESP превращает результат в строку, с которой работают правила Redis.
func parseRESP(b []byte) (args []string, used int, needMore bool, err error) {
	if len(b) == 0 {
		return nil, 0, true, nil
	}
	if b[0] != '*' {
		i := bytes.IndexByte(b, '\n')
		if i < 0 {
			return nil, 0, true, nil
		}
		line := strings.TrimRight(string(b[:i]), "\r")
		return strings.Fields(line), i + 1, false, nil
	}

	// Массив RESP: *<count>\r\n, затем count элементов $<len>\r\n<data>\r\n.
	i := bytes.IndexByte(b, '\n')
	if i < 0 {
		return nil, 0, true, nil
	}
	count, convErr := strconv.Atoi(strings.TrimRight(string(b[1:i]), "\r"))
	if convErr != nil || count < 0 {
		return nil, 0, false, fmt.Errorf("invalid multibulk length")
	}

	pos := i + 1
	args = make([]string, 0, count)
	for n := 0; n < count; n++ {
		if pos >= len(b) {
			return nil, 0, true, nil
		}
		if b[pos] != '$' {
			return nil, 0, false, fmt.Errorf("expected '$', got '%c'", b[pos])
		}
		j := bytes.IndexByte(b[pos:], '\n')
		if j < 0 {
			return nil, 0, true, nil
		}
		length, convErr := strconv.Atoi(strings.TrimRight(string(b[pos+1:pos+j]), "\r"))
		if convErr != nil || length < 0 {
			return nil, 0, false, fmt.Errorf("invalid bulk length")
		}
		start := pos + j + 1
		if len(b) < start+length+2 {
			return nil, 0, true, nil
		}
		args = append(args, string(b[start:start+length]))
		pos = start + length + 2
	}
	return args, pos, false, nil
}

// Флаги возможностей клиента, которые сервер объявляет в приветствии MySQL.
const (
	mysqlClientLongPassword               = 0x00000001
	mysqlClientLongFlag                   = 0x00000004
	mysqlClientConnectWithDB              = 0x00000008
	mysqlClientProtocol41                 = 0x00000200
	mysqlClientTransactions               = 0x00002000
	mysqlClientSecureConnection           = 0x00008000
	mysqlClientPluginAuth                 = 0x00080000
	mysqlClientPluginAuthLenEncClientData = 0x00200000
	mysqlClientDeprecateEOF               = 0x01000000
)

const mysqlErrAccessDenied = 1045

// mysqlHandler отдаёт приветствие MySQL и на любую попытку входа отвечает ошибкой "Access denied".
type mysqlHandler struct {
	opts    handlerOpts
	version string
}

func newMySQLHandler(opts handlerOpts, params map[string]string) *mysqlHandler {
	return &mysqlHandler{
		opts:    opts,
		version: param(params, "server_version", "8.0.35"),
	}
}

func (h *mysqlHandler) Serve(s *Session) {
	if h.opts.initial > 0 {
		s.Sleep(h.opts.initial, 0)
	}
	if err := s.Send(h.greeting(0)); err != nil {
		return
	}

	first := true
	for {
		s.SetReadDeadline(h.opts.idle)
		seq, payload, err := readMySQLPacket(s, 1<<20)
		if err != nil {
			return
		}
		if h.opts.logInput {
			s.Log("input", "", map[string]string{
				"hex": hexPrefix(payload, 256),
				"len": strconv.Itoa(len(payload)),
			})
		}

		// Первый пакет клиента — ответ на приветствие, из него достаём логин.
		user := ""
		if first {
			user = mysqlUsername(payload)
			s.Log("rule", "handshake_response", map[string]string{"username": truncate(user, 512)})
			first = false
		}

		s.Sleep(h.opts.baseDelay, h.opts.jitter)
		msg := fmt.Sprintf("Access denied for user '%s'@'%s' (using password: YES)", user, hostOnly(s.Src))
		if err := s.Send(mysqlErrPacket(seq+1, mysqlErrAccessDenied, "28000", msg)); err != nil {
			return
		}
	}
}

// greeting собирает пакет приветствия сервера (протокол 10).
func (h *mysqlHandler) greeting(seq byte) []byte {
	caps := uint32(mysqlClientLongPassword | mysqlClientLongFlag | mysqlClientConnectWithDB |
		mysqlClientProtocol41 | mysqlClientTransactions | mysqlClientSecureConnection |
		mysqlClientPluginAuth | mysqlClientPluginAuthLenEncClientData | mysqlClientDeprecateEOF)

	var p bytes.Buffer
	p.WriteByte(0x0a) // версия протокола 10
	p.WriteString(h.version)
	p.WriteByte(0)
	_ = binary.Write(&p, binary.LittleEndian, uint32(time.Now().UnixNano()&0x7fffffff)) // id потока
	p.WriteString("abcdefgh")                                                           // auth-plugin-data, часть 1
	p.WriteByte(0)
	_ = binary.Write(&p, binary.LittleEndian, uint16(caps&0xffff))
	p.WriteByte(0x21)                                         // кодировка: utf8_general_ci
	_ = binary.Write(&p, binary.LittleEndian, uint16(0x0002)) // статус: autocommit
	_ = binary.Write(&p, binary.LittleEndian, uint16(caps>>16))
	p.WriteByte(21) // длина auth-plugin-data
	p.Write(make([]byte, 10))
	p.WriteString("ijklmnopqrst") // auth-plugin-data, часть 2 (12 байт + NUL)
	p.WriteByte(0)
	p.WriteString("mysql_native_password")
	p.WriteByte(0)

	return frameMySQLPacket(seq, p.Bytes())
}

// readMySQLPacket читает один пакет: 3 байта длины + 1 байт номера + данные.
func readMySQLPacket(s *Session, max int) (seq byte, payload []byte, err error) {
	var hdr [4]byte
	if _, err = io.ReadFull(s.conn, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := int(hdr[0]) | int(hdr[1])<<8 | int(hdr[2])<<16
	seq = hdr[3]
	if n > max {
		return 0, nil, fmt.Errorf("mysql packet too large: %d", n)
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(s.conn, payload); err != nil {
		return 0, nil, err
	}
	return seq, payload, nil
}

func frameMySQLPacket(seq byte, payload []byte) []byte {
	out := make([]byte, 4+len(payload))
	out[0] = byte(len(payload))
	out[1] = byte(len(payload) >> 8)
	out[2] = byte(len(payload) >> 16)
	out[3] = seq
	copy(out[4:], payload)
	return out
}

func mysqlErrPacket(seq byte, code uint16, sqlState, msg string) []byte {
	var p bytes.Buffer
	p.WriteByte(0xff)
	_ = binary.Write(&p, binary.LittleEndian, code)
	p.WriteByte('#')
	p.WriteString(sqlState)
	p.WriteString(msg)
	return frameMySQLPacket(seq, p.Bytes())
}

func mysqlUsername(payload []byte) string {
	if len(payload) < 33 {
		return ""
	}
	off := 4 + 4 + 1 + 23 // caps + max packet + charset + reserved
	end := bytes.IndexByte(payload[off:], 0)
	if end < 0 {
		return string(payload[off:])
	}
	return string(payload[off : off+end])
}

// --- PostgreSQL ---

// Специальные коды первых пакетов PostgreSQL (StartupMessage и служебные запросы).
const (
	pgProtocolV3    = 0x00030000
	pgCancelRequest = 80877102
	pgSSLRequest    = 80877103
	pgGSSRequest    = 80877104

	pgAuthenticationCleartextPassword = 3
	pgErrInvalidPassword              = "28P01"
)

// postgresHandler эмулирует PostgreSQL: читает стартовый пакет, запрашивает пароль
// в открытом виде и на любой вход отвечает FATAL "password authentication failed".
type postgresHandler struct {
	opts handlerOpts
}

func newPostgresHandler(opts handlerOpts, _ map[string]string) *postgresHandler {
	return &postgresHandler{opts: opts}
}

func (h *postgresHandler) Serve(s *Session) {
	if h.opts.initial > 0 {
		s.Sleep(h.opts.initial, 0)
	}

	payload, code, err := readPostgresStartup(s, 1<<20)
	if err != nil {
		return
	}
	switch code {
	case pgSSLRequest, pgGSSRequest:
		// Шифрование не поддерживаем: 'N' заставляет клиента продолжить без TLS.
		if err := s.Send([]byte{'N'}); err != nil {
			return
		}
		payload, code, err = readPostgresStartup(s, 1<<20)
		if err != nil {
			return
		}
	}
	if code == pgCancelRequest {
		s.Log("rule", "cancel_request", nil)
		return
	}
	if code != pgProtocolV3 && code>>16 != 3 {
		s.Log("overflow", "", map[string]string{"reason": "unexpected startup code", "code": strconv.FormatUint(uint64(code), 10)})
		return
	}

	params := parsePostgresStartup(payload)
	meta := map[string]string{
		"username":         truncate(params["user"], 512),
		"database":         truncate(params["database"], 512),
		"application_name": truncate(params["application_name"], 512),
	}
	if h.opts.logInput {
		s.Log("input", "", map[string]string{
			"proto":            "startup",
			"user":             meta["username"],
			"database":         meta["database"],
			"application_name": meta["application_name"],
		})
	}
	s.Log("rule", "startup", meta)

	if err := s.Send(pgAuthCleartext()); err != nil {
		return
	}

	for {
		typ, msg, err := readPostgresMessage(s, 1<<20)
		if err != nil {
			return
		}
		switch typ {
		case 'p': // PasswordMessage
			password := postgresCString(msg)
			s.Sleep(h.opts.baseDelay, h.opts.jitter)
			s.Log("auth", "password", map[string]string{
				"username": meta["username"],
				"password": truncate(password, 512),
			})
			_ = s.Send(pgErrorResponse("FATAL", pgErrInvalidPassword,
				fmt.Sprintf("password authentication failed for user \"%s\"", meta["username"])))
			return
		case 'X': // Terminate
			return
		default:
			if h.opts.logInput {
				s.Log("input", "", map[string]string{"type": string(typ), "len": strconv.Itoa(len(msg))})
			}
		}
	}
}

// readPostgresStartup читает стартовый пакет: 4 байта длины и код (версию протокола или служебный запрос).
func readPostgresStartup(s *Session, max int) (payload []byte, code uint32, err error) {
	var hdr [4]byte
	if _, err = io.ReadFull(s.conn, hdr[:]); err != nil {
		return nil, 0, err
	}
	n := int(binary.BigEndian.Uint32(hdr[:]))
	if n < 8 || n > max {
		return nil, 0, fmt.Errorf("postgres startup length out of range: %d", n)
	}
	body := make([]byte, n-4)
	if _, err = io.ReadFull(s.conn, body); err != nil {
		return nil, 0, err
	}
	return body[4:], binary.BigEndian.Uint32(body[:4]), nil
}

// readPostgresMessage читает обычное сообщение: байт типа, 4 байта длины, полезная нагрузка.
func readPostgresMessage(s *Session, max int) (typ byte, payload []byte, err error) {
	var hdr [5]byte
	if _, err = io.ReadFull(s.conn, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := int(binary.BigEndian.Uint32(hdr[1:]))
	if n < 4 || n > max {
		return 0, nil, fmt.Errorf("postgres message length out of range: %d", n)
	}
	payload = make([]byte, n-4)
	if _, err = io.ReadFull(s.conn, payload); err != nil {
		return 0, nil, err
	}
	return hdr[0], payload, nil
}

// parsePostgresStartup разбирает пары ключ/значение стартового пакета.
func parsePostgresStartup(b []byte) map[string]string {
	params := make(map[string]string)
	for len(b) > 1 {
		key, rest, ok := postgresCutString(b)
		if !ok || key == "" {
			break
		}
		val, rest, ok := postgresCutString(rest)
		if !ok {
			break
		}
		params[key] = val
		b = rest
	}
	return params
}

func postgresCutString(b []byte) (string, []byte, bool) {
	i := bytes.IndexByte(b, 0)
	if i < 0 {
		return "", nil, false
	}
	return string(b[:i]), b[i+1:], true
}

func postgresCString(b []byte) string {
	if i := bytes.IndexByte(b, 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

// pgAuthCleartext — AuthenticationCleartextPassword (запрос пароля в открытом виде).
func pgAuthCleartext() []byte {
	b := make([]byte, 9)
	b[0] = 'R'
	binary.BigEndian.PutUint32(b[1:5], 8)
	binary.BigEndian.PutUint32(b[5:9], pgAuthenticationCleartextPassword)
	return b
}

// pgErrorResponse собирает ErrorResponse с полями severity, SQLSTATE и сообщением.
func pgErrorResponse(severity, code, message string) []byte {
	var body bytes.Buffer
	for _, f := range []struct {
		typ byte
		val string
	}{
		{'S', severity},
		{'V', severity},
		{'C', code},
		{'M', message},
		{'F', "auth.c"},
		{'R', "auth_failed"},
	} {
		body.WriteByte(f.typ)
		body.WriteString(f.val)
		body.WriteByte(0)
	}
	body.WriteByte(0)

	out := make([]byte, 5+body.Len())
	out[0] = 'E'
	binary.BigEndian.PutUint32(out[1:5], uint32(4+body.Len()))
	copy(out[5:], body.Bytes())
	return out
}

func hostOnly(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// hexPrefix кодирует первые n байт в hex для журнала.
func hexPrefix(b []byte, n int) string {
	if len(b) > n {
		b = b[:n]
	}
	return hex.EncodeToString(b)
}
