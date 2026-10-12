package managed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"d3m0k1d.ru/internal/orchestrator"
)

type commandResult struct {
	Status                 string         `json:"status"`
	Result                 map[string]any `json:"result,omitempty"`
	Error                  string         `json:"error,omitempty"`
	SnapshotPath           string         `json:"snapshot_path,omitempty"`
	SnapshotSizeBytes      int64          `json:"snapshot_size_bytes,omitempty"`
	SnapshotChecksumSHA256 string         `json:"snapshot_checksum_sha256,omitempty"`
}

func claimCommand(ctx context.Context, client *http.Client, base string) (*orchestrator.Command, error) {
	body, err := json.Marshal(map[string]int{"lease_seconds": 60})
	if err != nil {
		return nil, err
	}
	status, response, err := request(ctx, client, http.MethodPost, base+"/commands/claim", body)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNoContent {
		return nil, nil
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("claim command: HTTP %d", status)
	}
	var command orchestrator.Command
	if err := json.Unmarshal(response, &command); err != nil {
		return nil, fmt.Errorf("decode command: %w", err)
	}
	if command.ID == "" || command.DeploymentID == "" || command.Type == "" {
		return nil, errors.New("incomplete command response")
	}
	return &command, nil
}

func sendCommandResult(ctx context.Context, client *http.Client, base, commandID string, result commandResult) error {
	body, err := json.Marshal(result)
	if err != nil {
		return err
	}
	status, _, err := request(ctx, client, http.MethodPost, base+"/commands/"+url.PathEscape(commandID)+"/result", body)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("report command: HTTP %d", status)
	}
	return nil
}

func loadArtifact(client *http.Client, base string) orchestrator.ArtifactLoader {
	return func(ctx context.Context, commandID, artifactID string) ([]byte, error) {
		endpoint := base + "/commands/" + url.PathEscape(commandID) + "/artifacts/" + url.PathEscape(artifactID)
		status, body, err := request(ctx, client, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			return nil, fmt.Errorf("download artifact: HTTP %d", status)
		}
		return body, nil
	}
}

func executeCommand(ctx context.Context, client *http.Client, base string, executor orchestrator.Executor, command orchestrator.Command) error {
	if err := sendCommandResult(ctx, client, base, command.ID, commandResult{Status: "running"}); err != nil {
		return err
	}
	execCtx, cancelExec := context.WithTimeout(ctx, 125*time.Minute)
	defer cancelExec()
	renewCtx, cancelRenew := context.WithCancel(ctx)
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-ticker.C:
				renew, cancel := context.WithTimeout(renewCtx, 10*time.Second)
				err := sendCommandResult(renew, client, base, command.ID, commandResult{Status: "running"})
				cancel()
				if err != nil {
					report(fmt.Errorf("renew command lease: %w", err))
				}
			}
		}
	}()
	result, execErr := executor.Execute(execCtx, command, loadArtifact(client, base))
	cancelRenew()
	<-renewed
	final := commandResult{
		Status:                 "succeeded",
		Result:                 result.Data,
		SnapshotPath:           result.SnapshotPath,
		SnapshotSizeBytes:      result.SnapshotSizeBytes,
		SnapshotChecksumSHA256: result.SnapshotChecksumSHA256,
	}
	if execErr != nil {
		final.Status = "failed"
		final.Error = strings.TrimSpace(execErr.Error())
		if len(final.Error) > 10_000 {
			final.Error = final.Error[:10_000]
		}
	}
	reportCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := sendCommandResult(reportCtx, client, base, command.ID, final); err != nil {
		return err
	}
	return execErr
}
