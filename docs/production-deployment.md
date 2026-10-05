# Production deployment

This repository is prepared for **one application instance and one generation worker** behind an HTTPS reverse proxy. The Docker targets pin Node **24.14.1**, project-lockfile Codex CLI **0.160.0**, and the published Caddy **2.11.6** image index **`sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9`**. Every generation uses exactly **`gpt-6.1-sol`**; unavailable model access produces a failure, never a substitute model or demo result.

Caddy 2.11.7 was released upstream but its official Docker tag was not yet published during registry verification; 2.11.5-alpine was also unavailable. The pinned 2.11.6 image includes its security fixes. Its newly introduced idle read/write deadline wrappers are explicitly disabled (`read_body_idle -1s`, `write_idle -1s`) to avoid the upstream-documented HTTP/2/stream regressions, while a two-minute upload deadline, ten-second header deadline, edge body cap and backend limits remain. Only HTTP/1.1 and HTTP/2 are enabled; HTTP/3 and its UDP listener are excluded. Rebuild and regression-test an upgrade once the patched official image is actually published; do not infer image availability from a GitHub release alone. [Caddy regression details](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), [documented timeout disabling](https://caddyserver.com/docs/caddyfile/options#timeouts).

The Node application and Caddy both run as UID/GID **1000**, with read-only root filesystems and bounded memory/CPU/processes. Only Caddy publishes ports 80/443. The application listens on its private Docker bridge and retains outbound HTTPS access for the configured providers. Do not publish app port 4100 or put an unconfigured extra proxy/CDN in front of this topology. The app trusts exactly one proxy hop; Caddy preserves the requested Host and overwrites forwarded client/protocol headers. SSE bypasses compression and flushes immediately over HTTP/1.1 or HTTP/2. Webhook request bodies are forwarded without JSON transformation. Request bodies are capped at 25MB at the edge and more tightly by each backend route.

## Prepare your deployment

Use a Linux Docker Engine/Compose host with a persistent disk and a DNS hostname pointing to it. The hostname must be publicly reachable on TCP 80/443 for Caddy's automatic certificate issuance; HTTP/3 is explicitly disabled; there is no published UDP 443 port. Choose a certificate contact email. Keep the host clock synchronized because OAuth expiry and payment signature timestamps are checked.

```sh
cp .env.production.example .env.production
chmod 0600 .env.production
openssl rand -hex 32
```

Put the generated random value into `GAMESTUDIO_SESSION_SECRET`. Fill `GAMESTUDIO_DOMAIN`, `ACME_EMAIL`, and the same HTTPS origin in both `GAMESTUDIO_PUBLIC_URL` and `APP_BASE_URL`, for example `https://studio.your-domain.com`. Complete credentials in the private `.env.production` file or supply an equivalent server secret-management mechanism. Never place keys in frontend/Vite variables, commit a completed environment file, or build them into an image.

Configure at least one actual login provider and one actual paid payment provider before opening the public service. Google and phone login, and Stripe and Alipay checkout, can be independently enabled; unconfigured options remain visibly unavailable. A provider group must be complete. Every checkout interval advertised as purchasable needs its real configured price or amount. The preflight catches missing fields and formats; provider-side approval/access is verified in the staging checks below.

| Service | Operator configuration |
| --- | --- |
| Google | Web OAuth client ID and secret; authorized redirect `https://YOUR_DOMAIN/api/auth/google/callback`; published consent screen/verified domains and appropriate test users before production approval |
| Phone | Funded Twilio account and Verify service; `TWILIO_ACCOUNT_SID`, token and `TWILIO_VERIFY_SERVICE_SID`; configure **six-digit** SMS codes, intended destinations, sender/region approvals and optional country-code allowlist |
| Stripe | Secret key, endpoint signing secret, positive fixed licensed monthly/yearly Price IDs for Pro/Studio; endpoint `https://YOUR_DOMAIN/api/billing/webhooks/stripe`; event list and safe portal policy in [billing.md](billing.md) |
| Alipay | Approved merchant/application with **computer website payment** (`alipay.trade.page.pay`) enabled; app/seller IDs, application RSA private key and **Alipay** public key in public-key integration mode, RSA2 with keys >=2048 bits; actual CNY prices and endpoint `https://YOUR_DOMAIN/api/billing/webhooks/alipay` |
| Generation | An OpenAI credential/account entitled to the exact `gpt-6.1-sol` model, provisioned only in the server's private CLI credential volume |

Alipay private/public keys belong to different identities: the application signs requests with its private key, and verifies provider responses with Alipay's public key. Do not replace that verification key with the application's public key. PEM values may use literal `\n` escapes or quoted multiline values. The preflight validates RSA types and lengths. Stripe REST is version-pinned; new notification resource snapshots are re-fetched and validated server-side. The supported product does not enable prorated plan changes, coupons, trials, metered prices or extra invoice tax additions.

Use `GAMESTUDIO_DEPLOYMENT=staging` with Stripe **test** keys and/or `ALIPAY_SANDBOX=true` while testing. Use a different Compose project/data volume and a separate provider callback domain for staging. Production preflight rejects test-mode Stripe and sandbox Alipay. Do not reuse a ledger volume with different merchant accounts.

## CLI credential provisioning

Official OpenAI documentation recommends API-key authentication for programmatic CLI workflows. With `OPENAI_API_KEY` configured, the container entrypoint passes it to the pinned CLI **through stdin**, forces file-based credential caching, suppresses login output, and removes the key from the server process environment after login. The cache lives in the separate private `codex_auth` volume at the existing node user's `~/.codex/auth.json`, with directory mode 0700 and file mode 0600. No HOME/CODEX_HOME override or copied desktop account configuration is needed. [OpenAI CLI authentication](https://developers.openai.com/codex/auth/)

Alternatively, leave the API key blank and explicitly provision an eligible, legitimate CLI login in that volume. On a host where device login is supported:

```sh
docker compose --env-file .env.production run --rm --no-deps \
  --entrypoint /app/node_modules/.bin/codex app \
  -c 'cli_auth_credentials_store="file"' login --device-auth
```

Complete the displayed OpenAI device authorization yourself. If device authorization is unavailable, follow OpenAI's documented headless sign-in process and transfer **only** the authorized `auth.json` into this private volume using a secure stdin/file-transfer workflow. Do not copy the whole desktop `.codex` directory, credentials into the repository, or login tokens into chat/logs. Cached authentication supports token refresh and therefore needs a writable credential volume. Exact model availability depends on the configured account and is not established by the presence of a login file. [OpenAI credential storage](https://developers.openai.com/codex/auth/)

Users interact with a constrained, authenticated server wrapper. They cannot submit arbitrary CLI flags, commands, tools, executable paths or account configuration. The worker's arguments fix the model, sandbox, output schema and disabled tool/app/network-search features; only validated design input and owned material files enter generation context. The executable and credentials stay private. Generated game HTML runs in a separate sandbox with no same-origin privilege or network API access. Do not expose a raw Codex CLI/app-server endpoint publicly.

## Build, validate and start

Every Compose command must explicitly select the private environment file:

```sh
docker compose --env-file .env.production build
# This one-off command does not start the website or publish a host port.
docker compose --env-file .env.production run --rm --no-deps \
  app node scripts/preflight-production.mjs
# Model access is a separate explicit check. This invocation incurs model usage.
docker compose --env-file .env.production run --rm --no-deps \
  app node scripts/preflight-production.mjs --probe-model
# Validate the actual pinned Caddy binary/config before opening ports.
docker compose --env-file .env.production run --rm --no-deps \
  --entrypoint caddy proxy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
```

The entrypoint runs a configuration-only check before any provider login, provisions CLI credentials if requested, then validates persistent data writes/fsync/read-back, pinned CLI version and owner-only cached login. No SMS, checkout or model request occurs during the default preflight. `--probe-model` makes exactly one constrained request to `gpt-6.1-sol` and validates its schema result; it has no fallback and removes its temporary output. This optional flag is never run automatically by startup or health checks.

On a Node 24 administrative host, configuration-only validation is also available without Docker:

```sh
node --env-file=.env.production scripts/preflight-production.mjs --config-only
```

`--skip-cli` additionally probes the data directory without CLI auth; it is a diagnostic, not a completed launch gate. Reports contain variable names and safe status summaries, never the key values or raw CLI output. Configuration completeness cannot prove real provider account approval, prices or model entitlement. The one-off preflight and staging activation tests are required to establish those facts.

The container health check validates the app's HTTP liveness using its configured public Host and forwarded HTTPS header. It does not generate a game, send SMS or assert that a particular model is entitled. The authenticated Settings page reports the current user's safe worker readiness; failed generation remains a genuine failed job with its prior versions intact.

## Activation checks

Before allowing actual customers, use the staging domain and real provider **test** credentials:

1. Log in with a consenting test phone and Google account. Reload, change the profile language, sign out and confirm protected project endpoints reject the expired session. Confirm a second account cannot see the first account's projects, files, jobs or export.
2. Run the explicit exact-model access probe, then create one real small game using a character/scene reference. Confirm its saved version and preview load with the referenced material and proper account ownership.
3. Complete a Stripe test subscription or Alipay sandbox payment. Confirm the browser return alone grants nothing and provider-confirmed state activates the correct plan/expiry. Replay a valid notification and confirm no duplicate period or quota.
4. Cancel Stripe renewal and verify access remains through its already-paid period. Issue a provider test refund and confirm the affected entitlement is revoked. For Alipay, verify fixed-period expiry, renewal and cancellation of an unpaid order.
5. Restart the application container. Verify data/session/ledger recovery and quota reconciliation, then restore a backup to a separate recovery project.

Automated test fixtures already exercise these transport, cryptographic and ownership invariants without using live provider accounts. They are not a claim that your newly supplied merchant keys, SMS destination, DNS or exact-model entitlement have been activated. Move to live payment credentials, provider-approved accounts and a separate production volume only after the staging checks succeed.

## State, logs and recovery

Named volumes hold `studio_data` (identity SQLite/WAL, tenant project metadata, assets, versions and job history), `codex_auth` (private generation login), and Caddy's certificate/config state. Empty named volumes copy the image's UID/GID 1000 directory ownership on their first mount. Bind mounts need equivalent ownership and private permissions prepared by the operator. The app root remains read-only; only its data, credential volume and temporary filesystem are writable.

Keep a single app container per data volume. Do not scale `app` replicas: the JSON project store and worker permit are deliberately single-instance. The container process namespace also ensures a crash/restart terminates detached model children; running this public worker directly as a bare host Node process lacks that crash boundary. On normal stop, the app cancels work, waits for provider cleanup, settles terminal reservations and closes SQLite; Compose allows 35 seconds. Existing versions and failed/cancelled task history remain available.

Logs are bounded through Docker rotation. Caddy drops request headers and the URI from access logs so cookies and OAuth callback query values are not retained. Backend logs contain generic status/error codes; do not enable request-body or credential debug logging. Operator visibility through `docker inspect` and environment/volume access must be limited to trusted administrators.

For a consistent offline backup, stop the app first and store snapshots in a private directory **outside the Git checkout**. These snapshots contain personal project and identity data; encrypt them in your backup system and keep a tested retention policy.

```sh
backup_dir=../private-gamestudio-backups
install -d -m 0700 "$backup_dir"
docker compose --env-file .env.production stop app
docker compose --env-file .env.production run --rm --no-deps \
  --entrypoint tar app -czf - -C /var/lib/gamestudio . \
  > "$backup_dir/studio-data.tar.gz"
chmod 0600 "$backup_dir/studio-data.tar.gz"
# Optional credential recovery snapshot: treat it as a password.
docker compose --env-file .env.production run --rm --no-deps \
  --entrypoint tar app -czf - -C /home/node/.codex auth.json \
  > "$backup_dir/codex-auth.tar.gz"
chmod 0600 "$backup_dir/codex-auth.tar.gz"
docker compose --env-file .env.production start app
```

Retain the associated release/image version and protected deployment environment so restored external account mappings match the original providers. Never copy only a live SQLite main file while its WAL may still contain transactions. Back up Caddy certificate/config volumes separately with the same private handling, or allow the proxy to obtain new certificates subject to issuer rate limits.

Restore into a **new empty** recovery volume first; the guard below refuses to overwrite an existing identity database:

```sh
docker compose --env-file .env.production -p gamestudio-recovery run --rm --no-deps \
  --entrypoint sh app -c 'test ! -e /var/lib/gamestudio/production/identity.sqlite && tar -xzf - -C /var/lib/gamestudio' \
  < "$backup_dir/studio-data.tar.gz"
docker compose --env-file .env.production -p gamestudio-recovery run --rm --no-deps \
  app node scripts/preflight-production.mjs
```

Provision the recovery CLI credential volume using the API-key path or securely restore its private snapshot. Verify user/project/asset/version/ledger state on the matching release before switching the public service. Do not start two proxy projects on the same host ports; stop the original project before bringing the verified replacement up. Keep production and recovery data volumes separate until the restore audit is complete. Rotating the session secret safely signs existing browsers out; it does not delete user data.

## Verification record

The source includes seven offline preflight tests proving configuration/provider completeness, test/live gating, RSA/amount checks, persistent write cleanup, private CLI-cache permissions/output redaction and an explicitly requested fixed-model probe with intercepted execution. Compose parsing and shell/Node syntax were checked locally. Docker was initially unavailable, then started for actual verification. The application target built successfully; its Node 24.14.1 runtime, UID 1000, private mounted volume ownership, CLI 0.160.0, secure session-cookie flags, protected-route rejection, static serving and startup TLS/Host validation were checked in an isolated no-provider-network runtime. The proxy image also built and its actual Caddy configuration validated. Adapted JSON confirms negative read/write idle timeouts and h1/h2 only. On a private no-egress Docker network, a test-only CA verified TLS hostname and HTTP2; an uncompressed SSE stream lasted 70,025ms with the first chunk in 1ms, and a silent response body completed after 65,027ms. No system certificate trust was installed. Detailed requirement evidence is in [production-verification.md](production-verification.md). These container checks do not assert third-party account activation or paid-model access.

Primary references: [official Node image variants and supported LTS runtimes](https://github.com/nodejs/docker-node), [Caddy forwarded-header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [official Caddy image publication metadata](https://github.com/docker-library/official-images/blob/master/library/caddy), [Google OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect), [Twilio Verify](https://www.twilio.com/docs/verify/api/verification), and the provider references in [billing.md](billing.md).
