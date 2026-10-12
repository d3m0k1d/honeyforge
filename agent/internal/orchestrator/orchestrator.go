package orchestrator

import (
	"context"
	"encoding/json"
)

type Command struct {
	ID           string          `json:"id"`
	DeploymentID string          `json:"deployment_id"`
	Type         string          `json:"type"`
	Payload      json.RawMessage `json:"payload"`
	Generation   int             `json:"generation"`
}

type Result struct {
	Data                   map[string]any
	SnapshotPath           string
	SnapshotSizeBytes      int64
	SnapshotChecksumSHA256 string
}

type ArtifactLoader func(ctx context.Context, commandID, artifactID string) ([]byte, error)

type Executor interface {
	Execute(context.Context, Command, ArtifactLoader) (Result, error)
}
