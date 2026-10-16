package managed

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"d3m0k1d.ru/internal/config"
	"d3m0k1d.ru/internal/imitor"
)

type certificates struct {
	ca     []byte
	bundle []byte
	files  map[string][]byte
	server tls.Certificate
}

func makeCertificates(t *testing.T) certificates {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	issue := func(serial int64, cn string, usages []x509.ExtKeyUsage) ([]byte, []byte) {
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		c := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: cn}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: usages, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
		d, err := x509.CreateCertificate(rand.Reader, c, ca, &k.PublicKey, key)
		if err != nil {
			t.Fatal(err)
		}
		kb, err := x509.MarshalPKCS8PrivateKey(k)
		if err != nil {
			t.Fatal(err)
		}
		return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: d}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb})
	}
	clientCert, clientKey := issue(2, "agent-test", []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	serverCert, serverKey := issue(3, "localhost", []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth})
	server, err := tls.X509KeyPair(serverCert, serverKey)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{"ca.crt": caPEM, "client.crt": clientCert, "client.key": clientKey, "fullchain.crt": append(append([]byte{}, clientCert...), caPEM...)}
	return certificates{ca: caPEM, bundle: makeZIP(t, files), files: files, server: server}
}

func makeZIP(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, b := range files {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func startTLS(t *testing.T, c certificates, mtls bool, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	s := httptest.NewUnstartedServer(h)
	s.TLS = &tls.Config{Certificates: []tls.Certificate{c.server}, MinVersion: tls.VersionTLS12}
	if mtls {
		pool, err := roots(c.ca)
		if err != nil {
			t.Fatal(err)
		}
		s.TLS.ClientCAs = pool
		s.TLS.ClientAuth = tls.RequireAndVerifyClientCert
	}
	s.StartTLS()
	t.Cleanup(s.Close)
	return s
}

func TestEnrollmentTrustAndMTLS(t *testing.T) {
	t.Parallel()
	c := makeCertificates(t)
	token := strings.Repeat("s", 43)
	var enrolled atomic.Int32
	bootstrap := startTLS(t, c, false, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/enroll" || r.Method != http.MethodPost {
			t.Error("wrong enrollment route")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !reflect.DeepEqual(body, map[string]string{"token": token}) {
			t.Error("wrong enrollment body", body, err)
		}
		enrolled.Add(1)
		w.Header().Set("Content-Type", "application/zip")
		w.WriteHeader(http.StatusCreated)
		w.Write(c.bundle)
	})
	dir := t.TempDir()
	caPath := filepath.Join(dir, "bootstrap.pem")
	if err := os.WriteFile(caPath, c.ca, 0o600); err != nil {
		t.Fatal(err)
	}
	o := Options{StateDir: dir, EnrollmentURL: bootstrap.URL + "/agents/enroll", EnrollmentToken: token, BootstrapCA: caPath}
	// A valid but unrelated CA must not authorize the bootstrap server.
	wrong := makeCertificates(t)
	wrongPath := filepath.Join(dir, "wrong.pem")
	if err := os.WriteFile(wrongPath, wrong.ca, 0o600); err != nil {
		t.Fatal(err)
	}
	bad := o
	bad.BootstrapCA = wrongPath
	if _, err := connect(t.Context(), bad); err == nil {
		t.Fatal("untrusted bootstrap accepted")
	}
	if enrolled.Load() != 0 {
		t.Fatal("token reached untrusted server")
	}
	client, err := connect(t.Context(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	if client.Timeout != 10*time.Second {
		t.Fatal("enrollment timeout leaked into runtime client")
	}
	for _, name := range []string{"client.key", "certificates.zip"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatal("credential permissions", name, err)
		}
	}
	runtime := startTLS(t, c, true, func(w http.ResponseWriter, r *http.Request) {
		if len(r.TLS.PeerCertificates) == 0 || r.TLS.PeerCertificates[0].Subject.CommonName != "agent-test" {
			t.Error("missing agent identity")
		}
		if r.Method != http.MethodPost || r.URL.Path != "/heartbeat" {
			t.Error("wrong runtime route")
		}
		b, _ := io.ReadAll(r.Body)
		if len(b) != 0 {
			t.Error("heartbeat body must be empty")
		}
		w.WriteHeader(http.StatusOK)
	})
	if status, _, err := request(t.Context(), client, http.MethodPost, runtime.URL+"/heartbeat", nil); err != nil || status != 200 {
		t.Fatal(status, err)
	}
	// Once persisted, even missing bootstrap inputs must not reenroll.
	restarted, err := connect(t.Context(), Options{StateDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.CloseIdleConnections()
	if _, _, err := request(t.Context(), restarted, http.MethodPost, runtime.URL+"/heartbeat", nil); err != nil {
		t.Fatal(err)
	}
	if enrolled.Load() != 1 {
		t.Fatal("reenrolled", enrolled.Load())
	}
}

func TestBundleValidation(t *testing.T) {
	t.Parallel()
	c := makeCertificates(t)
	for _, tc := range []struct {
		name   string
		change func(map[string][]byte)
	}{
		{"traversal", func(m map[string][]byte) { m["../client.key"] = m["client.key"]; delete(m, "client.key") }},
		{"extra", func(m map[string][]byte) { m["extra"] = []byte("x") }},
		{"oversized", func(m map[string][]byte) { m["ca.crt"] = bytes.Repeat([]byte("x"), 129<<10) }},
		{"wrong-key", func(m map[string][]byte) { m["client.key"] = []byte("not a key") }},
		{"wrong-ca", func(m map[string][]byte) { m["ca.crt"] = m["client.crt"] }},
		{"wrong-chain", func(m map[string][]byte) { m["fullchain.crt"] = m["ca.crt"] }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := make(map[string][]byte)
			for k, v := range c.files {
				m[k] = v
			}
			tc.change(m)
			if _, _, err := bundleTLS(makeZIP(t, m)); err == nil {
				t.Fatal("invalid bundle accepted")
			}
		})
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for i := 0; i < 4; i++ {
		w, _ := z.Create("ca.crt")
		w.Write(c.ca)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := bundleTLS(buf.Bytes()); err == nil {
		t.Fatal("duplicate entries accepted")
	}
}

func TestEnrollmentCancellation(t *testing.T) {
	t.Parallel()
	c := makeCertificates(t)
	started := make(chan struct{})
	bootstrap := startTLS(t, c, false, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	})
	dir := t.TempDir()
	caPath := filepath.Join(dir, "bootstrap.pem")
	if err := os.WriteFile(caPath, c.ca, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		client, err := connect(ctx, Options{StateDir: dir, EnrollmentURL: bootstrap.URL + "/agents/enroll", EnrollmentToken: strings.Repeat("s", 43), BootstrapCA: caPath})
		if client != nil {
			client.CloseIdleConnections()
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("enrollment never started")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled enrollment succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("enrollment ignored cancellation")
	}
	if _, err := os.Stat(filepath.Join(dir, "certificates.zip")); !os.IsNotExist(err) {
		t.Fatal("incomplete bundle persisted")
	}
}

func TestSpoolRestartRetryAndAcknowledgment(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := NewSpool(dir)
	if err != nil {
		t.Fatal(err)
	}
	logger := imitor.NewLogger(s)
	for i := 0; i < 101; i++ {
		logger.Log(imitor.Event{Service: "ssh", Event: "connect", Data: map[string]string{"n": fmt.Sprint(i)}})
	}
	// Reopening must preserve IDs, not regenerate them at send time.
	s, err = NewSpool(dir)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	seen := make(map[string]int)
	attempt := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Events []event `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if len(body.Events) > 100 || len(body.Events) == 0 {
			t.Error("invalid batch size")
		}
		mu.Lock()
		defer mu.Unlock()
		attempt++
		for _, e := range body.Events {
			if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(e.ID) || e.Service != "ssh" || e.Time.IsZero() {
				t.Error("invalid wire event", e)
			}
			seen[e.ID]++
		}
		if attempt == 1 {
			w.WriteHeader(503)
			return
		}
		accepted := len(body.Events)
		if attempt == 2 {
			accepted--
		}
		json.NewEncoder(w).Encode(map[string]int{"accepted": accepted})
	}))
	defer server.Close()
	for i := 0; i < 2; i++ {
		if err := s.Flush(t.Context(), server.Client(), server.URL); err == nil {
			t.Fatal("failed request or partial ack accepted")
		}
		entries, _ := os.ReadDir(dir)
		if len(entries) != 101 {
			t.Fatal("unacknowledged events removed")
		}
	}
	s, err = NewSpool(dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.Flush(t.Context(), server.Client(), server.URL); err != nil {
			t.Fatal(err)
		}
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("acknowledged records retained")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 101 {
		t.Fatal("IDs changed across retries", len(seen))
	}
	retried := 0
	for _, n := range seen {
		if n > 1 {
			retried++
		}
	}
	if retried != 100 {
		t.Fatal("unexpected retry count", retried)
	}
}

func TestSpoolLimitsAndConcurrentWrites(t *testing.T) {
	t.Parallel()
	s, err := NewSpool(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(bytes.Repeat([]byte("x"), maxInputRecord+1)); err == nil {
		t.Fatal("oversized event accepted")
	}
	if _, err := s.Write([]byte("broken JSON")); err == nil {
		t.Fatal("invalid event accepted")
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Go(func() {
			if _, err := s.Write([]byte(`{"ts":"2026-10-11T00:00:00Z","service":"ssh","event":"connect"}`)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	names, _, err := s.batch()
	if err != nil || len(names) != 20 {
		t.Fatal(len(names), err)
	}
	s.mu.Lock()
	s.count = maxQueueFiles
	s.mu.Unlock()
	if _, err := s.Write([]byte(`{"ts":"2026-10-11T00:00:00Z","service":"ssh","event":"connect"}`)); err == nil {
		t.Fatal("full queue accepted event")
	}
}

func TestEventFieldLimits(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		change func(*imitor.Event)
	}{
		{"service", func(e *imitor.Event) { e.Service = strings.Repeat("s", 257) }},
		{"event", func(e *imitor.Event) { e.Event = strings.Repeat("e", 257) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, err := NewSpool(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e := imitor.Event{Time: time.Now(), Service: "ssh", Event: "connect"}
			tc.change(&e)
			b, err := json.Marshal(e)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.Write(b); err == nil {
				t.Fatal("gateway-invalid event persisted")
			}
		})
	}
}

func TestOversizedEventRetainsBoundedEvidence(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		data map[string]string
		rule string
	}{
		{"raw-input", map[string]string{"raw": strings.Repeat("input", 20000)}, ""},
		{"escaped-input", map[string]string{"raw": strings.Repeat("\x00<>", 4096)}, ""},
		{"unicode-input", map[string]string{"raw": strings.Repeat("界", 5000)}, ""},
		{"oversized-capture-key", map[string]string{strings.Repeat("k", 129): "ignored", "password": "kept"}, ""},
		{"oversized-rule", map[string]string{"password": "kept"}, strings.Repeat("pattern", 100)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			s, err := NewSpool(dir)
			if err != nil {
				t.Fatal(err)
			}
			original := imitor.Event{Time: time.Now().UTC(), Service: "postgres", Event: "input", Src: "127.0.0.1:1234", Rule: tc.rule, Data: tc.data}
			b, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			if n, err := s.Write(append(b, '\n')); err != nil || n != len(b)+1 {
				t.Fatal("event discarded", n, err)
			}
			_, records, err := s.batch()
			if err != nil || len(records) != 1 {
				t.Fatal(len(records), err)
			}
			var got event
			if err := json.Unmarshal(records[0], &got); err != nil {
				t.Fatal(err)
			}
			if err := validateEvent(got.Event); err != nil {
				t.Fatal(err)
			}
			if len(records[0]) > maxRecord || got.Data["_truncated"] != "true" || got.ID == "" || got.Service != original.Service || got.Event.Event != original.Event || !got.Time.Equal(original.Time) {
				t.Fatal("event evidence or bounds not preserved", got)
			}
			if _, present := tc.data["raw"]; present && (got.Data["raw"] == "" || !strings.HasSuffix(got.Data["raw"], "...")) {
				t.Fatal("missing raw preview")
			}
			if tc.data["password"] != "" && got.Data["password"] != "kept" {
				t.Fatal("small evidence field lost")
			}
			s, err = NewSpool(dir)
			if err != nil {
				t.Fatal(err)
			}
			_, restarted, err := s.batch()
			if err != nil || len(restarted) != 1 || !bytes.Equal(records[0], restarted[0]) {
				t.Fatal("bounded event changed after restart", err)
			}
		})
	}
}

func TestEventEncodedRecordBudget(t *testing.T) {
	t.Parallel()
	s, err := NewSpool(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data := make(map[string]string)
	for i := 0; i < 80; i++ {
		data[fmt.Sprintf("capture-%02d", i)] = strings.Repeat("\x00", 512)
	}
	b, err := json.Marshal(imitor.Event{Time: time.Now().UTC(), Service: "http", Event: "input", Data: data})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(b); err != nil {
		t.Fatal("many escaped captures discarded the event", err)
	}
	_, records, err := s.batch()
	if err != nil || len(records) != 1 {
		t.Fatal(len(records), err)
	}
	var got event
	if err := json.Unmarshal(records[0], &got); err != nil {
		t.Fatal(err)
	}
	if err := validateEvent(got.Event); err != nil {
		t.Fatal(err)
	}
	if len(records[0]) > maxRecord || got.Data["_truncated"] != "true" || len(got.Data) <= 1 {
		t.Fatal("missing bounded captures")
	}
}

func TestEventDataWithinLimitsIsUnchanged(t *testing.T) {
	t.Parallel()
	s, err := NewSpool(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data := make(map[string]string)
	for i := 0; i < 64; i++ {
		data[fmt.Sprintf("key-%02d", i)] = "value"
	}
	b, err := json.Marshal(imitor.Event{Time: time.Now().UTC(), Service: "ssh", Event: "auth", Data: data})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(b); err != nil {
		t.Fatal(err)
	}
	_, records, err := s.batch()
	if err != nil || len(records) != 1 {
		t.Fatal(len(records), err)
	}
	var got event
	if err := json.Unmarshal(records[0], &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, got.Data) {
		t.Fatal("valid data changed", got.Data)
	}
}

func freeAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

func dialService(t *testing.T, addr string) net.Conn {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", addr, 50*time.Millisecond)
		if err == nil {
			return c
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("service never listened", addr)
	return nil
}

func TestSupervisorReconfigurationAndCancellation(t *testing.T) {
	t.Parallel()
	s := &supervisor{logger: imitor.NewLogger(io.Discard), active: make(map[string]running), errors: make(chan error, 1)}
	defer s.stop()
	addr := freeAddress(t)
	cfg := &config.Config{Version: 1, Services: []imitor.ServiceConfig{{Type: "postgres", Listen: addr}}}
	services, err := s.prepare(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s.apply(t.Context(), cfg, services)
	c := dialService(t, addr)
	defer c.Close()
	before := s.active[addr].done
	// Version/log-only changes must leave the running listener intact.
	same := &config.Config{Version: 2, Log: config.Log{Output: "ignored"}, Services: cfg.Services}
	services, err = s.prepare(same)
	if err != nil {
		t.Fatal(err)
	}
	s.apply(t.Context(), same, services)
	if s.active[addr].done != before {
		t.Fatal("unchanged service restarted")
	}
	bad := &config.Config{Version: 3, Services: []imitor.ServiceConfig{{Type: "bad", Listen: addr}}}
	if _, err := s.prepare(bad); err == nil {
		t.Fatal("invalid service accepted")
	}
	if s.active[addr].done != before {
		t.Fatal("invalid config stopped service")
	}
	changed := &config.Config{Version: 3, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "replacement\\n"}}}
	services, err = s.prepare(changed)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { s.apply(t.Context(), changed, services); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("blocked postgres session stalled replacement")
	}
	c.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := c.Read(make([]byte, 1)); err == nil {
		t.Fatal("old active connection remained open")
	}
	next := dialService(t, addr)
	defer next.Close()
	next.SetReadDeadline(time.Now().Add(time.Second))
	b := make([]byte, len("replacement\n"))
	if _, err := io.ReadFull(next, b); err != nil || string(b) != "replacement\n" {
		t.Fatal(string(b), err)
	}
	empty := &config.Config{Version: 4, Services: []imitor.ServiceConfig{}}
	services, err = s.prepare(empty)
	if err != nil {
		t.Fatal(err)
	}
	s.apply(t.Context(), empty, services)
	if len(s.active) != 0 {
		t.Fatal("empty assignment did not stop services")
	}
}

func TestSupervisorInitialDelayCancellation(t *testing.T) {
	t.Parallel()
	for _, action := range []string{"reconfiguration", "shutdown"} {
		t.Run(action, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			spool, err := NewSpool(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			s := &supervisor{logger: imitor.NewLogger(spool), active: make(map[string]running), errors: make(chan error, 1)}
			addr := freeAddress(t)
			cfg := &config.Config{Version: 1, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "delayed\\n", InitialDelay: imitor.Duration(24 * time.Hour)}}}
			services, err := s.prepare(cfg)
			if err != nil {
				t.Fatal(err)
			}
			s.apply(ctx, cfg, services)
			conn := dialService(t, addr)
			defer conn.Close()
			waitUntil(t, func() bool {
				_, records, err := spool.batch()
				if err != nil {
					t.Fatal(err)
				}
				for _, record := range records {
					var e event
					if err := json.Unmarshal(record, &e); err != nil {
						t.Fatal(err)
					}
					if e.Event.Event == "connect" {
						return true
					}
				}
				return false
			})
			conn.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
			if _, err := conn.Read(make([]byte, 1)); err == nil {
				t.Fatal("initial delay was not applied")
			} else if nerr, ok := err.(net.Error); !ok || !nerr.Timeout() {
				t.Fatal("connection closed during initial delay", err)
			}
			done := make(chan struct{})
			if action == "reconfiguration" {
				replacement := &config.Config{Version: 2, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "replacement\\n"}}}
				services, err := s.prepare(replacement)
				if err != nil {
					t.Fatal(err)
				}
				go func() { s.apply(ctx, replacement, services); close(done) }()
			} else {
				go func() { s.stop(); close(done) }()
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("24-hour initial delay stalled", action)
			}
			defer s.stop()
			conn.SetReadDeadline(time.Now().Add(time.Second))
			if _, err := io.ReadAll(conn); err != nil {
				t.Fatal("old connection was not closed", err)
			}
			if action == "reconfiguration" {
				next := dialService(t, addr)
				defer next.Close()
				next.SetReadDeadline(time.Now().Add(time.Second))
				buf := make([]byte, len("replacement\n"))
				if _, err := io.ReadFull(next, buf); err != nil || string(buf) != "replacement\n" {
					t.Fatal("replacement failed to reclaim port", string(buf), err)
				}
			}
		})
	}
}

func TestManagedEndpointAndConfigValidation(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"http://localhost", "https://u:p@localhost", "https://localhost?a=b", "https://localhost#x", "https:///missing"} {
		if err := secureURL(raw); err == nil {
			t.Error("unsafe URL accepted", raw)
		}
	}
	s := &supervisor{logger: imitor.NewLogger(io.Discard)}
	for _, tc := range []struct {
		name string
		cfg  config.Config
	}{
		{"missing-array", config.Config{}},
		{"bad-port", config.Config{Services: []imitor.ServiceConfig{{Type: "ssh", Listen: "localhost:99999"}}}},
		{"oversized-name", config.Config{Services: []imitor.ServiceConfig{{Type: "ssh", Name: strings.Repeat("s", 257)}}}},
		{"bad-rules", config.Config{Services: []imitor.ServiceConfig{{Type: "line", Listen: ":1234", Rules: []imitor.Rule{{Pattern: "["}}}}}},
		{"bad-tls", config.Config{Services: []imitor.ServiceConfig{{Type: "ssh", TLSCert: "missing", TLSKey: "missing"}}}},
		{"port-conflict", config.Config{Services: []imitor.ServiceConfig{{Type: "ssh", Listen: ":1234"}, {Type: "ftp", Listen: "127.0.0.1:1234"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.cfg.Version = 1
			if _, err := s.prepare(&tc.cfg); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}

func TestDirectAPIConfigFields(t *testing.T) {
	t.Parallel()
	// The API omits unset defaults, sends durations as strings or integer
	// nanoseconds, and returns the server-controlled version without a wrapper.
	raw := []byte(`{"version":7,"log":{},"services":[{"type":"line","name":"stateful","level":"medium","listen":"127.0.0.1:0","max_conns":0,"idle_timeout":"30s","delay":150000000,"jitter":"5ms","initial_delay":0,"log_input":null,"params":{"hostname":"hp"},"greeting":"welcome\\n","rules":[{"name":"auth","pattern":"^USER (.*)$","response":"ok\\n","delay":"2ms","jitter":0,"capture":["username"],"on":"","set_state":"authenticated","clear_state":false,"once":true,"close":false}]}]}`)
	var cfg config.Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	s := &supervisor{logger: imitor.NewLogger(io.Discard)}
	if _, err := s.prepare(&cfg); err != nil {
		t.Fatal("API config rejected", err)
	}
	sc := cfg.Services[0]
	rule := sc.Rules[0]
	if cfg.Version != 7 || cfg.Log.Output != "" || sc.IdleTimeout.Std() != 30*time.Second || sc.Delay.Std() != 150*time.Millisecond || sc.Jitter.Std() != 5*time.Millisecond || sc.LogInput != nil || rule.Delay.Std() != 2*time.Millisecond || rule.On != "" || rule.SetState != "authenticated" || rule.ClearState || !rule.Once || rule.Close || len(rule.Capture) != 1 || rule.Capture[0] != "username" {
		t.Fatal("API fields or state decoded incorrectly", cfg)
	}
}

func TestManagedCacheOffline(t *testing.T) {
	t.Parallel()
	c := makeCertificates(t)
	dir := t.TempDir()
	if err := atomicWrite(filepath.Join(dir, "certificates.zip"), c.bundle); err != nil {
		t.Fatal(err)
	}
	addr := freeAddress(t)
	b, err := json.Marshal(config.Config{Version: 1, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "cached\\n"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := atomicWrite(filepath.Join(dir, "config.json"), b); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	offline := "https://" + freeAddress(t)
	go func() {
		done <- Run(ctx, Options{GatewayURL: offline, StateDir: dir, PollInterval: 50 * time.Millisecond})
	}()
	conn := dialService(t, addr)
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, len("cached\n"))
	if _, err := io.ReadFull(conn, buf); err != nil || string(buf) != "cached\n" {
		t.Fatal(string(buf), err)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("managed cancellation stalled")
	}
	entries, err := os.ReadDir(filepath.Join(dir, "events"))
	if err != nil || len(entries) == 0 {
		t.Fatal("offline events were not persisted", err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			t.Fatal("unexpected spool entry")
		}
	}
}

func waitUntil(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition did not become true")
}

func TestManagedPollingVersionsAndCache(t *testing.T) {
	t.Parallel()
	c := makeCertificates(t)
	dir := t.TempDir()
	if err := atomicWrite(filepath.Join(dir, "certificates.zip"), c.bundle); err != nil {
		t.Fatal(err)
	}
	var assigned atomic.Pointer[config.Config]
	var polls, heartbeats, delivered atomic.Int32
	gateway := startTLS(t, c, true, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/heartbeat":
			if r.Method != http.MethodPost || r.ContentLength != 0 {
				t.Error("heartbeat contract")
			}
			heartbeats.Add(1)
			w.WriteHeader(200)
		case "/config":
			if r.Method != http.MethodGet {
				t.Error("config method")
			}
			cfg := assigned.Load()
			if cfg == nil {
				w.WriteHeader(404)
			} else {
				json.NewEncoder(w).Encode(cfg)
			}
			polls.Add(1)
		case "/events":
			var batch struct {
				Events []event `json:"events"`
			}
			if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
				t.Error(err)
				return
			}
			for _, e := range batch.Events {
				if err := validateEvent(e.Event); err != nil {
					t.Error(err)
				}
			}
			delivered.Add(int32(len(batch.Events)))
			json.NewEncoder(w).Encode(map[string]int{"accepted": len(batch.Events)})
		default:
			t.Error("unexpected runtime path", r.URL.Path)
			w.WriteHeader(404)
		}
	})
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{GatewayURL: gateway.URL, StateDir: dir, PollInterval: 25 * time.Millisecond})
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(3 * time.Second):
			t.Error("control loop did not stop")
		}
	})
	waitUntil(t, func() bool { return polls.Load() >= 2 })
	if _, err := os.Stat(filepath.Join(dir, "config.json")); !os.IsNotExist(err) {
		t.Fatal("404 created assignment cache")
	}
	addr := freeAddress(t)
	first := &config.Config{Version: 1, Services: []imitor.ServiceConfig{{Type: "postgres", Listen: addr}}}
	assigned.Store(first)
	conn := dialService(t, addr)
	defer conn.Close()
	// A different body with the same server version must be ignored.
	assigned.Store(&config.Config{Version: 1, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "wrong\\n"}}})
	before := polls.Load()
	waitUntil(t, func() bool { return polls.Load() >= before+2 })
	conn.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("same-version body was applied")
	} else if nerr, ok := err.(net.Error); !ok || !nerr.Timeout() {
		t.Fatal("same-version config closed original session", err)
	}
	// Reject a new invalid generation without replacing the valid cache.
	assigned.Store(&config.Config{Version: 2, Services: []imitor.ServiceConfig{{Type: "missing", Listen: addr}}})
	before = polls.Load()
	waitUntil(t, func() bool { return polls.Load() >= before+2 })
	b, err := readLimited(filepath.Join(dir, "config.json"), 4<<20)
	if err != nil {
		t.Fatal(err)
	}
	var cached config.Config
	if err := json.Unmarshal(b, &cached); err != nil || cached.Version != 1 {
		t.Fatal("invalid config replaced cache", err)
	}
	assigned.Store(&config.Config{Version: 2, Services: []imitor.ServiceConfig{{Type: "line", Listen: addr, Greeting: "updated\\n"}}})
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("old session not closed")
	} else if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
		t.Fatal("replacement never closed old session")
	}
	next := dialService(t, addr)
	defer next.Close()
	next.SetReadDeadline(time.Now().Add(time.Second))
	b = make([]byte, len("updated\n"))
	if _, err := io.ReadFull(next, b); err != nil || string(b) != "updated\n" {
		t.Fatal("wrong replacement greeting", string(b), err)
	}
	waitUntil(t, func() bool { return delivered.Load() > 0 && heartbeats.Load() > 0 })
	b, err = readLimited(filepath.Join(dir, "config.json"), 4<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &cached); err != nil || cached.Version != 2 {
		t.Fatal("valid config not cached", err)
	}
}
