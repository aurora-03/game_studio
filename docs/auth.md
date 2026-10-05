# Identity and tenant isolation

The deployed application uses **Node.js 24 and one application instance with one generation worker**. `GAMESTUDIO_MODE=production` activates authenticated tenant storage. Local mode retains the existing loopback workspace and its files. Production never silently claims the legacy local workspace for the first user.

## Configuration

Set `GAMESTUDIO_MODE=production`, an HTTPS origin in `GAMESTUDIO_PUBLIC_URL` (no path/query), and a random `GAMESTUDIO_SESSION_SECRET` of at least 32 bytes. Generate one with `openssl rand -hex 32`. Production startup rejects missing or insecure values. Configure `GAMESTUDIO_PROXY_HOPS` only for the exact trusted reverse proxy topology. The proxy must preserve Host, overwrite forwarded headers and be the only network route to the application. `GAMESTUDIO_HOST=0.0.0.0` enables the internal container listener; the public endpoint must terminate TLS at the reverse proxy. Local mode always binds loopback.

Phone authentication requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Create and fund a Twilio Verify service, enable intended destinations and complete applicable provider SMS sender requirements. Optional `GAMESTUDIO_PHONE_COUNTRIES=+1,+86` restricts destinations. The API accepts E.164 phone numbers, starts SMS verification through Twilio, and creates a session only when Twilio Verification Check returns `approved` for the same phone and service. No generated test OTP is accepted by the deployed application. There is a durable 60-second phone resend cooldown, five sends per phone/hour, ten sends per IP/hour, and five checks per phone/ten minutes. Provider failures are explicit.

Google authentication requires a **Web application** OAuth client with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Register exactly `<GAMESTUDIO_PUBLIC_URL>/api/auth/google/callback` as its authorized redirect URI, configure the consent screen and allowed users/domains with Google, then publish the OAuth client as applicable. The implementation uses the authorization code flow with S256 PKCE, a browser-bound one-time state, a one-time nonce and a server-side code exchange. It verifies the RS256 signature against Google's cached/rotating JWKS and checks issuer, audience/authorized party, expiry, issuance time, subject and nonce before creating an identity. An email address never implicitly merges phone and Google accounts; each provider's verified identity owns its own account.

Missing Google or Twilio credentials return `providers.google/phone=false` and an explicit 503 if the flow is requested. They do not produce a fake success or a development bypass.

## Browser API

`GET /api/auth/session` creates a short-lived anonymous browser challenge when signed out and returns:

```json
{"mode":"production","user":null,"csrfToken":"opaque value","providers":{"phone":false,"google":false},"sessionExpiresAt":null}
```

Signed-in `user` has `id`, `phone`, `googleSub`, `email`, `name`, `createdAt`, and `language` (`en` or `zh`). Keep the returned CSRF token in memory. Submit `X-CSRF-Token` with every mutation and credentials via same-origin cookies. Production mutations require an exact matching Origin.

- `POST /api/auth/phone/send` with `{phone}` returns `{sent:true,retryAfter:60}`.
- `POST /api/auth/phone/verify` with `{phone,code}` returns `{user,csrfToken}` and rotates the browser session.
- Navigate to `GET /api/auth/google/start`; the verified callback redirects to `/#projects`.
- `PATCH /api/auth/profile` changes `name` and/or `language`.
- `POST /api/auth/logout` revokes the server session and immediately closes its event streams.

Cookies use the `__Host-` prefix in production, HttpOnly, Secure, SameSite=Lax and Path=/, with no Domain attribute. Session/challenge/state values are cryptographically random; SQLite stores only HMAC token hashes and no reusable bearer cookie. Sessions expire after 168 hours by default (`GAMESTUDIO_SESSION_HOURS`) with a 24-hour idle limit and at most five concurrent sessions per identity. Rotating the session secret invalidates existing browser tokens. SQLite WAL files and user data must stay on a private persistent volume; file permissions are 0600 and private directories 0700. Back up the database with its SQLite backup mechanism or a consistent shutdown snapshot, alongside tenant project files. Node 24 currently reports `node:sqlite` as experimental; the supported runtime is pinned and exercised by tests.

## Authorization boundaries

Production has a shared read-only example library and separate `production/users/<user UUID>/` settings, projects, jobs, uploads and versions. Every private bootstrap/list/read/update/delete/clone/job-cancel/HTML/export/upload/file/events route resolves the session's own Store. Foreign IDs return 404. Private assets never become public because a generated game requests them. Authenticated game previews inline only their own referenced file bytes and enforce sandbox CSP allowing inline scripts, data/blob images/audio, and no network, forms, frames or same-origin privilege. Opaque-origin private asset API requests are rejected. Inline preview/export HTML is capped at 64MB.

`GET /api/public/bootstrap` exposes only example projects, templates and UI defaults; example HTML URLs use `/api/public/library/...` and validate demo ownership/source. `POST /api/library/:id/clone` copies examples into the signed-in tenant. Anonymous health excludes CLI diagnostics and job data; authenticated health reports safe worker readiness and only the current tenant's queue.

A global scheduler admits at most one CLI child across all tenants. Cancellation holds the worker permit until the child actually closes, including SIGKILL escalation. There is a global 100-pending-job limit and per-tenant queue limits. Billing reserves usage only after reference/context validation and before any project/job mutation. A failed durable enqueue write restores the original in-memory project/jobs and releases its reservation before any worker can start. Tenant Store contexts remain pinned until every active HTTP response finishes or closes; only truly idle contexts may be evicted. Shutdown stops admission, ignores late model events, drains provider work before closing the shared SQLite handle, and closes SSE heartbeat timers. Terminal settlement is idempotent, and startup reconciliation preserves queued jobs while releasing genuinely interrupted/absent reservations.

`GAMESTUDIO_MAX_PROJECTS` defaults to 100, `GAMESTUDIO_MAX_JOB_HISTORY` to 1000, and `GAMESTUDIO_MAX_TENANT_BYTES` to 1GiB. Capacity checks count actual stored files plus conservative metadata and pending-result headroom before admitting creation, clones, edits, uploads and generation. Permanently removing trashed projects releases their files and associated job history. The service is deliberately one instance per data volume; a multi-instance deployment requires a distributed worker/lock and database architecture, not a second independent CLI process pointed at the same JSON files.

## Evidence and provider activation

Automated fixtures prove provider request handling and cryptographic/authorization invariants without sending paid SMS or creating a real user's Google login. They cover missing credentials, valid and invalid provider proof, CSRF/origin/host/TLS, durable cooldown/restart, session expiry/logout, Google signed JWT rejection/state replay/PKCE, private project/job/version/file/export isolation, independent settings, SSE ownership/revocation, byte/project storage rejection, serial worker cancellation, and atomic quota admission. A live Google/Twilio smoke test still requires the operator's provider credentials, registered origin, funded/approved accounts and a consenting test phone/account. Those operational facts cannot be simulated by automated fixtures.

Provider references: [Twilio Verify Verifications](https://www.twilio.com/docs/verify/api/verification), [Twilio Verify Check](https://www.twilio.com/docs/verify/api/verification-check), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google OIDC reference](https://developers.google.com/identity/openid-connect/reference).
