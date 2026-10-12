package imitor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Duration time.Duration

func (d Duration) Std() time.Duration { return time.Duration(d) }

// UnmarshalJSON принимает строку ("150ms") или число (наносекунды).
func (d *Duration) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*d = 0
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		if s == "" {
			*d = 0
			return nil
		}
		v, err := time.ParseDuration(s)
		if err != nil {
			return fmt.Errorf("invalid duration %q: %w", s, err)
		}
		*d = Duration(v)
		return nil
	}
	var n int64
	if err := json.Unmarshal(b, &n); err == nil {
		*d = Duration(n)
		return nil
	}
	return fmt.Errorf("invalid duration: %s", b)
}

// Rule описывает одно правило "запрос → ответ". Правила проверяются по порядку; срабатывает первое, у которого совпали pattern и состояние.
// Пустой Pattern совпадает со всем и удобен как последнее catch-all правило.
type Rule struct {
	Name    string `json:"name,omitempty"`
	Pattern string `json:"pattern"`
	// Response понимает \r \n \t \0 \xHH и подстановки {capture}.
	Response string `json:"response,omitempty"`
	// Delay добавляется к базовой задержке сервиса, Jitter — случайная добавка.
	Delay  Duration `json:"delay,omitempty"`
	Jitter Duration `json:"jitter,omitempty"`
	// Capture задаёт имена позиционных групп; именованные (?P<name>...) берутся сами.
	Capture []string `json:"capture,omitempty"`
	// On ограничивает правило состоянием сессии ("" — начальное).
	On string `json:"on,omitempty"`
	// SetState переключает состояние после срабатывания, ClearState сбрасывает его.
	SetState   string `json:"set_state,omitempty"`
	ClearState bool   `json:"clear_state,omitempty"`
	// Once разрешает правило один раз за соединение.
	Once bool `json:"once,omitempty"`
	// Close закрывает соединение после отправки ответа.
	Close bool `json:"close,omitempty"`
}

type compiledRule struct {
	spec Rule
	re   *regexp.Regexp
	resp []byte
}

func compileRules(specs []Rule) ([]*compiledRule, error) {
	out := make([]*compiledRule, 0, len(specs))
	for i, r := range specs {
		cr := &compiledRule{spec: r, resp: []byte(unescape(r.Response))}
		if r.Pattern != "" {
			re, err := regexp.Compile(r.Pattern)
			if err != nil {
				return nil, fmt.Errorf("rule #%d (%s): %w", i+1, r.Name, err)
			}
			cr.re = re
		}
		out = append(out, cr)
	}
	return out, nil
}

// match возвращает именованные и позиционные захваты строки.
func (cr *compiledRule) match(line string) (map[string]string, bool) {
	if cr.re == nil {
		return nil, true
	}
	m := cr.re.FindStringSubmatch(line)
	if m == nil {
		return nil, false
	}
	if len(cr.spec.Capture) == 0 && cr.re.NumSubexp() == 0 {
		return nil, true
	}
	data := make(map[string]string)
	for i, name := range cr.re.SubexpNames() {
		if name != "" && i < len(m) && m[i] != "" {
			data[name] = truncate(m[i], 512)
		}
	}
	for i, capName := range cr.spec.Capture {
		if i+1 < len(m) {
			data[capName] = truncate(m[i+1], 512)
		}
	}
	return data, true
}

type ruleState struct {
	used  []bool
	state string
}

func newRuleState(rules []*compiledRule) *ruleState {
	return &ruleState{used: make([]bool, len(rules))}
}

// fire отправляет ответ первого подходящего правила и сообщает, сработало ли правило и нужно ли закрыть соединение.
func (rs *ruleState) fire(sess *Session, rules []*compiledRule, line string, base, jitter time.Duration, logInput bool) (fired, closeSession bool) {
	if logInput {
		sess.Log("input", "", map[string]string{"line": truncate(line, 512)})
	}
	for i, cr := range rules {
		if cr.spec.Once && rs.used[i] {
			continue
		}
		if cr.spec.On != rs.state {
			continue
		}
		caps, ok := cr.match(line)
		if !ok {
			continue
		}
		rs.used[i] = true
		name := cr.spec.Name
		if name == "" {
			name = cr.spec.Pattern
		}
		// Правила с именем "auth" публикуются как события аутентификации, чтобы перехваченные логины и пароли было легко отфильтровать.
		event := "rule"
		if name == "auth" {
			event = "auth"
		}
		sess.Log(event, name, caps)
		if cr.spec.SetState != "" {
			rs.state = cr.spec.SetState
		} else if cr.spec.ClearState {
			rs.state = ""
		}
		if len(cr.resp) > 0 {
			sess.Sleep(base+cr.spec.Delay.Std(), jitter+cr.spec.Jitter.Std())
			if err := sess.Send(expand(cr.resp, caps)); err != nil {
				return true, true
			}
		}
		return true, cr.spec.Close
	}
	return false, false
}

// unescape раскрывает \r \n \t \0 \xHH и \\; прочие последовательности остаются как есть, чтобы не портить тела ответов вроде JSON.
func unescape(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c != '\\' || i+1 >= len(s) {
			b.WriteByte(c)
			continue
		}
		i++
		switch s[i] {
		case 'r':
			b.WriteByte('\r')
		case 'n':
			b.WriteByte('\n')
		case 't':
			b.WriteByte('\t')
		case '0':
			b.WriteByte(0)
		case '\\':
			b.WriteByte('\\')
		case 'x', 'X':
			if i+2 < len(s) {
				if v, err := strconv.ParseUint(s[i+1:i+3], 16, 8); err == nil {
					b.WriteByte(byte(v))
					i += 2
					continue
				}
			}
			b.WriteByte('\\')
			b.WriteByte(s[i])
		default:
			b.WriteByte('\\')
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// expand подставляет {capture} из совпавших групп.
func expand(b []byte, caps map[string]string) []byte {
	if len(caps) == 0 || !bytes.Contains(b, []byte("{")) {
		return b
	}
	s := string(b)
	for k, v := range caps {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return []byte(s)
}

// delay возвращает base плюс случайное значение из (0, jitter].
func delay(base, jitter time.Duration) time.Duration {
	if jitter > 0 {
		return base + time.Duration(rand.Int63n(int64(jitter)+1))
	}
	return base
}

// truncate обрезает строку для журнала.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// stripTelnetIAC вырезает telnet-согласование (последовательности IAC).
func stripTelnetIAC(b []byte) []byte {
	const iac = 255
	if !bytes.Contains(b, []byte{iac}) {
		return b
	}
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); {
		if b[i] != iac {
			out = append(out, b[i])
			i++
			continue
		}
		if i+1 >= len(b) {
			break
		}
		verb := b[i+1]
		switch {
		case verb >= 251 && verb <= 254: // WILL/WONT/DO/DONT + опция
			i += 3
		case verb == 250: // SB ... IAC SE
			i += 2
			for i+1 < len(b) && !(b[i] == iac && b[i+1] == 240) {
				i++
			}
			i += 2
		default:
			i += 2
		}
	}
	return out
}
