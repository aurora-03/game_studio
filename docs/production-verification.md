# Production release verification

The implementation is verified up to the requested operator-configuration boundary. No real Google/Twilio account or Stripe/Alipay merchant credential is included. Tests intercept provider calls; they do not constitute live authentication, SMS delivery, payment or model-entitlement activation.

## Requirement evidence

| Requirement | Authoritative verification |
| --- | --- |
| Actual covers in `@` suggestions and selected references | Material helper tests plus browser upload/bind of a real test PNG. The suggestion loaded its owning-project asset URL; the selected chip retained node ID `4feb7137-6e7d-437f-ad74-0872ad74b7a0` and the same asset URL. Missing, shared, same-name and cross-project cases have tests. |
| Semantic asset categories | Character/scene/prop/audio/reference/unassigned categories derive from actual node bindings, independently of MIME type. Tests cover deduplication, combined search, inactive projects and owner boundaries. |
| Compact workflow materials and polished examples | Six English/Chinese kits have deliberate character, scene, prop, sound, gameplay and acceptance directions. Browser created the Neon Courier kit with six populated nodes and five edges; a card opened its actual editable specifications. Three system games have guarded English/Chinese HTML variants with preserved controls. |
| English default and Chinese switch | Fresh interface uses English; browser switching updates navigation, material roles, login and membership immediately. Preference persists locally and authenticated profile PATCH stores it. Personal names, filenames and authored design are preserved. |
| Phone and Google accounts | Actual Twilio Verify and Google OAuth/PKCE/OIDC transport contracts, secure sessions, durable limits, CSRF, logout/SSE revocation, profile changes and production tenant isolation have tests. Unconfigured providers are visibly disabled. |
| Membership and Stripe/Alipay | Actual REST/RSA2/HMAC transport, persistent verified settlement and usage ledger. Tests cover ownership, raw callbacks, amount/currency, repeats, out-of-order events, refunds/disputes, incomplete checkout, payment/cancel races, recurring cancellation, portal restrictions and restart. Browser returns cannot grant membership. |
| Production operation | Strict domain/session/provider preflight; non-root images, private volumes, HTTPS proxy, bounded single generation worker, callback registration, credential handling and backup/restore instructions. Actual app/proxy image builds and runtime checks below. |

## Current checks

- `npm run check` and `npm run build` completed successfully.
- `npm test`: **150 tests passed**, zero failed/canceled/skipped. The runner scans only `tests/`; scratch snapshots are excluded. Source log: ignored `work/production-regression.log`.
- Application image built with Node **24.14.1** and locked Codex CLI **0.160.0**. A no-egress, read-only-root test container verified UID **1000**, `/home/node`, owner-only writable data/auth volumes, executable CLI, English public examples, private API `401`, invalid Host/plaintext transport `403`, Secure/HttpOnly/SameSite=Lax cookies, real unconfigured provider states and static `200`.
- Proxy image built from the actually published Caddy **2.11.6** multi-platform digest. Config validation passed; adapted JSON proves `read_idle_timeout=-1000000000`, `write_idle_timeout=-1000000000`, protocols `h1/h2` and no HTTP3 listener. The unpublished `2.11.7` image tag was not used.
- An internal-only Docker network verified TLS certificate and hostname against a test-only CA without installing system trust. HTTP2 ALPN was `h2`; Host/HTTPS forwarding matched; SSE first chunk arrived in **1 ms**, stayed uncompressed for **70,025 ms**, and a silent body completed after **65,027 ms**. These prove the configured proxy path preserves long responses beyond one minute.
- `deploy/github-actions-ci.yml` contains the CI workflow template for source checks, build, all tests, app/proxy image builds and actual Caddy validation without provider secrets. GitHub refused creation under `.github/workflows/` because the current OAuth credential lacks `workflow` scope. The template is committed for review; automation is not claimed active. Install it under `.github/workflows/ci.yml` using an appropriately authorized repository credential.

## Operator activation

Fill `.env.production`, register exact Google/payment callbacks, provision an entitled model credential, run production preflight and the explicit model probe, then execute the documented provider staging checks. The exact model is `gpt-6.1-sol`; failure is reported and never replaced by a demo or another model. Configuration and activation instructions are in [production-deployment.md](production-deployment.md), [auth.md](auth.md) and [billing.md](billing.md).

Until credentials are supplied, the interface intentionally exposes unavailable login/payment choices. A missing credential is not presented as a successful login, SMS, charge or membership grant.
