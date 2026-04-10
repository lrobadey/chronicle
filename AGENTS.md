# AGENTS.md

- Active work is in `src/`; treat `deprecated/` as reference only.
- Install with `npm install`.

## Common Commands

- `npm run cli`: interactive Chronicle CLI.
- `npm run staff-cli`: staff interview CLI.
- `npm run server`: HTTP API server.
- `npm run web`: Vite browser app.
- `npm run web:dev`: start the API server and browser app together, then open the browser.
- `npm run web:build`: build the browser app for static hosting.
- `npm run web:preview`: preview the built browser app.
- `npm test`: active vNext test suite.
- `npm run test:vnext`: same suite, named explicitly.
- `npm run typecheck`: TypeScript type check.
- `npm run lint`: typecheck-backed lint gate.
- `npm run lint:eslint`: ESLint over `src`.

## CLI Workflows

- Main CLI commands: `/help`, `/state`, `/session`, `/style <lyric|cinematic|michener>`, `/reasoning <low|medium|high>`, `/debug [on|off]`, `/trace [on|off]`, `/detail <summary|raw>`, `/new [sessionId]`, `/exit`.
- `CHRONICLE_API_MODE` accepts `auto`, `fallback`, or `live`; `live` requires `OPENAI_API_KEY` or `VITE_OPENAI_API_KEY`.
- `CHRONICLE_SESSION_ROOT` overrides session storage.
- `CHRONICLE_ALLOW_NON_TTY=1|true|yes|on` enables non-interactive CLI runs.
- `CHRONICLE_CLI_TRANSCRIPT` writes CLI input/output as JSONL.
- Staff CLI commands are only `/help`, `/session`, `/new [sessionId]`, and `/exit`.
