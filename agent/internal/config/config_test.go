package config

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	raw := `{
		"version": 1,
		"services": [{"type": "ftp", "listen": ":2121"}]
	}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Services) != 1 || cfg.Services[0].Type != "ftp" {
		t.Fatalf("services = %+v", cfg.Services)
	}
}

// TestLoadRemote проверяет получение конфига с API по URL.
func TestLoadRemote(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer sekret" {
			t.Errorf("authorization = %q", got)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"version":  1,
			"services": []map[string]string{{"type": "ssh"}},
		})
	}))
	defer srv.Close()

	cfg, err := Load(srv.URL, "sekret")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Services) != 1 || cfg.Services[0].Type != "ssh" {
		t.Fatalf("services = %+v", cfg.Services)
	}
}

func TestValidateRejectsEmptyServices(t *testing.T) {
	if err := (&Config{}).Validate(); err == nil {
		t.Fatal("expected error for empty services")
	}
}

func TestLoadMissingFile(t *testing.T) {
	if _, err := Load(filepath.Join(t.TempDir(), "nope.json"), ""); err == nil {
		t.Fatal("expected error for missing file")
	}
}
