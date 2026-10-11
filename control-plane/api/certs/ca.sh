#!/usr/bin/env bash

set -Eeuo pipefail

MTLS_DIR="${MTLS_DIR:-/var/lib/honeypotforge/mtls}"
CLIENT_ID="${1:-}"
SERVER_COMMON_NAME="${SERVER_COMMON_NAME:-api}"
SERVER_SAN="${SERVER_SAN:-DNS:api,DNS:localhost,IP:127.0.0.1}"
CA_DAYS="${CA_DAYS:-3650}"
CERT_DAYS="${CERT_DAYS:-825}"

if [[ -n "$CLIENT_ID" ]] && { \
  (( ${#CLIENT_ID} > 128 )) \
  || [[ ! "$CLIENT_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$ \
    && ! "$CLIENT_ID" =~ ^[a-zA-Z0-9]$ ]]; \
}; then
  printf 'invalid client id\n' >&2
  exit 1
fi

umask 077
mkdir -p "$MTLS_DIR"

LOCK_DIR="$MTLS_DIR/.issue.lock"
locked=false
for ((attempt = 0; attempt < 100; attempt++)); do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    locked=true
    break
  fi
  sleep 0.1
done

if [[ "$locked" != true ]]; then
  printf 'certificate store is busy\n' >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "$MTLS_DIR/.issue.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$MTLS_DIR/ca" "$MTLS_DIR/server" "$MTLS_DIR/clients"

if [[ ! -f "$MTLS_DIR/ca/ca.key" || ! -f "$MTLS_DIR/ca/ca.crt" ]]; then
  if [[ -e "$MTLS_DIR/ca/ca.key" || -e "$MTLS_DIR/ca/ca.crt" ]]; then
    printf 'incomplete CA files\n' >&2
    exit 1
  fi

  openssl genpkey \
    -quiet \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:4096 \
    -out "$MTLS_DIR/ca/ca.key"

  openssl req \
    -new \
    -x509 \
    -sha256 \
    -days "$CA_DAYS" \
    -key "$MTLS_DIR/ca/ca.key" \
    -subj "/CN=HoneypotForge CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$MTLS_DIR/ca/ca.crt"
fi

if [[ ! -f "$MTLS_DIR/server/server.key" || ! -f "$MTLS_DIR/server/server.crt" ]]; then
  if [[ -e "$MTLS_DIR/server/server.key" || -e "$MTLS_DIR/server/server.crt" ]]; then
    printf 'incomplete server certificate files\n' >&2
    exit 1
  fi

  cat >"$WORK_DIR/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=${SERVER_SAN}
EOF

  openssl genpkey \
    -quiet \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:3072 \
    -out "$MTLS_DIR/server/server.key"

  openssl req \
    -new \
    -sha256 \
    -key "$MTLS_DIR/server/server.key" \
    -subj "/CN=${SERVER_COMMON_NAME}" \
    -out "$WORK_DIR/server.csr"

  openssl x509 \
    -req \
    -sha256 \
    -days "$CERT_DAYS" \
    -in "$WORK_DIR/server.csr" \
    -CA "$MTLS_DIR/ca/ca.crt" \
    -CAkey "$MTLS_DIR/ca/ca.key" \
    -CAcreateserial \
    -extfile "$WORK_DIR/server.ext" \
    -out "$MTLS_DIR/server/server.crt"

  cat "$MTLS_DIR/server/server.crt" "$MTLS_DIR/ca/ca.crt" \
    >"$MTLS_DIR/server/fullchain.crt"
fi

chmod 600 "$MTLS_DIR/ca/ca.key" "$MTLS_DIR/server/server.key"
chmod 644 "$MTLS_DIR/ca/ca.crt" \
  "$MTLS_DIR/server/server.crt" \
  "$MTLS_DIR/server/fullchain.crt"

if [[ -z "$CLIENT_ID" ]]; then
  exit 0
fi

CLIENT_DIR="$MTLS_DIR/clients/$CLIENT_ID"
if [[ -e "$CLIENT_DIR" ]]; then
  printf 'client certificate already exists\n' >&2
  exit 1
fi

cat >"$WORK_DIR/client.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

mkdir "$WORK_DIR/client"

openssl genpkey \
  -quiet \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -out "$WORK_DIR/client/client.key"

openssl req \
  -new \
  -sha256 \
  -key "$WORK_DIR/client/client.key" \
  -subj "/CN=${CLIENT_ID}" \
  -out "$WORK_DIR/client.csr"

openssl x509 \
  -req \
  -sha256 \
  -days "$CERT_DAYS" \
  -in "$WORK_DIR/client.csr" \
  -CA "$MTLS_DIR/ca/ca.crt" \
  -CAkey "$MTLS_DIR/ca/ca.key" \
  -CAserial "$MTLS_DIR/ca/ca.srl" \
  -extfile "$WORK_DIR/client.ext" \
  -out "$WORK_DIR/client/client.crt"

openssl verify \
  -CAfile "$MTLS_DIR/ca/ca.crt" \
  -purpose sslclient \
  "$WORK_DIR/client/client.crt" >&2

cat "$WORK_DIR/client/client.crt" "$MTLS_DIR/ca/ca.crt" \
  >"$WORK_DIR/client/fullchain.crt"
cp "$MTLS_DIR/ca/ca.crt" "$WORK_DIR/client/ca.crt"

chmod 600 "$WORK_DIR/client/client.key"
chmod 644 "$WORK_DIR/client/client.crt" \
  "$WORK_DIR/client/fullchain.crt" \
  "$WORK_DIR/client/ca.crt"

mv "$WORK_DIR/client" "$CLIENT_DIR"
printf '%s\n' "$CLIENT_DIR"
