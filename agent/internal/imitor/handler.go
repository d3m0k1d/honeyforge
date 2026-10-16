package imitor

import (
	"bytes"
	"strconv"
	"strings"
	"time"
)

// profile — описание сервиса: приветствие, кадрирование и правила. Любой сервис — от SSH до Grafana — это данные, поэтому новый профиль не требует нового кода обработчика.
type profile struct {
	greeting string
	connect  []byte
	// stripIAC вырезает telnet-согласование из входящих данных.
	stripIAC bool
	framing  framing
	rules    []Rule
}

type ruleHandler struct {
	greeting  string
	connect   []byte
	stripIAC  bool
	framing   framing
	initial   time.Duration
	baseDelay time.Duration
	jitter    time.Duration
	idle      time.Duration
	maxReq    int
	logInput  bool
	rules     []*compiledRule
}

// newHandler собирает обработчик профиля. Правила из конфигурации идут первыми, поэтому ими можно переопределять встроенное поведение.
func (o handlerOpts) newHandler(p profile, extra []Rule) (*ruleHandler, error) {
	all := make([]Rule, 0, len(extra)+len(p.rules))
	all = append(all, extra...)
	all = append(all, p.rules...)
	rules, err := compileRules(all)
	if err != nil {
		return nil, err
	}
	return &ruleHandler{
		greeting:  p.greeting,
		connect:   p.connect,
		stripIAC:  p.stripIAC,
		framing:   p.framing,
		initial:   o.initial,
		baseDelay: o.baseDelay,
		jitter:    o.jitter,
		idle:      o.idle,
		maxReq:    p.framing.maxRequest(),
		logInput:  o.logInput,
		rules:     rules,
	}, nil
}

func (h *ruleHandler) Serve(s *Session) {
	rs := newRuleState(h.rules)
	if h.initial > 0 {
		s.Sleep(h.initial, 0)
	}
	if len(h.connect) > 0 {
		if err := s.Send(h.connect); err != nil {
			return
		}
	}
	if h.greeting != "" {
		if err := s.SendString(h.greeting); err != nil {
			return
		}
	}

	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		s.SetReadDeadline(h.idle)
		n, err := s.conn.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			for {
				req, used, needMore, ferr := h.framing.next(buf)
				if ferr != nil {
					s.Log("overflow", "", map[string]string{"reason": ferr.Error()})
					return
				}
				if needMore {
					break
				}
				buf = buf[used:]
				if h.stripIAC {
					req = string(stripTelnetIAC([]byte(req)))
				}
				if h.framing == frameHTTP {
					h.logHTTP(s, req, httpBody(buf[:used]))
					if _, closeSession := rs.fire(s, h.rules, req, h.baseDelay, h.jitter, false); closeSession {
						return
					}
					continue
				}
				if _, closeSession := rs.fire(s, h.rules, req, h.baseDelay, h.jitter, h.logInput); closeSession {
					return
				}
			}
			if len(buf) > h.maxReq {
				s.Log("overflow", "", map[string]string{"reason": "request too long", "len": strconv.Itoa(len(buf))})
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// bannerHandler — low lvl honeypot: только баннер и приём запросов без логики. Никаких правил, ответов и захвата учётных данных — только сбор источника, порта и входящих строк.
type bannerHandler struct {
	greeting string
	initial  time.Duration
	idle     time.Duration
	logInput bool
}

func newBannerHandler(greeting string, o handlerOpts) Handler {
	return &bannerHandler{greeting: greeting, initial: o.initial, idle: o.idle, logInput: o.logInput}
}

func (h *bannerHandler) Serve(s *Session) {
	if h.initial > 0 {
		s.Sleep(h.initial, 0)
	}
	if err := s.SendString(h.greeting); err != nil {
		return
	}
	tmp := make([]byte, 4096)
	for {
		s.SetReadDeadline(h.idle)
		n, err := s.conn.Read(tmp)
		if n > 0 && h.logInput {
			s.Log("input", "", map[string]string{"data": truncate(strings.TrimSpace(string(tmp[:n])), 512)})
		}
		if err != nil {
			return
		}
	}
}

func (h *ruleHandler) logHTTP(s *Session, head, payload string) {
	parts := strings.SplitN(head, "\r\n\r\n", 2)
	if len(parts) == 1 {
		parts = strings.SplitN(head, "\n\n", 2)
	}
	lines := strings.Split(parts[0], "\n")
	data := map[string]string{}
	if len(lines) > 0 {
		if parts := strings.Fields(strings.TrimRight(lines[0], "\r")); len(parts) >= 2 {
			data["method"] = parts[0]
			data["path"] = truncate(parts[1], 512)
		}
	}
	for _, line := range lines[1:] {
		key, val, ok := strings.Cut(strings.TrimRight(line, "\r"), ":")
		if !ok {
			continue
		}
		val = strings.TrimSpace(val)
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "host":
			data["host"] = truncate(val, 512)
		case "user-agent":
			data["agent"] = truncate(val, 512)
		case "referer":
			data["referer"] = truncate(val, 512)
		case "content-type":
			data["content_type"] = truncate(val, 128)
		}
	}
	if payload != "" {
		data["payload"] = truncate(payload, 4096)
	}
	if len(data) == 0 {
		return
	}
	s.Log("http", "", data)
}

func httpBody(raw []byte) string {
	separator := []byte("\r\n\r\n")
	start := bytes.Index(raw, separator)
	if start < 0 {
		separator = []byte("\n\n")
		start = bytes.Index(raw, separator)
	}
	if start < 0 {
		return ""
	}
	start += len(separator)
	length := contentLength(raw[:start-len(separator)])
	if length <= 0 || start+length > len(raw) {
		return ""
	}
	return string(raw[start : start+length])
}
