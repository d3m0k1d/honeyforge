package qemu

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"d3m0k1d.ru/internal/orchestrator"
)

const maxArtifactSize = 16 << 20

type commandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type osRunner struct{}

func (osRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type Options struct {
	StateDir      string
	ImageDir      string
	QEMU          string
	QEMUImg       string
	VirtCustomize string
}

type Manager struct {
	options Options
	runner  commandRunner
}

type payload struct {
	Driver string `json:"driver"`
	Config struct {
		Image                  string `json:"image"`
		VCPUs                  int    `json:"vcpus"`
		MemoryMB               int    `json:"memory_mb"`
		DiskGB                 int    `json:"disk_gb"`
		ProvisioningArtifactID string `json:"provisioning_artifact_id"`
		ProvisioningKind       string `json:"provisioning_kind"`
		ProvisioningEntrypoint string `json:"provisioning_entrypoint"`
		ProvisioningTimeout    int    `json:"provisioning_timeout_seconds"`
		PortForwards           []struct {
			Protocol   string `json:"protocol"`
			ListenHost string `json:"listen_host"`
			HostPort   int    `json:"host_port"`
			GuestPort  int    `json:"guest_port"`
		} `json:"port_forwards"`
		CloudInit *struct {
			Hostname          string   `json:"hostname"`
			Username          string   `json:"username"`
			SSHAuthorizedKeys []string `json:"ssh_authorized_keys"`
			UserData          *string  `json:"user_data"`
			NetworkConfig     *string  `json:"network_config"`
			WaitTimeout       int      `json:"wait_timeout_seconds"`
			CompletionMarker  string   `json:"completion_marker"`
		} `json:"cloud_init"`
	} `json:"config"`
	SnapshotID string `json:"snapshot_id"`
}

func New(options Options) (*Manager, error) {
	if options.StateDir == "" || options.ImageDir == "" {
		return nil, errors.New("qemu state and image directories are required")
	}
	if options.QEMU == "" {
		options.QEMU = "qemu-system-x86_64"
	}
	if options.QEMUImg == "" {
		options.QEMUImg = "qemu-img"
	}
	if options.VirtCustomize == "" {
		options.VirtCustomize = "virt-customize"
	}
	if err := os.MkdirAll(options.StateDir, 0o700); err != nil {
		return nil, fmt.Errorf("create qemu state directory: %w", err)
	}
	return &Manager{options: options, runner: osRunner{}}, nil
}

func (m *Manager) Execute(ctx context.Context, command orchestrator.Command, load orchestrator.ArtifactLoader) (orchestrator.Result, error) {
	if !validID(command.DeploymentID) {
		return orchestrator.Result{}, errors.New("invalid deployment id")
	}
	var p payload
	if err := json.Unmarshal(command.Payload, &p); err != nil {
		return orchestrator.Result{}, fmt.Errorf("decode command payload: %w", err)
	}
	if p.Driver != "qemu-ansible" {
		return orchestrator.Result{}, fmt.Errorf("unsupported deployment driver %q", p.Driver)
	}
	switch command.Type {
	case "deploy":
		return m.deploy(ctx, command, p, load)
	case "start":
		return orchestrator.Result{}, m.start(ctx, command.DeploymentID, p)
	case "stop":
		err := m.stop(ctx, command.DeploymentID)
		if errors.Is(err, os.ErrNotExist) {
			err = nil
		}
		return orchestrator.Result{}, err
	case "destroy":
		if err := m.stop(ctx, command.DeploymentID); err != nil && !errors.Is(err, os.ErrNotExist) {
			return orchestrator.Result{}, err
		}
		return orchestrator.Result{}, os.RemoveAll(m.deploymentDir(command.DeploymentID))
	case "vm.snapshot":
		return m.snapshot(ctx, command.DeploymentID, p.SnapshotID)
	case "vm.reset":
		return orchestrator.Result{}, m.reset(ctx, command.DeploymentID, p.SnapshotID)
	default:
		return orchestrator.Result{}, fmt.Errorf("unsupported qemu command %q", command.Type)
	}
}

func validID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, r := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
			continue
		}
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}

func (m *Manager) deploymentDir(id string) string {
	return filepath.Join(m.options.StateDir, id)
}

func (m *Manager) imagePath(name string) (string, error) {
	if !filepath.IsLocal(name) || filepath.Base(name) != name {
		return "", errors.New("image must be a local file name")
	}
	path := filepath.Join(m.options.ImageDir, name)
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("base image: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("base image is not a regular file")
	}
	return path, nil
}

