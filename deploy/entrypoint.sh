#!/bin/sh
set -eu
umask 077

# Reject incomplete public launch configuration before touching providers.
node /app/scripts/preflight-production.mjs --config-only

# HOME is the image user's existing home. Only this private volume holds CLI
# login credentials; no host account settings are copied into the image.
mkdir -p "$HOME/.codex"
chmod 0700 "$HOME/.codex"
if [ -n "${OPENAI_API_KEY:-}" ]; then
  # No xtrace, argument interpolation, output logging, or image-layer secret.
  if ! printenv OPENAI_API_KEY | /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --with-api-key >/dev/null 2>&1; then
    printf '%s\n' 'Codex API-key login failed. Check the configured account credential.' >&2
    exit 1
  fi
  unset OPENAI_API_KEY
fi
if [ -f "$HOME/.codex/auth.json" ]; then
  chmod 0600 "$HOME/.codex/auth.json"
fi
node /app/scripts/preflight-production.mjs
exec "$@"
