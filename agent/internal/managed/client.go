package managed

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"d3m0k1d.ru/internal/orchestrator"
)

const maxBundle = 512 << 10

type Options struct {
	GatewayURL      string
	EnrollmentURL   string
	EnrollmentToken string
	BootstrapCA     string
	StateDir        string
	PollInterval    time.Duration
	Executor        orchestrator.Executor
}

func secureURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("managed endpoint must be an HTTPS URL without credentials, query or fragment")
	}
	return nil
}

func httpClient(cfg *tls.Config, timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{TLSClientConfig: cfg, ResponseHeaderTimeout: timeout},
		// Never redirect tokens or client credentials to another endpoint.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func roots(b []byte) (*x509.CertPool, error) {
	pool := x509.NewCertPool()
	var count int
	for len(bytes.TrimSpace(b)) > 0 {
		block, rest := pem.Decode(b)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, fmt.Errorf("invalid CA PEM")
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, err
		}
		if !cert.IsCA || !cert.BasicConstraintsValid {
			return nil, fmt.Errorf("CA certificate lacks CA constraints")
		}
		pool.AddCert(cert)
		count++
		b = rest
	}
	if count == 0 {
		return nil, fmt.Errorf("empty CA certificate")
	}
	return pool, nil
}

func bundleTLS(b []byte) (*tls.Config, map[string][]byte, error) {
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, nil, err
	}
	if len(z.File) != 4 {
		return nil, nil, fmt.Errorf("certificate archive must contain exactly four files")
	}
	files := make(map[string][]byte)
	for _, f := range z.File {
		switch f.Name {
		case "ca.crt", "client.crt", "client.key", "fullchain.crt":
		default:
			return nil, nil, fmt.Errorf("unexpected certificate archive path %q", f.Name)
		}
		if _, exists := files[f.Name]; exists || !f.Mode().IsRegular() || f.UncompressedSize64 > 128<<10 {
			return nil, nil, fmt.Errorf("invalid certificate archive entry %q", f.Name)
		}
		r, err := f.Open()
		if err != nil {
			return nil, nil, err
		}
		data, err := limited(r, 128<<10)
		closeErr := r.Close()
		if err != nil {
			return nil, nil, err
		}
		if closeErr != nil {
			return nil, nil, closeErr
		}
		files[f.Name] = data
	}
	pool, err := roots(files["ca.crt"])
	if err != nil {
		return nil, nil, err
	}
	cert, err := tls.X509KeyPair(files["fullchain.crt"], files["client.key"])
	if err != nil {
		return nil, nil, fmt.Errorf("fullchain key pair: %w", err)
	}
	leafPair, err := tls.X509KeyPair(files["client.crt"], files["client.key"])
	if err != nil {
		return nil, nil, fmt.Errorf("client key pair: %w", err)
	}
	if !bytes.Equal(cert.Certificate[0], leafPair.Certificate[0]) {
		return nil, nil, fmt.Errorf("fullchain does not start with client certificate")
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return nil, nil, err
	}
	if leaf.Subject.CommonName == "" {
		return nil, nil, fmt.Errorf("client certificate has no agent CN")
	}
	intermediates := x509.NewCertPool()
	for _, der := range cert.Certificate[1:] {
		c, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, nil, err
		}
		intermediates.AddCert(c)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: pool, Intermediates: intermediates, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		return nil, nil, fmt.Errorf("verify client certificate: %w", err)
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool, Certificates: []tls.Certificate{cert}}, files, nil
}

func connect(ctx context.Context, o Options) (*http.Client, error) {
	path := filepath.Join(o.StateDir, "certificates.zip")
	b, err := readLimited(path, maxBundle)
	if err == nil {
		cfg, _, err := bundleTLS(b)
		if err != nil {
			return nil, fmt.Errorf("persisted certificates: %w", err)
		}
		return httpClient(cfg, 10*time.Second), nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	if err := secureURL(o.EnrollmentURL); err != nil {
		return nil, fmt.Errorf("enrollment: %w", err)
	}
	if o.EnrollmentToken == "" || o.BootstrapCA == "" {
		return nil, fmt.Errorf("enrollment token and bootstrap CA are required for first enrollment")
	}
	ca, err := readLimited(o.BootstrapCA, 128<<10)
	if err != nil {
		return nil, err
	}
	pool, err := roots(ca)
	if err != nil {
		return nil, err
	}
	// Certificate issuance can take up to 60 seconds. Timing out earlier can
	// lose the response after the API has consumed the one-time token.
	client := httpClient(&tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}, 75*time.Second)
	defer client.CloseIdleConnections()
	body, err := json.Marshal(map[string]string{"token": o.EnrollmentToken})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.EnrollmentURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("enroll: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("enroll: HTTP %d", resp.StatusCode)
	}
	b, err = limited(resp.Body, maxBundle)
	if err != nil {
		return nil, err
	}
	cfg, files, err := bundleTLS(b)
	if err != nil {
		return nil, err
	}
	// Commit the validated ZIP atomically last. An interrupted extraction is
	// never mistaken for completed enrollment on the next start.
	for name, data := range files {
		if err := atomicWrite(filepath.Join(o.StateDir, name), data); err != nil {
			return nil, err
		}
	}
	if err := atomicWrite(path, b); err != nil {
		return nil, err
	}
	return httpClient(cfg, 10*time.Second), nil
}

func request(ctx context.Context, client *http.Client, method, endpoint string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, err := limited(resp.Body, 4<<20)
	return resp.StatusCode, b, err
}

func (s *Spool) Flush(ctx context.Context, client *http.Client, endpoint string) error {
	s.flushMu.Lock()
	defer s.flushMu.Unlock()
	names, events, err := s.batch()
	if err != nil || len(names) == 0 {
		return err
	}
	b, err := json.Marshal(struct {
		Events []json.RawMessage `json:"events"`
	}{events})
	if err != nil {
		return err
	}
	status, b, err := request(ctx, client, http.MethodPost, endpoint, b)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("events: HTTP %d", status)
	}
	var ack struct {
		Accepted int `json:"accepted"`
	}
	if err := json.Unmarshal(b, &ack); err != nil {
		return err
	}
	if ack.Accepted != len(names) {
		return fmt.Errorf("events: accepted %d, expected %d", ack.Accepted, len(names))
	}
	return s.acknowledge(names)
}
