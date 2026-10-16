package imitor

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"
	"testing/synctest"
	"time"
)

func TestSessionSleepCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		server, client := net.Pipe()
		defer server.Close()
		defer client.Close()
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		sess := newSession(server, "test", "medium", NewLogger(io.Discard))
		start := time.Now()
		sess.Sleep(5*time.Second, 0)
		if elapsed := time.Since(start); elapsed != 5*time.Second {
			t.Fatalf("uncanceled sleep lasted %s", elapsed)
		}
		sess.done = ctx.Done()
		done := make(chan struct{})
		go func() { sess.Sleep(24*time.Hour, 0); close(done) }()
		synctest.Wait()
		select {
		case <-done:
			t.Fatal("sleep returned before cancellation")
		default:
		}
		cancel()
		synctest.Wait()
		select {
		case <-done:
		default:
			t.Fatal("sleep ignored cancellation")
		}
	})
}

// TestUnescape проверяет раскрытие escape-последовательностей в ответах.
func TestUnescape(t *testing.T) {
	cases := map[string]string{
		`a\r\nb`:      "a\r\nb",
		`\x41\x42`:    "AB",
		`plain`:       "plain",
		`tab\there`:   "tab\there",
		`back\\slash`: `back\slash`,
		// неизвестные последовательности сохраняются
		`say \"hi\"`: `say \"hi\"`,
	}
	for in, want := range cases {
		if got := unescape(in); got != want {
			t.Errorf("unescape(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpand(t *testing.T) {
	got := expand([]byte("hi {name}, tag {tag}"), map[string]string{"name": "bob", "tag": "a1"})
	if string(got) != "hi bob, tag a1" {
		t.Fatalf("expand = %q", got)
	}
}

// TestRuleStateMachine проверяет машину состояний правил: set_state/clear_state.
func TestRuleStateMachine(t *testing.T) {
	rules, err := compileRules([]Rule{
		{Name: "user", Pattern: `^USER (\S+)$`, Response: `331 ok\r\n`, Capture: []string{"username"}, SetState: "pass"},
		{Name: "pass", On: "pass", Pattern: `^PASS (\S+)$`, Response: `230 ok\r\n`, Capture: []string{"password"}, ClearState: true},
		{Name: "unknown", Pattern: ``, Response: `500 nope\r\n`},
	})
	if err != nil {
		t.Fatal(err)
	}

	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	logger := NewLogger(io.Discard)
	sess := newSession(server, "test", "medium", logger)
	rs := newRuleState(rules)

	step := func(line, want string) {
		t.Helper()
		type result struct {
			out string
			err error
		}
		ch := make(chan result, 1)
		go func() {
			buf := make([]byte, 256)
			n, err := client.Read(buf)
			ch <- result{string(buf[:n]), err}
		}()
		rs.fire(sess, rules, line, 0, 0, false)
		select {
		case r := <-ch:
			if r.err != nil {
				t.Fatalf("read %q: %v", line, r.err)
			}
			if r.out != want {
				t.Fatalf("line %q: got %q, want %q", line, r.out, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("timeout after %q", line)
		}
	}

	step("USER bob", "331 ok\r\n")
	step("PASS secret", "230 ok\r\n")
	step("USER alice", "331 ok\r\n")
	step("PASS secret", "230 ok\r\n")
	step("garbage", "500 nope\r\n")
}

func TestParseRESP(t *testing.T) {
	args, used, needMore, err := parseRESP([]byte("*2\r\n$4\r\nAUTH\r\n$3\r\nfoo\r\n"))
	if err != nil || needMore {
		t.Fatalf("err=%v needMore=%v", err, needMore)
	}
	if len(args) != 2 || args[0] != "AUTH" || args[1] != "foo" {
		t.Fatalf("args = %#v", args)
	}
	if used != len("*2\r\n$4\r\nAUTH\r\n$3\r\nfoo\r\n") {
		t.Fatalf("used = %d", used)
	}

	if _, _, needMore, err := parseRESP([]byte("*2\r\n$4\r\nAUTH\r\n")); err != nil || !needMore {
		t.Fatalf("partial request: err=%v needMore=%v", err, needMore)
	}

	args, _, _, err = parseRESP([]byte("PING\r\n"))
	if err != nil || len(args) != 1 || args[0] != "PING" {
		t.Fatalf("inline: args=%#v err=%v", args, err)
	}

	if _, _, _, err := parseRESP([]byte("*1\r\nx\r\n")); err == nil {
		t.Fatal("expected protocol error")
	}
}

func TestMySQLUsername(t *testing.T) {
	payload := make([]byte, 32)
	copy(payload, []byte{0x00, 0x02, 0x00, 0x00})
	payload = append(payload, []byte("root\x00mysql_native_password\x00")...)
	if got := mysqlUsername(payload); got != "root" {
		t.Fatalf("mysqlUsername = %q", got)
	}
	if got := mysqlUsername([]byte("short")); got != "" {
		t.Fatalf("mysqlUsername(short) = %q", got)
	}
}

// TestPostgresHandler проверяет medium lvl: отказ от TLS, запрос пароля, захват кредов и FATAL-ответ.
func TestPostgresHandler(t *testing.T) {
	server, client := net.Pipe()
	t.Cleanup(func() { server.Close(); client.Close() })

	var logs bytes.Buffer
	logger := NewLogger(&logs)
	h := newPostgresHandler(optsFrom(ServiceConfig{}), nil)

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.Serve(newSession(server, "postgres", "medium", logger))
	}()

	readN := func(n int) []byte {
		t.Helper()
		buf := make([]byte, n)
		client.SetReadDeadline(time.Now().Add(2 * time.Second))
		if _, err := io.ReadFull(client, buf); err != nil {
			t.Fatalf("read %d bytes: %v", n, err)
		}
		return buf
	}
	write := func(b []byte) {
		t.Helper()
		if _, err := client.Write(b); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	// SSLRequest → сервер отказывается от TLS.
	write(pgTestSSLRequest())
	if got := readN(1)[0]; got != 'N' {
		t.Fatalf("SSLRequest reply = %q, want 'N'", got)
	}

	// StartupMessage → запрос пароля.
	write(pgTestStartup("postgres", "appdb", "psql"))
	auth := readN(9)
	if auth[0] != 'R' || binary.BigEndian.Uint32(auth[5:9]) != pgAuthenticationCleartextPassword {
		t.Fatalf("auth request = % x", auth)
	}

	// PasswordMessage → ErrorResponse с 28P01.
	write(pgTestPassword("s3cr3t"))
	hdr := readN(5)
	if hdr[0] != 'E' {
		t.Fatalf("error header = % x", hdr)
	}
	body := readN(int(binary.BigEndian.Uint32(hdr[1:5])) - 4)
	if !bytes.Contains(body, []byte(pgErrInvalidPassword)) ||
		!bytes.Contains(body, []byte(`password authentication failed for user "postgres"`)) {
		t.Fatalf("error body = %q", body)
	}

	<-done
	out := logs.String()
	for _, want := range []string{`"event":"auth"`, `"username":"postgres"`, `"password":"s3cr3t"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("log missing %s:\n%s", want, out)
		}
	}
}

// TestPostgresLowLevelBanner проверяет low lvl: только баннер без протокольной логики.
func TestPostgresLowLevelBanner(t *testing.T) {
	logger := NewLogger(io.Discard)
	svc, err := NewService(ServiceConfig{Type: "postgres", Level: "low", Listen: "127.0.0.1:0"}, logger)
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	t.Cleanup(func() { server.Close(); client.Close() })
	go svc.handler.Serve(newSession(server, "postgres", "low", logger))

	client.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 256)
	n, err := client.Read(buf)
	if err != nil || !strings.HasPrefix(string(buf[:n]), "PostgreSQL 16.3 ") {
		t.Fatalf("low banner = %q, err %v", buf[:n], err)
	}
}

func pgTestSSLRequest() []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint32(b[0:4], 8)
	binary.BigEndian.PutUint32(b[4:8], pgSSLRequest)
	return b
}

func pgTestStartup(user, database, app string) []byte {
	var body bytes.Buffer
	var ver [4]byte
	binary.BigEndian.PutUint32(ver[:], pgProtocolV3)
	body.Write(ver[:])
	for _, kv := range [][2]string{{"user", user}, {"database", database}, {"application_name", app}} {
		body.WriteString(kv[0])
		body.WriteByte(0)
		body.WriteString(kv[1])
		body.WriteByte(0)
	}
	body.WriteByte(0)

	out := make([]byte, 4+body.Len())
	binary.BigEndian.PutUint32(out[0:4], uint32(4+body.Len()))
	copy(out[4:], body.Bytes())
	return out
}

func pgTestPassword(password string) []byte {
	payload := append([]byte(password), 0)
	out := make([]byte, 5+len(payload))
	out[0] = 'p'
	binary.BigEndian.PutUint32(out[1:5], uint32(4+len(payload)))
	copy(out[5:], payload)
	return out
}

// TestFraming проверяет разбор потока всеми кадрированиями.
func TestFraming(t *testing.T) {
	req, used, need, err := frameLine.next([]byte("USER bob\r\nrest"))
	if err != nil || need || req != "USER bob" || used != len("USER bob\r\n") {
		t.Fatalf("line: req=%q used=%d need=%v err=%v", req, used, need, err)
	}
	if _, _, need, _ := frameLine.next([]byte("no newline yet")); !need {
		t.Fatal("line: expected needMore")
	}

	req, _, need, err = frameRESP.next([]byte("*2\r\n$4\r\nAUTH\r\n$3\r\nfoo\r\n"))
	if err != nil || need || req != "AUTH foo" {
		t.Fatalf("resp: req=%q need=%v err=%v", req, need, err)
	}
	if _, _, need, _ := frameRESP.next([]byte("*2\r\n$4\r\nAUTH\r\n")); !need {
		t.Fatal("resp: expected needMore")
	}

	raw := "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\n\r\nbody"
	req, used, need, err = frameHTTP.next([]byte(raw))
	if err != nil || need || used != len(raw) {
		t.Fatalf("http: used=%d need=%v err=%v", used, need, err)
	}
	if !strings.HasPrefix(req, "POST / HTTP/1.1") || strings.Contains(req, "body") {
		t.Fatalf("http: bad request %q", req)
	}
	if _, _, need, _ := frameHTTP.next([]byte("GET / HTTP/1.1\r\nHost: x\r\n")); !need {
		t.Fatal("http: expected needMore")
	}

	req, _, _, err = frameRaw.next([]byte{0x03, 0x01})
	if err != nil || req != string([]byte{0x03, 0x01}) {
		t.Fatalf("raw: %q err=%v", req, err)
	}
}

// exchange запускает правило на сессии и возвращает ответ сервера.
func exchange(t *testing.T, sess *Session, h *ruleHandler, rs *ruleState, c net.Conn, in string) string {
	t.Helper()
	type result struct {
		s   string
		err error
	}
	ch := make(chan result, 1)
	go func() {
		buf := make([]byte, 16384)
		n, err := c.Read(buf)
		ch <- result{string(buf[:n]), err}
	}()
	_, _ = rs.fire(sess, h.rules, in, 0, 0, false)
	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatalf("read %q: %v", in, r.err)
		}
		return r.s
	case <-time.After(time.Second):
		t.Fatalf("timeout after %q", in)
		return ""
	}
}

func newPipeHandler(t *testing.T, prof profile) (*Session, *ruleHandler, *ruleState, net.Conn) {
	t.Helper()
	h, err := optsFrom(ServiceConfig{}).newHandler(prof, nil)
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	t.Cleanup(func() { server.Close(); client.Close() })
	sess := newSession(server, "test", "medium", NewLogger(io.Discard))
	return sess, h, newRuleState(h.rules), client
}

// TestRedisProfileRules проверяет, что Redis теперь описан правилами.
func TestRedisProfileRules(t *testing.T) {
	sess, h, rs, client := newPipeHandler(t, redisProfile(map[string]string{"requirepass": "hunter2"}))
	if got := exchange(t, sess, h, rs, client, "PING"); got != "+PONG\r\n" {
		t.Fatalf("PING = %q", got)
	}
	if got := exchange(t, sess, h, rs, client, "AUTH default hunter2"); got != "+OK\r\n" {
		t.Fatalf("AUTH ok = %q", got)
	}
	if got := exchange(t, sess, h, rs, client, "AUTH root wrong"); !strings.Contains(got, "WRONGPASS") {
		t.Fatalf("AUTH bad = %q", got)
	}
	if got := exchange(t, sess, h, rs, client, "SET k v EX 10"); got != "+OK\r\n" {
		t.Fatalf("SET with options = %q", got)
	}
	if got := exchange(t, sess, h, rs, client, "BOGUS cmd"); !strings.HasPrefix(got, "-ERR unknown command") {
		t.Fatalf("unknown command = %q", got)
	}
}

// TestHTTPProfileRules проверяет единый HTTP-профиль.
func TestHTTPProfileRules(t *testing.T) {
	sess, h, rs, client := newPipeHandler(t, nginxProfile(nil))
	got := exchange(t, sess, h, rs, client, "GET / HTTP/1.1\r\nHost: example.com\r\n")
	if !strings.HasPrefix(got, "HTTP/1.1 404") {
		t.Fatalf("status = %q", got)
	}
	if !strings.Contains(got, "Server: nginx/1.25.2") {
		t.Fatalf("missing server header: %q", got)
	}
	if !strings.Contains(got, "Content-Length:") {
		t.Fatalf("missing content-length: %q", got)
	}
}

// TestKubernetesForbiddenJSON проверяет, что тело ответа 403 остаётся валидным JSON после раскрытия escape-последовательностей.
func TestKubernetesForbiddenJSON(t *testing.T) {
	var body string
	for _, r := range kubernetesProfile(nil).rules {
		if r.Name == "forbidden" {
			body = unescape(r.Response)
		}
	}
	i := strings.Index(body, "\r\n\r\n")
	if i < 0 {
		t.Fatalf("no body separator in %q", body)
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(body[i+4:]), &v); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
}

// TestBuiltinRegistry проверяет, что каждый встроенный тип собирается.
func TestBuiltinRegistry(t *testing.T) {
	logger := NewLogger(io.Discard)
	types := BuiltinTypes()
	if len(types) < 25 {
		t.Fatalf("only %d builtin types", len(types))
	}
	for _, typ := range types {
		if typ == "line" {
			continue
		}
		svc, err := NewService(ServiceConfig{Type: typ}, logger)
		if err != nil {
			t.Errorf("type %q: %v", typ, err)
			continue
		}
		if svc.Listen == "" {
			t.Errorf("type %q has no default listen address", typ)
		}
	}
}

func TestNewService(t *testing.T) {
	logger := NewLogger(io.Discard)
	if _, err := NewService(ServiceConfig{Type: "ssh"}, logger); err != nil {
		t.Fatalf("ssh default: %v", err)
	}
	if _, err := NewService(ServiceConfig{Type: "nope"}, logger); err == nil {
		t.Fatal("expected unknown type error")
	}
	if _, err := NewService(ServiceConfig{Type: "line"}, logger); err == nil {
		t.Fatal("expected line profile validation error")
	}
	if _, err := NewService(ServiceConfig{Type: "smtp", TLSCert: "x"}, logger); err == nil {
		t.Fatal("expected tls pair validation error")
	}
	types := BuiltinTypes()
	if len(types) == 0 {
		t.Fatal("no builtin types")
	}
}

// TestLevelBehavior проверяет строгое разделение уровней: low — только баннер, medium — полная логика с ответами и захватом кредов.
func TestLevelBehavior(t *testing.T) {
	logger := NewLogger(io.Discard)
	rules := []Rule{{Name: "auth", Pattern: `(?i)^LOGIN (.+) (.+)$`, Response: "ok\r\n", Capture: []string{"username", "password"}}}

	build := func(level string) *Service {
		svc, err := NewService(ServiceConfig{Type: "line", Level: level, Listen: "127.0.0.1:0", Greeting: "banner\r\n", Rules: rules}, logger)
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	serve := func(svc *Service, level string) net.Conn {
		server, client := net.Pipe()
		t.Cleanup(func() { server.Close(); client.Close() })
		go svc.handler.Serve(newSession(server, svc.Name, level, logger))
		return client
	}

	// low: баннер есть, правила не работают, кредов нет.
	client := serve(build("low"), "low")
	client.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 128)
	n, err := client.Read(buf)
	if err != nil || string(buf[:n]) != "banner\r\n" {
		t.Fatalf("low banner = %q, err %v", buf[:n], err)
	}
	_, _ = client.Write([]byte("LOGIN root toor\r\n"))
	client.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if n, err := client.Read(buf); err == nil {
		t.Fatalf("low level must not run rules, got %q", buf[:n])
	}

	// medium: баннер и обработка логина.
	client = serve(build("medium"), "medium")
	client.SetReadDeadline(time.Now().Add(time.Second))
	n, err = client.Read(buf)
	if err != nil || string(buf[:n]) != "banner\r\n" {
		t.Fatalf("medium banner = %q, err %v", buf[:n], err)
	}
	_, _ = client.Write([]byte("LOGIN root toor\r\n"))
	client.SetReadDeadline(time.Now().Add(time.Second))
	n, err = client.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), "ok") {
		t.Fatalf("medium response = %q, err %v", buf[:n], err)
	}
}
