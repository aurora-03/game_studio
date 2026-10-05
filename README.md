# GameStudio

A dark material-based workspace for creating playable HTML5 games. Organize a brief, characters, scenes, props and audio; reference actual material covers with `@`; generate, playtest, iterate and export. The interface defaults to English and supports Chinese with a persistent language preference.

The generation model is exactly **`gpt-6.1-sol`**, using the locked project-local Codex CLI **0.160.0**. Generated games are separate from the three clearly labeled built-in examples. Six prepared workflows contain authored English/Chinese material directions, game rules and acceptance checks.

## Local development

Use Node.js 24. Install locked dependencies and connect an account entitled to the required model:

```sh
npm ci
npm exec -- codex login
npm run dev
```

The development frontend runs on `http://127.0.0.1:5173`; the API on `http://127.0.0.1:4100`. For a compiled local application:

```sh
npm run build
npm start
```

Local mode preserves projects in ignored `data/` and binds to loopback. It is a personal development workspace; public multi-user hosting uses explicit production mode and separate tenant stores.

## Production deployment

The repository includes non-root Docker images, an HTTPS reverse proxy, persistent data and credential volumes, provider configuration, production preflight and backup/restore instructions. Run one application instance; horizontal replication over the same SQLite/filesystem data is not supported.

1. Copy [.env.production.example](.env.production.example) to `.env.production` and set the public domain, a random session secret and provider credentials.
2. Register the exact Google redirect and payment webhook URLs. Configure Twilio Verify and/or Google, and Stripe recurring prices and/or Alipay prices. Each provider can be independently enabled.
3. Provision a private Codex credential cache or an OpenAI API key with access to `gpt-6.1-sol`.
4. Follow the preflight and deployment sequence in [Production deployment](docs/production-deployment.md).

```sh
npm run preflight:production
# Then follow the documented model-access probe and Docker deployment steps.
```

Missing credentials produce a clear unavailable state; there are no fake login or payment modes. A redirect never activates membership. Verified provider settlement controls entitlements, and an atomic usage reservation controls generation admission. Stripe is recurring; Alipay membership is prepaid for the selected period.

## Verification

```sh
npm run check
npm run build
npm test
```

The suite covers material covers/categories, curated workflows, language variants, real HTTP state changes, OAuth/SMS transport contracts, cookies/CSRF, tenant isolation, signed payment callbacks, duplicate/out-of-order/refund/cancellation cases, quota reservation/settlement, asynchronous account changes, restart recovery and production preflight. Third-party test fixtures do not constitute a live merchant or login-provider activation; activation checks after credentials are supplied are documented explicitly.

- [Material catalog and workflow kits](docs/materials.md)
- [Authentication and tenant isolation](docs/auth.md)
- [Billing and memberships](docs/billing.md)
- [Production deployment and operator activation](docs/production-deployment.md)
- [Verification history](docs/verification.md)

游戏工作台默认英文，支持中文切换。生产部署需要在配置模板中填写第三方凭据、域名和会话密钥，并按部署文档注册回调及执行预检。本机原有项目不会自动成为新用户的云端项目。

The CI template is in [deploy/github-actions-ci.yml](deploy/github-actions-ci.yml). Install it under `.github/workflows/ci.yml` with a GitHub credential that has workflow-write permission; the current push credential does not have that scope. Local verification and Docker deployment do not depend on CI activation.
