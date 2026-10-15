// Command agent запускает эмулируемые сервисы — low/mid level honeypot.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"d3m0k1d.ru/internal/config"
	"d3m0k1d.ru/internal/imitor"
	"d3m0k1d.ru/internal/managed"
	"d3m0k1d.ru/internal/orchestrator"
	"d3m0k1d.ru/internal/qemu"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "runtime worker:", err)
		os.Exit(1)
	}
}

func run() error {
	workerName := envOr("HONEYPOT_WORKER_NAME", envOr("HONEYPOT_PROCESS_NAME", "runtime-worker"))
	setProcessName(workerName)
	source := flag.String("config", envOr("HONEYPOT_CONFIG", "configs/config.json"), "path or URL of the JSON configuration")
	token := flag.String("token", envOr("HONEYPOT_TOKEN", ""), "Bearer token for fetching config from the API")
	list := flag.Bool("list", false, "print the built-in service types and exit")
	gateway := flag.String("gateway-url", envOr("HONEYPOT_GATEWAY_URL", ""), "HTTPS runtime gateway base URL; enables managed mode")
	enrollment := flag.String("enrollment-url", envOr("HONEYPOT_ENROLLMENT_URL", ""), "HTTPS enrollment endpoint (including /agents/enroll)")
	enrollmentToken := flag.String("enrollment-token", envOr("HONEYPOT_ENROLLMENT_TOKEN", ""), "one-time enrollment token")
	bootstrapCA := flag.String("bootstrap-ca", envOr("HONEYPOT_BOOTSTRAP_CA", ""), "PEM CA file for enrollment server verification")
	stateDir := flag.String("state-dir", envOr("HONEYPOT_STATE_DIR", "/var/lib/honeypot-agent"), "private managed state directory")
	poll := flag.String("poll-interval", envOr("HONEYPOT_POLL_INTERVAL", "5s"), "managed polling interval (>0, <=60s)")
	qemuImages := flag.String("qemu-images", envOr("HONEYPOT_QEMU_IMAGE_DIR", ""), "directory containing trusted QEMU base images")
	flag.Parse()

	if *list {
		for _, t := range imitor.BuiltinTypes() {
			fmt.Println(t)
		}
		return nil
	}
	if *gateway != "" {
		interval, err := time.ParseDuration(*poll)
		if err != nil {
			return fmt.Errorf("poll interval: %w", err)
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		var executor orchestrator.Executor
		if *qemuImages != "" {
			agentBinary, err := os.Executable()
			if err != nil {
				return fmt.Errorf("resolve runtime worker binary: %w", err)
			}
			manager, err := qemu.New(qemu.Options{
				StateDir:        filepath.Join(*stateDir, "qemu"),
				ImageDir:        *qemuImages,
				AgentBinary:     agentBinary,
				GatewayURL:      envOr("HONEYPOT_QEMU_GATEWAY_URL", "https://10.0.2.2:8443"),
				EnrollmentURL:   envOr("HONEYPOT_QEMU_ENROLLMENT_URL", "https://10.0.2.2:8444/agents/enroll"),
				EnrollmentToken: *enrollmentToken,
				BootstrapCA:     *bootstrapCA,
			})
			if err != nil {
				return err
			}
			executor = manager
		}
		return managed.Run(ctx, managed.Options{
			GatewayURL: *gateway, EnrollmentURL: *enrollment,
			EnrollmentToken: *enrollmentToken, BootstrapCA: *bootstrapCA,
			StateDir: *stateDir, PollInterval: interval, Executor: executor,
			SerialLog:    envOr("HONEYPOT_SERIAL_LOG", ""),
			SerialOnly:   envOr("HONEYPOT_SERIAL_ONLY", "false") == "true",
			SerialBridge: executor != nil,
		})
	}

	cfg, err := config.Load(*source, *token)
	if err != nil {
		return err
	}

	out, closer, err := openLog(cfg.Log.Output)
	if err != nil {
		return err
	}
	if closer != nil {
		defer closer.Close()
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger := imitor.NewLogger(out)

	var wg sync.WaitGroup
	errCh := make(chan error, len(cfg.Services))
	for i, sc := range cfg.Services {
		svc, err := imitor.NewService(sc, logger)
		if err != nil {
			return fmt.Errorf("service #%d: %w", i+1, err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := svc.Run(ctx); err != nil {
				select {
				case errCh <- fmt.Errorf("%s: %w", svc.Name, err):
				default:
				}
			}
		}()
	}

	var runErr error
	select {
	case <-ctx.Done():
	case runErr = <-errCh:
		stop()
	}
	wg.Wait()
	return runErr
}

func openLog(output string) (io.Writer, *os.File, error) {
	if o := strings.TrimSpace(output); o == "" || o == "stdout" {
		return os.Stdout, nil, nil
	}
	f, err := os.OpenFile(output, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("open log file: %w", err)
	}
	return f, f, nil
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