func (m *Manager) deploy(ctx context.Context, command orchestrator.Command, p payload, load orchestrator.ArtifactLoader) (orchestrator.Result, error) {
	image, err := m.imagePath(p.Config.Image)
	if err != nil {
		return orchestrator.Result{}, err
	}
	dir := m.deploymentDir(command.DeploymentID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return orchestrator.Result{}, err
	}
	disk := filepath.Join(dir, "disk.qcow2")
	completionPath := filepath.Join(dir, "completed-"+command.ID)
	if generation, err := os.ReadFile(completionPath); err == nil && strings.TrimSpace(string(generation)) == strconv.Itoa(command.Generation) {
		if err := m.start(ctx, command.DeploymentID, p); err != nil {
			return orchestrator.Result{}, err
		}
		return orchestrator.Result{Data: map[string]any{"disk": disk, "replayed": true}}, nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return orchestrator.Result{}, err
	}
	if _, err := os.Stat(disk); errors.Is(err, os.ErrNotExist) {
		if err := m.run(ctx, m.options.QEMUImg, "create", "-f", "qcow2", "-F", "qcow2", "-b", image, disk); err != nil {
			return orchestrator.Result{}, err
		}
	} else if err != nil {
		return orchestrator.Result{}, err
	}
	if p.Config.DiskGB > 0 {
		if err := m.run(ctx, m.options.QEMUImg, "resize", disk, fmt.Sprintf("%dG", p.Config.DiskGB)); err != nil {
			return orchestrator.Result{}, err
		}
	}
	if p.Config.ProvisioningArtifactID != "" {
		artifact, err := load(ctx, command.ID, p.Config.ProvisioningArtifactID)
		if err != nil {
			return orchestrator.Result{}, fmt.Errorf("download provisioning artifact: %w", err)
		}
		if len(artifact) > maxArtifactSize {
			return orchestrator.Result{}, errors.New("provisioning artifact is too large")
		}
		timeout := p.Config.ProvisioningTimeout
		if timeout == 0 {
			timeout = 600
		}
		if timeout < 10 || timeout > 7200 {
			return orchestrator.Result{}, errors.New("invalid provisioning timeout")
		}
		provisionCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
		err = m.provision(provisionCtx, disk, p, artifact)
		cancel()
		if err != nil {
			return orchestrator.Result{}, err
		}
	}
	if p.Config.CloudInit != nil {
		if err := m.prepareCloudInit(ctx, command.DeploymentID, p); err != nil {
			return orchestrator.Result{}, err
		}
	}
	if err := m.start(ctx, command.DeploymentID, p); err != nil {
		return orchestrator.Result{}, err
	}
	if err := m.waitCloudInit(ctx, command.DeploymentID, p); err != nil {
		return orchestrator.Result{}, err
	}
	if err := writeMarker(completionPath, command.Generation); err != nil {
		return orchestrator.Result{}, err
	}
	return orchestrator.Result{Data: map[string]any{"disk": disk}}, nil
}

