package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"d3m0k1d.ru/internal/imitor"
)

type Config struct {
	Version  int                    `json:"version"`
	Log      Log                    `json:"log"`
	Services []imitor.ServiceConfig `json:"services"`
}

type Log struct {
	Output string `json:"output,omitempty"`
}

func Load(source, token string) (*Config, error) {
	raw, err := read(source, token)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", source, err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func read(source, token string) ([]byte, error) {
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		return fetch(source, token)
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", source, err)
	}
	return raw, nil
}

func fetch(source, token string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, source, nil)
	if err != nil {
		return nil, fmt.Errorf("config request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch config: unexpected status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("fetch config: %w", err)
	}
	return raw, nil
}

func (c *Config) Validate() error {
	if len(c.Services) == 0 {
		return errors.New("config contains no services")
	}
	for i, s := range c.Services {
		if strings.TrimSpace(s.Type) == "" {
			return fmt.Errorf("service #%d: type is required", i+1)
		}
	}
	return nil
}
