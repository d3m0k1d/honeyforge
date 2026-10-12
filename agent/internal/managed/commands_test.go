package managed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"d3m0k1d.ru/internal/orchestrator"
)

type fakeExecutor struct {
	artifact []byte
}

func (e *fakeExecutor) Execute(ctx context.Context, command orchestrator.Command, load orchestrator.ArtifactLoader) (orchestrator.Result, error) {
	artifact, err := load(ctx, command.ID, "artifact-id")
	if err != nil {
		return orchestrator.Result{}, err
	}
	e.artifact = artifact
	return orchestrator.Result{Data: map[string]any{"vm": "started"}}, nil
}

func TestExecuteCommandLifecycle(t *testing.T) {
	var statuses []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/commands/command-id/result":
			var result commandResult
			if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
				t.Error(err)
			}
			statuses = append(statuses, result.Status)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		case "/commands/command-id/artifacts/artifact-id":
			_, _ = w.Write([]byte("provisioning"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	executor := &fakeExecutor{}
	err := executeCommand(t.Context(), server.Client(), server.URL, executor, orchestrator.Command{
		ID: "command-id", DeploymentID: "deployment-id", Type: "deploy",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(statuses, []string{"running", "succeeded"}) {
		t.Fatalf("statuses = %v", statuses)
	}
	if string(executor.artifact) != "provisioning" {
		t.Fatalf("artifact = %q", executor.artifact)
	}
}