func (m *Manager) prepareCloudInit(ctx context.Context, id string, p payload) error {
	cloud := p.Config.CloudInit
	if cloud == nil {
		return nil
	}
	dir := m.deploymentDir(id)
	seedDir := filepath.Join(dir, "cloud-init")
	if err := os.MkdirAll(seedDir, 0o700); err != nil {
		return err
	}
	meta, err := json.Marshal(map[string]string{
		"instance-id":    "honeypotforge-" + id,
		"local-hostname": cloud.Hostname,
	})
	if err != nil {
		return err
	}
	userData := ""
	if cloud.UserData != nil {
		userData, err = cloudUserData(*cloud.UserData, cloud.CompletionMarker)
		if err != nil {
			return err
		}
	} else {
		config := map[string]any{
			"hostname":            cloud.Hostname,
			"manage_etc_hosts":    true,
			"ssh_authorized_keys": cloud.SSHAuthorizedKeys,
			"ssh_pwauth":          false,
			"disable_root":        true,
			"final_message":       cloud.CompletionMarker,
			"users":               []map[string]any{{"name": cloud.Username, "groups": "sudo", "shell": "/bin/bash", "sudo": "ALL=(ALL) NOPASSWD:ALL", "ssh_authorized_keys": cloud.SSHAuthorizedKeys}},
		}
		body, err := json.Marshal(config)
		if err != nil {
			return err
		}
		userData = "#cloud-config\n" + string(body) + "\n"
	}
	metaPath := filepath.Join(seedDir, "meta-data")
	userPath := filepath.Join(seedDir, "user-data")
	if err := os.WriteFile(metaPath, meta, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(userPath, []byte(userData), 0o600); err != nil {
		return err
	}
	seedPath := filepath.Join(dir, "seed.img")
	args := make([]string, 0, 4)
	if cloud.NetworkConfig != nil {
		networkPath := filepath.Join(seedDir, "network-config")
		if err := os.WriteFile(networkPath, []byte(*cloud.NetworkConfig), 0o600); err != nil {
			return err
		}
		args = append(args, "--network-config="+networkPath)
	}
	args = append(args, seedPath, userPath, metaPath)
	return m.run(ctx, "cloud-localds", args...)
}

func cloudUserData(custom, marker string) (string, error) {
	var output bytes.Buffer
	writer := multipart.NewWriter(&output)
	contentType := "text/cloud-config"
	if strings.HasPrefix(strings.TrimSpace(custom), "#!") {
		contentType = "text/x-shellscript"
	}
	for _, part := range []struct {
		contentType string
		content     string
	}{
		{contentType: contentType, content: custom},
		{contentType: "text/cloud-config", content: "#cloud-config\n" + fmt.Sprintf("{\"final_message\":%q}\n", marker)},
	} {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Type", part.contentType)
		body, err := writer.CreatePart(header)
		if err != nil {
			return "", err
		}
		if _, err := body.Write([]byte(part.content)); err != nil {
			return "", err
		}
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	return "MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=\"" + writer.Boundary() + "\"\n\n" + output.String(), nil
}

func (m *Manager) waitCloudInit(ctx context.Context, id string, p payload) error {
	cloud := p.Config.CloudInit
	if cloud == nil || cloud.WaitTimeout == 0 {
		return nil
	}
	if cloud.CompletionMarker == "" {
		return errors.New("cloud-init completion marker is required")
	}
	deadline := time.NewTimer(time.Duration(cloud.WaitTimeout) * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	serial := filepath.Join(m.deploymentDir(id), "serial.log")
	for {
		found, err := fileContains(serial, cloud.CompletionMarker, 1<<20)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if found {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return errors.New("cloud-init completion timed out")
		case <-ticker.C:
		}
	}
}

func (m *Manager) provision(ctx context.Context, disk string, p payload, artifact []byte) error {
	kind := p.Config.ProvisioningKind
	if kind == "" {
		kind = "shell"
	}
	if kind != "shell" && kind != "ansible" {
		return fmt.Errorf("unsupported provisioning kind %q", kind)
	}
	name := "provision.sh"
	if kind == "ansible" {
		name = "provision.yml"
	}
	path := filepath.Join(filepath.Dir(disk), name)
	if err := os.WriteFile(path, artifact, 0o600); err != nil {
		return err
	}
	defer os.Remove(path)
	args := []string{"-a", disk}
	if kind == "shell" {
		args = append(args, "--run", path)
	} else {
		guestPath := "/root/honeypotforge-provision.yml"
		args = append(args,
			"--upload", path+":"+guestPath,
			"--run-command", "ansible-playbook --connection=local -i localhost, "+guestPath,
			"--delete", guestPath,
		)
	}
	return m.run(ctx, m.options.VirtCustomize, args...)
}

func (m *Manager) start(ctx context.Context, id string, p payload) error {
	dir := m.deploymentDir(id)
	disk := filepath.Join(dir, "disk.qcow2")
	if _, err := os.Stat(disk); err != nil {
		return err
	}
	if running(filepath.Join(dir, "qemu.pid")) {
		return nil
	}
	memory := p.Config.MemoryMB
	if memory == 0 {
		memory = 2048
	}
	vcpus := p.Config.VCPUs
	if vcpus == 0 {
		vcpus = 2
	}
	if memory < 256 || memory > 65536 || vcpus < 1 || vcpus > 32 {
		return errors.New("invalid VM resource limits")
	}
	netdev := "user,id=net0,restrict=on"
	seenForwards := make(map[string]struct{}, len(p.Config.PortForwards))
	for _, forward := range p.Config.PortForwards {
		if forward.Protocol != "tcp" && forward.Protocol != "udp" {
			return errors.New("port forward protocol must be tcp or udp")
		}
		if net.ParseIP(forward.ListenHost) == nil || forward.HostPort < 1 || forward.HostPort > 65535 || forward.GuestPort < 1 || forward.GuestPort > 65535 {
			return errors.New("invalid port forward")
		}
		key := fmt.Sprintf("%s/%s/%d", forward.Protocol, forward.ListenHost, forward.HostPort)
		if _, exists := seenForwards[key]; exists {
			return errors.New("duplicate host port forward")
		}
		seenForwards[key] = struct{}{}
		netdev += fmt.Sprintf(",hostfwd=%s:%s:%d-:%d", forward.Protocol, forward.ListenHost, forward.HostPort, forward.GuestPort)
	}
	args := []string{
		"-name", "hf-" + id,
		"-daemonize",
		"-pidfile", filepath.Join(dir, "qemu.pid"),
		"-qmp", "unix:" + filepath.Join(dir, "qmp.sock") + ",server=on,wait=off",
		"-drive", "file=" + disk + ",if=virtio,format=qcow2,cache=none",
		"-m", strconv.Itoa(memory),
		"-smp", strconv.Itoa(vcpus),
		"-display", "none",
		"-serial", "file:" + filepath.Join(dir, "serial.log"),
		"-netdev", netdev,
		"-device", "virtio-net-pci,netdev=net0",
	}
	seed := filepath.Join(dir, "seed.img")
	if _, err := os.Stat(seed); err == nil {
		args = append(args, "-drive", "file="+seed+",if=virtio,format=raw,readonly=on")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return m.run(ctx, m.options.QEMU, args...)
}

func running(pidPath string) bool {
	b, err := os.ReadFile(pidPath)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 1 {
		return false
	}
	process, err := os.FindProcess(pid)
	return err == nil && process.Signal(syscall.Signal(0)) == nil
}

func (m *Manager) stop(ctx context.Context, id string) error {
	dir := m.deploymentDir(id)
	pidPath := filepath.Join(dir, "qemu.pid")
	b, err := os.ReadFile(pidPath)
	if errors.Is(err, os.ErrNotExist) {
		return os.ErrNotExist
	}
	if err != nil {
		return err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 1 {
		return errors.New("invalid qemu pid file")
	}
	_ = m.qmp(ctx, id, "system_powerdown", nil)
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if process.Signal(syscall.Signal(0)) != nil {
			_ = os.Remove(pidPath)
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	if err := process.Signal(syscall.SIGKILL); err != nil {
		return err
	}
	return os.Remove(pidPath)
}

func (m *Manager) snapshot(ctx context.Context, id, snapshotID string) (orchestrator.Result, error) {
	if !validID(snapshotID) {
		return orchestrator.Result{}, errors.New("invalid snapshot id")
	}
	if err := m.humanMonitor(ctx, id, "savevm hf-"+snapshotID); err != nil {
		return orchestrator.Result{}, err
	}
	disk := filepath.Join(m.deploymentDir(id), "disk.qcow2")
	info, err := os.Stat(disk)
	if err != nil {
		return orchestrator.Result{}, err
	}
	return orchestrator.Result{
		Data:              map[string]any{"snapshot": "hf-" + snapshotID},
		SnapshotPath:      disk + "#hf-" + snapshotID,
		SnapshotSizeBytes: info.Size(),
	}, nil
}

func (m *Manager) reset(ctx context.Context, id, snapshotID string) error {
	if !validID(snapshotID) {
		return errors.New("invalid snapshot id")
	}
	return m.humanMonitor(ctx, id, "loadvm hf-"+snapshotID)
}

func (m *Manager) humanMonitor(ctx context.Context, id, command string) error {
	return m.qmp(ctx, id, "human-monitor-command", map[string]any{"command-line": command})
}

func (m *Manager) qmp(ctx context.Context, id, command string, arguments map[string]any) error {
	dialer := net.Dialer{Timeout: 3 * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", filepath.Join(m.deploymentDir(id), "qmp.sock"))
	if err != nil {
		return fmt.Errorf("connect qmp: %w", err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	}
	reader := bufio.NewReader(conn)
	if _, err := reader.ReadBytes('\n'); err != nil {
		return fmt.Errorf("read qmp greeting: %w", err)
	}
	if err := qmpExchange(reader, conn, map[string]any{"execute": "qmp_capabilities"}); err != nil {
		return err
	}
	request := map[string]any{"execute": command}
	if arguments != nil {
		request["arguments"] = arguments
	}
	return qmpExchange(reader, conn, request)
}

func qmpExchange(reader *bufio.Reader, conn net.Conn, request map[string]any) error {
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return err
	}
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return err
		}
		var response map[string]json.RawMessage
		if err := json.Unmarshal(line, &response); err != nil {
			return err
		}
		if raw, ok := response["error"]; ok {
			return fmt.Errorf("qmp error: %s", raw)
		}
		if _, ok := response["return"]; ok {
			return nil
		}
	}
}

func (m *Manager) run(ctx context.Context, name string, args ...string) error {
	output, err := m.runner.Run(ctx, name, args...)
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 2048 {
			message = message[:2048]
		}
		return fmt.Errorf("%s failed: %w: %s", filepath.Base(name), err, message)
	}
	return nil
}

func fileContains(path, marker string, limit int64) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	start := info.Size() - limit
	if start < 0 {
		start = 0
	}
	if _, err := f.Seek(start, 0); err != nil {
		return false, err
	}
	data := make([]byte, info.Size()-start)
	if _, err := io.ReadFull(f, data); err != nil {
		return false, err
	}
	return strings.Contains(string(data), marker), nil
}

func writeMarker(path string, generation int) error {
	temp := path + ".tmp"
	if err := os.WriteFile(temp, []byte(strconv.Itoa(generation)), 0o600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
