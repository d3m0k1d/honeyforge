# Agent Operations

Use the [root quick start](../README.md#managed-agent-quick-start) to run the
Compose agent profile. Managed mode enrolls once, polls configuration and sends
heartbeats, and uploads queued events over mTLS. Without a gateway URL, the agent
uses standalone configuration via `-config` / `HONEYPOT_CONFIG` (default
`configs/config.json`); `go run ./cmd/agent -list` lists built-in service types.
Local Go commands require Go 1.27.1.

## Remote Managed Agent

Issue an enrollment token and assign configuration through the operator HTTPS
API first. The gateway hostname/IP must be in `SERVER_SAN` before initial server
certificate issuance; existing certificates are not regenerated on SAN changes.
Transfer the public bootstrap CA through a trusted out-of-band channel and verify
its provenance. Never fetch it insecurely or disable TLS verification. Do not
copy or mount the private CA key/store onto an agent.

Example environment for a locally built agent (`go build -o agent ./cmd/agent`):

```sh
export HONEYPOT_GATEWAY_URL=https://gateway.example.com:8443
export HONEYPOT_ENROLLMENT_URL=https://gateway.example.com:8444/agents/enroll
export HONEYPOT_BOOTSTRAP_CA=/etc/honeypot-agent/ca.crt
export HONEYPOT_STATE_DIR=/var/lib/honeypot-agent
export HONEYPOT_POLL_INTERVAL=5s
export HONEYPOT_ENROLLMENT_TOKEN='your-one-time-token'
./agent
```

Run as an account that can write the state directory and bind the assigned
decoy ports. `HONEYPOT_GATEWAY_URL` enables managed mode; runtime calls use
`/heartbeat`, `/config`, and `/events` on port 8443 (proxied to the API's
`/agents/...` routes).
Enrollment uses HTTPS port 8444 without a client certificate, authenticated by
the single-use token. Poll intervals must be greater than zero and at most 60s.
The equivalent flags are `-gateway-url`, `-enrollment-url`, `-bootstrap-ca`,
`-state-dir`, `-poll-interval`, and `-enrollment-token`.

After enrollment, unset/remove the enrollment token. The agent uses persisted
`certificates.zip` on restart rather than enrolling again. Protect this ZIP: it
contains the agent's private key. Keep state directories private (0700) and
certificate files private (0600). Run **one process per state directory**; the
queue is not a multi-process store.

## Configuration and Events

Operator `PUT /agents/{agent_id}/config` assigns a new version. The agent caches
accepted configuration in `config.json`, updates changed listeners, and can
restart with cached configuration while the control plane is unavailable.
`{"services":[]}` stops all managed listeners on the next successful poll.
The Compose sample publishes FTP 2121 and Telnet 2323; changing container listen
ports also requires updating Compose port mappings.

Managed `log.output` is ignored: events go through the central durable queue,
not a configured local log destination. Files under `events/` survive restart,
are retried after outages, and are removed after successful upload. UUIDs allow
the API to deduplicate retries.

- Persisted event records are capped at **16 KiB** each.
- The queue holds at most **64 MiB** or **10,000 records**, whichever fills first.
- Oversized event data is shortened/dropped and marked `data._truncated="true"`.
- Queue-full, invalid-event, and persistence/upload errors are logged. There is
  **no guaranteed retention beyond queue capacity**; watch stderr/container logs.

Use operator `GET /agents` for status (online means a heartbeat within 60s), and
`GET /agents/{agent_id}/events` for stored events. Filter with `event`, `src`,
timezone-aware `since`/`until`, and paginate with `limit`/`offset` (maximum 100
per page). Existing FTP username/password captures are separate `rule` events,
with `rule` values `user`/`pass`, not necessarily `auth` events. Treat captured
credentials and the event queue as sensitive data.

## Lost Enrollment Response or State

If enrollment consumed the token but the ZIP response was lost, do not create
another enrollment token for the same identity. An authorized operator can
retrieve the existing ZIP using `GET /agents/{agent_id}/certificate` on port
8444. This retrieves existing credentials; it is not certificate rotation.

With `CONTROL_URL` and `OPERATOR_TOKEN` from the root quick start:

```sh
(umask 077; curl --fail --silent --show-error --cacert ./bootstrap-ca.crt \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  "$CONTROL_URL/agents/demo/certificate" -o ./demo-certificates.zip)
```

Stop the agent before restoring state. Transfer the ZIP securely to the agent
host, then install it into the actual state directory as the agent's account:

```sh
install -d -m 0700 "$HONEYPOT_STATE_DIR"
install -m 0600 ./demo-certificates.zip "$HONEYPOT_STATE_DIR/certificates.zip"
```

For the Compose profile, restore into the `agent_state` volume instead:

```sh
docker compose stop agent
chmod 0600 ./demo-certificates.zip
docker compose cp ./demo-certificates.zip agent:/var/lib/honeypot-agent/certificates.zip
docker compose start agent
```

Ensure the restored file is owned/readable by the agent and mode 0600. Do not
extract the archive: a valid persisted `certificates.zip` is sufficient to
connect, and the restart path does not extract its files. Remove the temporary
download once installed. Restore the correct identity's ZIP only; protect
backups of the state volume, which also contains queued credentials.
