package managed

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSerialFileQueuesTelemetry(t *testing.T) {
	root := t.TempDir()
	serialPath := filepath.Join(root, "serial.log")
	if err := os.WriteFile(serialPath, []byte(`{"ts":"2026-10-15T12:00:00Z","service":"ssh","level":"high","src":"10.0.0.5:22","event":"input","data":{"line":"whoami"}}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	spool, err := NewSpool(filepath.Join(root, "events"))
	if err != nil {
		t.Fatal(err)
	}
	var cursor serialCursor
	readSerialFile(serialPath, &cursor, spool)
	_, records, err := spool.batch()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || !contains(string(records[0]), "qemu-serial") {
		t.Fatalf("serial telemetry was not queued: %s", records)
	}
}

func contains(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
