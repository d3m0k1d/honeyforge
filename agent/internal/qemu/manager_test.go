package qemu

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"d3m0k1d.ru/internal/orchestrator"
)

const (
	deploymentID = "11111111-1111-1111-1111-111111111111"
	commandID    = "22222222-2222-2222-2222-222222222222"
	artifactID   = "33333333-3333-3333-3333-333333333333"
)

type invocation struct {
	name string
	args []string
}

type fakeRunner struct {
	calls []invocation
}

func (r *fakeRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	r.calls = append(r.calls, invocation{name: name, args: slices.Clone(args)})
	if name == "qemu-img" && len(args) > 0 && args[0] == "create" {
		if err := os.WriteFile(args[len(args)-1], []byte("qcow2"), 0o600); err != nil {
			return nil, err
		}
	}
	if name == "cloud-localds" {
		seed := args[0]
		if strings.HasPrefix(seed, "--network-config=") {
			seed = args[1]
		}
		if err := os.WriteFile(seed, []byte("seed"), 0o600); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

func newTestManager(t *testing.T) (*Manager, *fakeRunner) {
	t.Helper()
	root := t.TempDir()
	images := filepath.Join(root, "images")
	if err := os.Mkdir(images, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(images, "ubuntu.qcow2"), []byte("base"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(Options{StateDir: filepath.Join(root, "state"), ImageDir: images})
	if err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	manager.runner = runner
	return manager, runner
}

func deployCommand(t *testing.T, kind string) orchestrator.Command {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"driver": "qemu-ansible",
		"config": map[string]any{
			"image": "ubuntu.qcow2", "vcpus": 2, "memory_mb": 1024,
			"provisioning_artifact_id": artifactID,
			"provisioning_kind":        kind,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return orchestrator.Command{ID: commandID, DeploymentID: deploymentID, Type: "deploy", Payload: payload}
}

func TestManagerDeployShellInsideGuest(t *testing.T) {
	manager, runner := newTestManager(t)
	loaded := false
	_, err := manager.Execute(t.Context(), deployCommand(t, "shell"), func(_ context.Context, command, artifact string) ([]byte, error) {
		loaded = command == commandID && artifact == artifactID
		return []byte("#!/bin/sh\ntouch /root/provisioned\n"), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !loaded {
		t.Fatal("artifact loader did not receive command-scoped identifiers")
	}
	if len(runner.calls) != 3 {
		t.Fatalf("got %d commands, want qemu-img, virt-customize and qemu", len(runner.calls))
	}
	if runner.calls[1].name != "virt-customize" || !slices.Contains(runner.calls[1].args, "--run") {
		t.Fatalf("shell provisioning escaped guest boundary: %#v", runner.calls[1])
	}
	for _, call := range runner.calls {
		if call.name == "sh" || call.name == "bash" || slices.Contains(call.args, "-c") {
			t.Fatalf("host shell execution is forbidden: %#v", call)
		}
	}
	if runner.calls[2].name != "qemu-system-x86_64" || !slices.Contains(runner.calls[2].args, "user,id=net0,restrict=on") {
		t.Fatalf("qemu sandbox arguments missing: %#v", runner.calls[2])
	}
}

func TestManagerDeployAnsibleInsideGuest(t *testing.T) {
	manager, runner := newTestManager(t)
	_, err := manager.Execute(t.Context(), deployCommand(t, "ansible"), func(context.Context, string, string) ([]byte, error) {
		return []byte("- hosts: localhost\n  tasks: []\n"), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(runner.calls[1].args, " ")
	if !strings.Contains(args, "--upload") || !strings.Contains(args, "ansible-playbook --connection=local") {
		t.Fatalf("ansible must execute in the guest: %s", args)
	}
}

func TestManagerInstallsRuntimeWorkerForTelemetry(t *testing.T) {
	manager, runner := newTestManager(t)
	root := t.TempDir()
	binary := filepath.Join(root, "runtime-worker")
	ca := filepath.Join(root, "ca.crt")
	if err := os.WriteFile(binary, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ca, []byte("ca"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager.options.AgentBinary = binary
	manager.options.BootstrapCA = ca
	manager.options.GatewayURL = "https://10.0.2.2:8443"
	manager.options.EnrollmentURL = "https://10.0.2.2:8444/agents/enroll"
	manager.options.EnrollmentToken = "enrollment-token"
	if _, err := manager.Execute(t.Context(), deployCommand(t, "shell"), func(context.Context, string, string) ([]byte, error) {
		return []byte("#!/bin/sh\n"), nil
	}); err != nil {
		t.Fatal(err)
	}
	var args string
	for _, call := range runner.calls {
		candidate := strings.Join(call.args, " ")
		if call.name == "virt-customize" && strings.Contains(candidate, "/etc/systemd/system/runtime-worker.service") {
			args = candidate
		}
	}
	for _, expected := range []string{
		"/usr/local/libexec/runtime-worker",
		"/etc/runtime-worker/ca.crt",
		"runtime-worker.env",
		"/etc/systemd/system/runtime-worker.service",
		"systemctl enable runtime-worker.service",
	} {
		if !strings.Contains(args, expected) {
			t.Fatalf("runtime worker bootstrap missing %q: %s", expected, args)
		}
	}
}

func TestManagerAddsValidatedPortForwards(t *testing.T) {
	manager, runner := newTestManager(t)
	command := deployCommand(t, "shell")
	var payload map[string]any
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["config"].(map[string]any)["port_forwards"] = []map[string]any{{
		"protocol": "tcp", "listen_host": "0.0.0.0", "host_port": 2222, "guest_port": 22,
	}}
	command.Payload, _ = json.Marshal(payload)
	_, err := manager.Execute(t.Context(), command, func(context.Context, string, string) ([]byte, error) {
		return []byte("#!/bin/sh\n"), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(runner.calls[len(runner.calls)-1].args, " ")
	if !strings.Contains(args, "hostfwd=tcp:0.0.0.0:2222-:22") {
		t.Fatalf("missing host forward: %s", args)
	}
}

func TestManagerBuildsCloudInitSeed(t *testing.T) {
	manager, runner := newTestManager(t)
	command := deployCommand(t, "shell")
	var payload map[string]any
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["config"].(map[string]any)["cloud_init"] = map[string]any{
		"hostname": "decoy-01", "username": "sensor",
		"ssh_authorized_keys":  []string{"ssh-ed25519 AAAATEST"},
		"wait_timeout_seconds": 0, "completion_marker": "CLOUD_READY",
	}
	command.Payload, _ = json.Marshal(payload)
	_, err := manager.Execute(t.Context(), command, func(context.Context, string, string) ([]byte, error) {
		return []byte("#!/bin/sh\n"), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	userData, err := os.ReadFile(filepath.Join(manager.deploymentDir(deploymentID), "cloud-init", "user-data"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(userData), "CLOUD_READY") || !strings.Contains(string(userData), "ssh-ed25519 AAAATEST") {
		t.Fatalf("invalid cloud-init user-data: %s", userData)
	}
	if !slices.ContainsFunc(runner.calls, func(call invocation) bool { return call.name == "cloud-localds" }) {
		t.Fatal("cloud-localds was not invoked")
	}
	qemuArgs := strings.Join(runner.calls[len(runner.calls)-1].args, " ")
	if !strings.Contains(qemuArgs, "seed.img,if=virtio,format=raw,readonly=on") {
		t.Fatalf("cloud-init seed is not attached: %s", qemuArgs)
	}
}

func TestCloudUserDataWrapsCustomScriptsWithCompletionMarker(t *testing.T) {
	data, err := cloudUserData("#!/bin/sh\ntouch /root/ready\n", "CLOUD_READY")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"multipart/mixed", "text/x-shellscript", "touch /root/ready", "CLOUD_READY"} {
		if !strings.Contains(data, expected) {
			t.Fatalf("multipart user-data lacks %q: %s", expected, data)
		}
	}
}

func TestManagerRejectsUntrustedPathsAndDrivers(t *testing.T) {
	manager, _ := newTestManager(t)
	command := deployCommand(t, "shell")
	var payload map[string]any
	if err := json.Unmarshal(command.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["config"].(map[string]any)["image"] = "../ubuntu.qcow2"
	command.Payload, _ = json.Marshal(payload)
	if _, err := manager.Execute(t.Context(), command, nil); err == nil {
		t.Fatal("path traversal accepted")
	}
	payload["driver"] = "imitor"
	payload["config"].(map[string]any)["image"] = "ubuntu.qcow2"
	command.Payload, _ = json.Marshal(payload)
	if _, err := manager.Execute(t.Context(), command, nil); err == nil {
		t.Fatal("foreign deployment driver accepted")
	}
}
