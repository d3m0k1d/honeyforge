package managed

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"d3m0k1d.ru/internal/imitor"
)

const (
	// 100 records plus the batch envelope remain below the gateway's 2 MiB cap.
	maxRecord      = 16 << 10
	maxInputRecord = 4 << 20
	maxQueueBytes  = 64 << 20
	maxQueueFiles  = 10000
)

type event struct {
	ID string `json:"id"`
	imitor.Event
}

func truncateField(value string, limit int) (string, bool) {
	if utf8.RuneCountInString(value) <= limit {
		return value, false
	}
	runes := []rune(value)
	return string(runes[:limit-3]) + "...", true
}

func boundEvent(e *event) error {
	data := e.Data
	e.Data = nil
	var truncated bool
	e.Rule, truncated = truncateField(e.Rule, 256)
	if err := validateEvent(e.Event); err != nil {
		return err
	}
	base, err := json.Marshal(e)
	if err != nil {
		return err
	}
	// Reserve the data envelope, commas, and the truncation marker. Count
	// encoded bytes, not characters: control bytes can expand sixfold in JSON.
	budget := maxRecord - len(base) - 64
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	e.Data = make(map[string]string)
	for _, key := range keys {
		if utf8.RuneCountInString(key) > 128 || len(e.Data) >= 64 {
			truncated = true
			continue
		}
		value, cut := truncateField(data[key], 4096)
		truncated = truncated || cut
		k, _ := json.Marshal(key)
		v, _ := json.Marshal(value)
		for len(k)+len(v)+2 > budget && utf8.RuneCountInString(value) > 3 {
			value, _ = truncateField(value, max(3, utf8.RuneCountInString(value)/2))
			v, _ = json.Marshal(value)
			truncated = true
		}
		cost := len(k) + len(v) + 2
		if cost > budget {
			truncated = true
			continue
		}
		e.Data[key] = value
		budget -= cost
	}
	if truncated {
		if _, exists := e.Data["_truncated"]; !exists && len(e.Data) == 64 {
			for i := len(keys) - 1; i >= 0; i-- {
				if _, exists := e.Data[keys[i]]; exists {
					delete(e.Data, keys[i])
					break
				}
			}
		}
		e.Data["_truncated"] = "true"
	}
	return nil
}

func validateEvent(e imitor.Event) error {
	// Match the gateway's per-field limits as well as the encoded-record cap.
	if e.Time.IsZero() || e.Service == "" || e.Event == "" || utf8.RuneCountInString(e.Service) > 256 || utf8.RuneCountInString(e.Event) > 256 || utf8.RuneCountInString(e.Level) > 64 || utf8.RuneCountInString(e.Src) > 512 || utf8.RuneCountInString(e.Rule) > 256 || len(e.Data) > 64 {
		return fmt.Errorf("event has missing fields or exceeds gateway field limits")
	}
	for k, v := range e.Data {
		if utf8.RuneCountInString(k) > 128 || utf8.RuneCountInString(v) > 4096 {
			return fmt.Errorf("event data exceeds gateway field limits")
		}
	}
	return nil
}

// Spool is a single-process durable queue. Each acknowledged record can be
// removed independently, so retries never rewrite the rest of the queue.
type Spool struct {
	mu       sync.Mutex
	flushMu  sync.Mutex
	dir      string
	count    int
	size     int64
	writeErr error
}

func NewSpool(dir string) (*Spool, error) {
	if err := privateDir(dir); err != nil {
		return nil, err
	}
	s := &Spool{dir: dir}
	f, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	for {
		entries, err := f.ReadDir(100)
		if err != nil && err != io.EOF {
			return nil, err
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".tmp-") {
				if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
					return nil, err
				}
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".json") {
				return nil, fmt.Errorf("unexpected spool entry %q", entry.Name())
			}
			info, err := entry.Info()
			if err != nil {
				return nil, err
			}
			if !info.Mode().IsRegular() || info.Size() > maxRecord {
				return nil, fmt.Errorf("invalid spool record %q", entry.Name())
			}
			s.count++
			s.size += info.Size()
		}
		if err == io.EOF {
			break
		}
	}
	if s.count > maxQueueFiles || s.size > maxQueueBytes {
		return nil, fmt.Errorf("spool exceeds capacity")
	}
	return s, nil
}

func (s *Spool) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.writeErr != nil {
		return 0, s.writeErr
	}
	// The existing logger writes one complete NDJSON event per call.
	if len(p) > maxInputRecord {
		return 0, fmt.Errorf("input event exceeds %d bytes", maxInputRecord)
	}
	var e event
	if err := json.Unmarshal(bytes.TrimSpace(p), &e.Event); err != nil {
		return 0, err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return 0, err
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	e.ID = fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	if err := boundEvent(&e); err != nil {
		return 0, err
	}
	b, err := json.Marshal(e)
	if err != nil {
		return 0, err
	}
	if len(b) > maxRecord {
		return 0, fmt.Errorf("event exceeds %d bytes", maxRecord)
	}
	if s.count >= maxQueueFiles || s.size+int64(len(b)) > maxQueueBytes {
		return 0, fmt.Errorf("event spool is full")
	}
	if err := atomicWrite(filepath.Join(s.dir, e.ID+".json"), b); err != nil {
		// A directory-sync failure may follow a successful rename. Refuse
		// further writes until restart rather than undercount disk usage.
		s.writeErr = fmt.Errorf("spool persistence failed (restart required): %w", err)
		return 0, err
	}
	s.count++
	s.size += int64(len(b))
	return len(p), nil
}

func (s *Spool) batch() ([]string, []json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.dir)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	var names []string
	var records []json.RawMessage
	for len(names) < 100 {
		entries, err := f.ReadDir(100 - len(names))
		if err != nil && err != io.EOF {
			return nil, nil, err
		}
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			b, err := readLimited(filepath.Join(s.dir, entry.Name()), maxRecord)
			if err != nil {
				return nil, nil, err
			}
			var e event
			if err := json.Unmarshal(b, &e); err != nil || e.ID+".json" != entry.Name() {
				return nil, nil, fmt.Errorf("invalid spool record %q", entry.Name())
			}
			if err := validateEvent(e.Event); err != nil {
				return nil, nil, err
			}
			names = append(names, entry.Name())
			records = append(records, json.RawMessage(b))
		}
		if err == io.EOF {
			break
		}
	}
	return names, records, nil
}

func (s *Spool) acknowledge(names []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, name := range names {
		path := filepath.Join(s.dir, name)
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if err := os.Remove(path); err != nil {
			return err
		}
		s.count--
		s.size -= info.Size()
	}
	return syncDir(s.dir)
}

func privateDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("state directory must be a real directory")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	return syncDir(filepath.Dir(filepath.Clean(dir)))
}

func atomicWrite(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}

func syncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func readLimited(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return limited(f, limit)
}

func limited(r io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("response or file exceeds %d bytes", limit)
	}
	return b, nil
}
