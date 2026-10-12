package imitor

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"
)

type Logger struct {
	mu  sync.Mutex
	out io.Writer
	now func() time.Time
}

func NewLogger(w io.Writer) *Logger {
	return &Logger{out: w, now: time.Now}
}

type Event struct {
	Time    time.Time         `json:"ts"`
	Service string            `json:"service"`
	Level   string            `json:"level,omitempty"`
	Src     string            `json:"src,omitempty"`
	Event   string            `json:"event"`
	Rule    string            `json:"rule,omitempty"`
	Data    map[string]string `json:"data,omitempty"`
}

// Log reports write failures without terminating the honeypot.
func (l *Logger) Log(e Event) {
	if l == nil || l.out == nil {
		return
	}
	e.Time = l.now().UTC()
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, err := l.out.Write(append(b, '\n')); err != nil {
		fmt.Fprintln(os.Stderr, "event log:", err)
	}
}

type Session struct {
	conn    net.Conn
	done    <-chan struct{}
	Service string
	Level   string
	Src     string
	logger  *Logger
}

func newSession(conn net.Conn, service, level string, logger *Logger) *Session {
	return &Session{conn: conn, Service: service, Level: level, Src: conn.RemoteAddr().String(), logger: logger}
}

func (s *Session) Send(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	_, err := s.conn.Write(b)
	return err
}

// SendString раскрывает escape-последовательности (\r \n \t \0 \xHH).
func (s *Session) SendString(str string) error {
	return s.Send([]byte(unescape(str)))
}

// Sleep добавляет базовую задержку и джиттер, чтобы время ответа было похоже на реальный процесс.
func (s *Session) Sleep(base, jitter time.Duration) {
	if d := delay(base, jitter); d > 0 {
		timer := time.NewTimer(d)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-s.done:
		}
	}
}

func (s *Session) Log(event, rule string, data map[string]string) {
	s.logger.Log(Event{Service: s.Service, Level: s.Level, Src: s.Src, Event: event, Rule: rule, Data: data})
}

func (s *Session) SetReadDeadline(d time.Duration) {
	_ = s.conn.SetReadDeadline(time.Now().Add(d))
}

// Handler обрабатывает одно соединение.
type Handler interface {
	Serve(*Session)
}

// Service — один эмулируемый сервис на конкретном адресе.
type Service struct {
	Name     string
	Listen   string
	Level    string
	Logger   *Logger
	TLSCert  string
	TLSKey   string
	MaxConns int

	handler Handler
}

func (svc *Service) Run(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ln, err := net.Listen("tcp", svc.Listen)
	if err != nil {
		return fmt.Errorf("listen %s: %w", svc.Listen, err)
	}
	if svc.TLSCert != "" && svc.TLSKey != "" {
		tlsLn, err := wrapTLS(ln, svc.TLSCert, svc.TLSKey)
		if err != nil {
			_ = ln.Close()
			return err
		}
		ln = tlsLn
	}

	svc.Logger.Log(Event{Service: svc.Name, Event: "listen", Data: map[string]string{
		"addr": svc.Listen,
		"tls":  fmt.Sprint(svc.TLSCert != ""),
	}})

	sem := make(chan struct{}, svc.MaxConns)
	var wg sync.WaitGroup
	var mu sync.Mutex
	conns := make(map[net.Conn]struct{})
	closed := make(chan struct{})
	defer func() {
		cancel()
		<-closed
		wg.Wait()
	}()
	go func() {
		defer close(closed)
		<-ctx.Done()
		_ = ln.Close()
		mu.Lock()
		defer mu.Unlock()
		for conn := range conns {
			_ = conn.Close()
		}
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			return fmt.Errorf("accept on %s: %w", svc.Listen, err)
		}
		select {
		case sem <- struct{}{}:
		default:
			svc.Logger.Log(Event{Service: svc.Name, Src: conn.RemoteAddr().String(), Event: "reject", Data: map[string]string{"reason": "connection limit"}})
			_ = conn.Close()
			continue
		}
		mu.Lock()
		if ctx.Err() != nil {
			mu.Unlock()
			_ = conn.Close()
			break
		}
		conns[conn] = struct{}{}
		mu.Unlock()
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			defer func() {
				mu.Lock()
				delete(conns, conn)
				mu.Unlock()
			}()
			svc.serveConn(ctx, conn)
		}()
	}

	return nil
}

func (svc *Service) serveConn(ctx context.Context, conn net.Conn) {
	sess := newSession(conn, svc.Name, svc.Level, svc.Logger)
	sess.done = ctx.Done()
	defer func() {
		// Паника в обработчике не должна ронять весь агент.
		if r := recover(); r != nil {
			sess.Log("panic", "", map[string]string{"error": fmt.Sprint(r)})
		}
		_ = conn.Close()
		sess.Log("disconnect", "", nil)
	}()
	sess.Log("connect", "", map[string]string{"port": portOf(conn.LocalAddr())})
	svc.handler.Serve(sess)
}

func portOf(addr net.Addr) string {
	if addr == nil {
		return ""
	}
	if _, port, err := net.SplitHostPort(addr.String()); err == nil {
		return port
	}
	return addr.String()
}

func wrapTLS(ln net.Listener, certFile, keyFile string) (net.Listener, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load tls keypair: %w", err)
	}
	return tls.NewListener(ln, &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}), nil
}
