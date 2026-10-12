// Package managed implements enrollment and the agent gateway control loop.
// Managed log.output is intentionally ignored: all events use the central spool.
package managed

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"d3m0k1d.ru/internal/config"
	"d3m0k1d.ru/internal/imitor"
)

type running struct {
	cfg    imitor.ServiceConfig
	cancel context.CancelFunc
	done   chan struct{}
}

type supervisor struct {
	logger  *imitor.Logger
	active  map[string]running
	errors  chan error
	current *config.Config
}

func (s *supervisor) prepare(cfg *config.Config) (map[string]*imitor.Service, error) {
	if cfg.Version <= 0 {
		return nil, fmt.Errorf("config version must be positive")
	}
	if cfg.Services == nil {
		return nil, fmt.Errorf("config requires a services array")
	}
	// An empty assignment is valid in managed mode and stops all services.
	services := make(map[string]*imitor.Service)
	var addresses []*net.TCPAddr
	for i, sc := range cfg.Services {
		if sc.MaxConns < 0 || sc.IdleTimeout < 0 || sc.Delay < 0 || sc.Jitter < 0 || sc.InitialDelay < 0 {
			return nil, fmt.Errorf("service #%d: invalid limits or durations", i+1)
		}
		svc, err := imitor.NewService(sc, s.logger)
		if err != nil {
			return nil, fmt.Errorf("service #%d: %w", i+1, err)
		}
		if utf8.RuneCountInString(svc.Name) > 256 {
			return nil, fmt.Errorf("service #%d: name exceeds gateway event limit", i+1)
		}
		_, port, err := net.SplitHostPort(svc.Listen)
		if err != nil {
			return nil, fmt.Errorf("service #%d listen: %w", i+1, err)
		}
		p, err := strconv.Atoi(port)
		if err != nil || p < 0 || p > 65535 {
			return nil, fmt.Errorf("service #%d: invalid port", i+1)
		}
		if _, exists := services[svc.Listen]; exists {
			return nil, fmt.Errorf("duplicate listen address %q", svc.Listen)
		}
		addr, err := net.ResolveTCPAddr("tcp", svc.Listen)
		if err != nil {
			return nil, fmt.Errorf("service #%d listen: %w", i+1, err)
		}
		for _, other := range addresses {
			if addr.Port != 0 && addr.Port == other.Port && (len(addr.IP) == 0 || len(other.IP) == 0 || addr.IP.IsUnspecified() || other.IP.IsUnspecified() || addr.IP.Equal(other.IP)) {
				return nil, fmt.Errorf("conflicting listen address %q", svc.Listen)
			}
		}
		addresses = append(addresses, addr)
		if svc.TLSCert != "" {
			if _, err := tls.LoadX509KeyPair(svc.TLSCert, svc.TLSKey); err != nil {
				return nil, err
			}
		}
		services[svc.Listen] = svc
	}
	return services, nil
}

func (s *supervisor) stop() {
	for _, r := range s.active {
		r.cancel()
	}
	for _, r := range s.active {
		<-r.done
	}
	s.active = make(map[string]running)
}

func (s *supervisor) apply(ctx context.Context, cfg *config.Config, services map[string]*imitor.Service) {
	wanted := make(map[string]imitor.ServiceConfig)
	for _, sc := range cfg.Services {
		svc, _ := imitor.NewService(sc, s.logger)
		wanted[svc.Listen] = sc
	}
	// Stop every changed/removed listener before starting any replacement,
	// including changes between wildcard and specific addresses on one port.
	for addr, r := range s.active {
		sc, exists := wanted[addr]
		if !exists || !reflect.DeepEqual(sc, r.cfg) {
			r.cancel()
		}
	}
	for addr, r := range s.active {
		sc, exists := wanted[addr]
		if !exists || !reflect.DeepEqual(sc, r.cfg) {
			<-r.done
			delete(s.active, addr)
		}
	}
	for addr, svc := range services {
		if _, exists := s.active[addr]; exists {
			continue
		}
		runCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		s.active[addr] = running{cfg: wanted[addr], cancel: cancel, done: done}
		go func() {
			defer close(done)
			if err := svc.Run(runCtx); err != nil {
				select {
				case s.errors <- fmt.Errorf("%s: %w", svc.Name, err):
				case <-runCtx.Done():
				}
			}
		}()
	}
	s.current = cfg
}

func report(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "managed agent:", err)
	}
}

func Run(ctx context.Context, o Options) error {
	if err := secureURL(o.GatewayURL); err != nil {
		return fmt.Errorf("gateway: %w", err)
	}
	if o.EnrollmentURL != "" {
		if err := secureURL(o.EnrollmentURL); err != nil {
			return fmt.Errorf("enrollment: %w", err)
		}
	}
	if o.PollInterval <= 0 || o.PollInterval > 60*time.Second {
		return fmt.Errorf("poll interval must be >0 and <=60s")
	}
	if err := privateDir(o.StateDir); err != nil {
		return err
	}
	spool, err := NewSpool(filepath.Join(o.StateDir, "events"))
	if err != nil {
		return err
	}
	client, err := connect(ctx, o)
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	s := &supervisor{logger: imitor.NewLogger(spool), active: make(map[string]running), errors: make(chan error, 1)}
	defer s.stop()
	cache := filepath.Join(o.StateDir, "config.json")
	if b, err := readLimited(cache, 4<<20); err == nil {
		var cfg config.Config
		if err := json.Unmarshal(b, &cfg); err != nil {
			report(fmt.Errorf("cached config: %w", err))
		} else if services, err := s.prepare(&cfg); err != nil {
			report(fmt.Errorf("cached config: %w", err))
		} else {
			s.apply(ctx, &cfg, services)
		}
	} else if !os.IsNotExist(err) {
		report(err)
	}
	base := strings.TrimRight(o.GatewayURL, "/")
	tick := time.NewTicker(o.PollInterval)
	defer tick.Stop()
	for {
		status, _, err := request(ctx, client, http.MethodPost, base+"/heartbeat", nil)
		if err != nil {
			report(fmt.Errorf("heartbeat: %w", err))
		} else if status < 200 || status >= 300 {
			report(fmt.Errorf("heartbeat: HTTP %d", status))
		}
		report(spool.Flush(ctx, client, base+"/events"))
		status, b, err := request(ctx, client, http.MethodGet, base+"/config", nil)
		if err != nil {
			report(fmt.Errorf("config: %w", err))
		} else if status == http.StatusOK {
			var cfg config.Config
			if err := json.Unmarshal(b, &cfg); err != nil {
				report(err)
			} else if s.current == nil || cfg.Version != s.current.Version {
				services, err := s.prepare(&cfg)
				if err != nil {
					report(fmt.Errorf("reject config: %w", err))
				} else if err := atomicWrite(cache, b); err != nil {
					report(fmt.Errorf("cache config: %w", err))
				} else {
					s.apply(ctx, &cfg, services)
				}
			}
		} else if status != http.StatusNotFound {
			report(fmt.Errorf("config: HTTP %d", status))
		}
		if o.Executor != nil {
			command, err := claimCommand(ctx, client, base)
			if err != nil {
				report(err)
			} else if command != nil {
				report(executeCommand(ctx, client, base, o.Executor, *command))
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case err := <-s.errors:
			return err
		case <-tick.C:
		}
	}
}
