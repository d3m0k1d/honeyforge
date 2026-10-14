
# HoneypotForge Control API

FastAPI control plane for profiles, agents, deployments, telemetry, alerts and
operator access control. The generated contract is available at `/openapi.json` and
Swagger UI at `/docs`.

## Requirement coverage

| Case requirement | API capability |
|---|---|
| FR-C1 | CRUD `/profiles`, service/port/banner/rules, logging, masking and honeytokens |
| FR-C2 | enrollment, profile assignment, `/agents` with online/offline and last-seen |
| FR-C3 | mTLS gateway for config, commands and all agent telemetry |
| FR-C4 | PostgreSQL events and filters by agent, time, source, event and service |
| FR-C5 | JWT auth, admin/operator/viewer RBAC, user role and status management |
| FR-C6 | deployment artifacts, low/medium catalog, QEMU high deployments, snapshots/reset |
| FR-C7 | threshold alerts, acknowledgement, CSV and STIX 2.1 export |
| FR-A5 API | upserted attack sessions and captured artifact storage/download |
| FR-A6 API | honeytoken distribution and idempotent trigger ingestion |
| MASK-7 API | one-time enrollment, per-agent mTLS identity and agent revocation |

## Telemetry endpoints

Agents call the mTLS gateway aliases, not internal FastAPI paths:

| Gateway | Internal API | Purpose |
|---|---|---|
| `POST /assets/status` | `POST /agents/heartbeat` | liveness |
| `GET /assets/manifest.json` | `GET /agents/config` | versioned configuration |
| `POST /assets/collect` | `POST /agents/events` | event batches, max 100 |
| `POST /assets/runtime` | `POST /agents/sessions` | session upserts, max 100 |
| `POST /assets/blob` | `POST /agents/artifacts` | captured files, max 10 MiB |
| `POST /assets/pixel` | `POST /agents/honeytoken-triggers` | token triggers |
| `/assets/tasks/*` | `/agents/commands/*` | claim/result/artifact commands |

Explicit legacy gateway paths remain temporarily for older agents. The migration tasks and
exact payload examples are in [`../../docs/agent-api-backlog.md`](../../docs/agent-api-backlog.md).

Telemetry ingestion is idempotent by globally unique UUID. Reusing a UUID from another
agent returns `409`; uploading the same artifact UUID with different content also returns
`409`.

## Operator data API

- `GET /events`, `/events/stats`, `/events/export.csv`, `/events/export.stix`
- `GET /sessions`, `/sessions/{session_id}`
- `GET /artifacts`, `/artifacts/{artifact_id}`, `/artifacts/{artifact_id}/content`
- `GET /honeytoken-triggers`
- `GET /audit`

All operator routes, including user registration, are protected by JWT and permission
checks. Agent ingestion requires
both a valid client certificate and the private gateway header injected by Nginx.

## Local checks

```bash
uv sync --dev
uv run ruff check src tests
uv run pytest -q
```

The application initializes missing tables, permissions and built-in roles on startup.
