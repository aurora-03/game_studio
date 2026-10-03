# GameStudio

User goal: build a fully functional local AI game creation website inspired by LibTV. Preserve the dark workspace, project/canvas/asset workflow and cyan accent. Local Codex CLI must use exactly `gpt-6.1-sol`; no silent model or mocked generation fallback.

Frontend: React TypeScript/Vite in `src/`. Backend: Node ES modules/Express in `server/`. Persistent local user data lives in ignored `data/`. Commands: `npm run dev`, `npm run build`, `npm test`, `npm start`.

Every visible action must work or explain its real unavailable state. Mark prebuilt example games as examples. Generated games run in sandboxed iframes; do not grant same-origin access. Keep server bound to loopback; validate mutation origins, paths and payloads. Invoke CLI with argument arrays, never a shell string. Preserve existing versions and failed/cancelled job history. No fake success status or demo substitute for failed AI generation.
