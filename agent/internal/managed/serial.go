package managed

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"d3m0k1d.ru/internal/imitor"
)

type serialCursor struct {
	offset  int64
	pending string
}

// tailSerialTelemetry reads guest serial output on the QEMU host. The guest
// uses HONEYPOT_SERIAL_ONLY, so each event is queued exactly once here.
func tailSerialTelemetry(ctx context.Context, root string, spool *Spool) {
	cursors := make(map[string]*serialCursor)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		serialFiles, err := filepath.Glob(filepath.Join(root, "*", "serial.log"))
		if err == nil {
			for _, path := range serialFiles {
				cursor := cursors[path]
				if cursor == nil {
					cursor = &serialCursor{}
					cursors[path] = cursor
				}
				readSerialFile(path, cursor, spool)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func readSerialFile(path string, cursor *serialCursor, spool *Spool) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return
	}
	if info.Size() < cursor.offset {
		cursor.offset = 0
		cursor.pending = ""
	}
	if _, err := file.Seek(cursor.offset, 0); err != nil {
		return
	}
	reader := bufio.NewReaderSize(file, 64<<10)
	for {
		line, err := reader.ReadString('\n')
		cursor.offset += int64(len(line))
		if len(line) > 0 {
			cursor.pending += line
			if strings.HasSuffix(cursor.pending, "\n") {
				writeSerialEvent(strings.TrimSpace(cursor.pending), spool)
				cursor.pending = ""
			}
		}
		if err != nil {
			return
		}
	}
}

func writeSerialEvent(line string, spool *Spool) {
	var event imitor.Event
	if err := json.Unmarshal([]byte(line), &event); err != nil || event.Service == "" || event.Event == "" {
		return
	}
	if event.Data == nil {
		event.Data = make(map[string]string)
	}
	event.Data["transport"] = "qemu-serial"
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	_, _ = spool.Write(append(b, '\n'))
}
