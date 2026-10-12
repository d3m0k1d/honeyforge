package imitor

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// framing делит байтовый поток клиента на отдельные "запросы", которые сверяются с правилами профиля. Это единственное место, где зашит формат провода.
type framing uint8

const (
	// frameLine — запросы, разделённые \n (FTP, SMTP, POP3, IMAP, telnet, ...).
	frameLine framing = iota
	// frameRESP — Redis: массивы bulk-строк или inline-команды.
	frameRESP
	// frameHTTP — HTTP/SIP/RTSP: заголовки до пустой строки плюс тело.
	frameHTTP
	// frameRaw — непрозрачный бинарный поток (VNC и подобные).
	frameRaw
)

// Пределы на размер незавершённого запроса в буфере сессии.
const (
	maxLineReq = 8 << 10
	maxRESPReq = 1 << 20
	maxHTTPReq = 64 << 10
)

func (f framing) maxRequest() int {
	switch f {
	case frameRESP:
		return maxRESPReq
	case frameHTTP:
		return maxHTTPReq
	default:
		return maxLineReq
	}
}

// next извлекает один запрос из buf: used — сколько байт он занял, needMore — данных пока не хватает.
func (f framing) next(buf []byte) (req string, used int, needMore bool, err error) {
	switch f {
	case frameRESP:
		args, used, needMore, err := parseRESP(buf)
		if err != nil || needMore {
			return "", 0, needMore, err
		}
		return strings.Join(args, " "), used, false, nil

	case frameHTTP:
		return nextHTTP(buf)

	case frameRaw:
		if len(buf) == 0 {
			return "", 0, true, nil
		}
		return string(buf), len(buf), false, nil

	default: // frameLine
		i := bytes.IndexByte(buf, '\n')
		if i < 0 {
			return "", 0, true, nil
		}
		return string(bytes.TrimRight(buf[:i], "\r")), i + 1, false, nil
	}
}

// nextHTTP отрезает блок заголовков и, если указан Content-Length, тело.
func nextHTTP(buf []byte) (string, int, bool, error) {
	end := bytes.Index(buf, []byte("\r\n\r\n"))
	sep := 4
	if end < 0 {
		end = bytes.Index(buf, []byte("\n\n"))
		sep = 2
	}
	if end < 0 {
		return "", 0, true, nil
	}
	head := buf[:end]
	used := end + sep
	if n := contentLength(head); n > 0 {
		if n > maxHTTPReq {
			return "", 0, false, fmt.Errorf("body too large")
		}
		if len(buf) < used+n {
			return "", 0, true, nil
		}
		used += n
	}
	return string(head), used, false, nil
}

func contentLength(head []byte) int {
	for _, line := range bytes.Split(head, []byte("\n")) {
		key, val, ok := bytes.Cut(bytes.TrimRight(line, "\r"), []byte(":"))
		if !ok || !strings.EqualFold(string(key), "Content-Length") {
			continue
		}
		n, _ := strconv.Atoi(strings.TrimSpace(string(val)))
		return n
	}
	return 0
}
