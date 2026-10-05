# GameStudio

Build a production-ready AI game creation workspace inspired by LibTV. Preserve its restrained dark canvas, real material covers, semantic asset categories, compact material cards and deliberate workflow kits. English is the default; interface Chinese/English and profile language preferences must work without translating personal project names, uploaded filenames or authored content.

Runtime: Node.js 24.14.1, React/TypeScript/Vite in `src/`, Express in `server/`. Use exactly `gpt-6.1-sol` through the project-local Codex CLI 0.160.0; never substitute a model, fake a successful generation or use a built-in example as a generated result. CLI flags are server-controlled; use argument arrays, read-only sandbox and disabled tools. Never pass login, session or merchant credentials to generation workers.

Local mode is loopback-only and preserves ignored `data/`. Production is a single app instance and one bounded generation worker behind an HTTPS proxy. Production requires a configured public origin, session secret, authenticated per-user stores, HttpOnly/Secure cookies, exact origin/CSRF checks and tenant-isolated projects, jobs, files, versions, export and SSE. Public examples are read-only and cloned before editing. Preserve personal project data and immutable versions.

Phone login uses Twilio Verify; Google uses authorization code, PKCE, state, nonce and verified OIDC signatures. Billing uses actual Stripe/Alipay providers, verified server-side settlement, SQLite idempotency and membership/usage ledger. Browser returns cannot grant membership. Reserve usage after validation and before mutation, consume on successful generation, release on failed/canceled requests. Missing keys are explicitly unavailable; never implement a production fake login, SMS, checkout or paid state.

Generated games stay in opaque sandboxed iframes with no same-origin privilege or network access. Private assets are inlined for production previews. Validate payloads, MIME types, sizes, IDs and ownership. Protect API credentials and raw callback data; no secrets in the client, repository, image or logs.

Commands: `npm run dev`, `npm run check`, `npm run build`, `npm test`, `npm start`, `npm run preflight:production`. Tests are rooted in `tests/`, never scratch worktrees. Production setup and activation boundaries are in `docs/production-deployment.md`, `docs/auth.md` and `docs/billing.md`. Use meaningful regression tests for authentication, tenant boundaries, payment signatures/state races, atomic persistence and usage. UI changes need actual browser verification.
