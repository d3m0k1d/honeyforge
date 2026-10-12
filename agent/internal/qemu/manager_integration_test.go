//go:build integration

package qemu

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"d3m0k1d.ru/internal/orchestrator"
)

func TestQEMULifecycleIntegration(t *testing.T) {
	for _, binary := range []string{"qemu-system-x86_64", "qemu-img"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skipf("%s is unavailable", binary)
		}
	}
	root := t.TempDir()
	images := filepath.Join(root, "images")
	if err := os.Mkdir(images, 0o700); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(images, "empty.qcow2")
	if output, err := exec.Command("qemu-img", "create", "-f", "qcow2", base, "64M").CombinedOutput(); err != nil {
		t.Fatalf("create base image: %v: %s", err, output)
	}
	manager, err := New(Options{StateDir: filepath.Join(root, "state"), ImageDir: images})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{
		"driver": "qemu-ansible",
		"config": map[string]any{"image": "empty.qcow2", "vcpus": 1, "memory_mb": 256},
	})
	command := orchestrator.Command{ID: commandID, DeploymentID: deploymentID, Type: "deploy", Payload: payload}
	if _, err := manager.Execute(t.Context(), command, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		command.Type = "destroy"
		_, _ = manager.Execute(t.Context(), command, nil)
	})
	snapshotPayload, _ := json.Marshal(map[string]any{
		"driver": "qemu-ansible", "snapshot_id": artifactID,
	})
	command.Type = "vm.snapshot"
	command.Payload = snapshotPayload
	result, err := manager.Execute(t.Context(), command, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.SnapshotPath == "" || result.SnapshotSizeBytes == 0 {
		t.Fatalf("invalid snapshot result: %#v", result)
	}
	command.Type = "vm.reset"
	if _, err := manager.Execute(t.Context(), command, nil); err != nil {
		t.Fatal(err)
	}
	command.Type = "stop"
	if _, err := manager.Execute(t.Context(), command, nil); err != nil {
		t.Fatal(err)
	}
}
