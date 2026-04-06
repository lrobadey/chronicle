# Chronicle vNext

Chronicle vNext is the active Chronicle runtime: a deterministic simulation core with an agentic GM layer, a small HTTP API, and an interactive CLI. The default world is **Isle of Marrow**.

## What's In This Repo

- `src/sim/*`: world state, events, reducers, validation, invariants, systems, and telemetry/observation views.
- `src/engine/*`: turn orchestration, persistence, replay, and debug plumbing.
- `src/agents/*`: OpenAI-powered GM, NPC, and narrator agents plus the shared LLM client.
- `src/server.ts`: HTTP API for session initialization and turns.
- `src/cli.ts` and `src/cli/app.ts`: interactive command-line play loop.
- `deprecated/*`: legacy source snapshots kept for reference only.

## Requirements

- Node.js 20.x
- npm
- Optional: `OPENAI_API_KEY`
- Optional: `VITE_OPENAI_API_KEY` for CLI startup

If no API key is available, Chronicle runs in deterministic fallback mode.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the CLI:

```bash
npm run cli
```

Run the HTTP server:

```bash
npm run server
```

Run the browser UI (served by Vite):

```bash
npm run web
```

Or run both API + web app in one command (also auto-opens your browser):

```bash
npm run web:dev
```

The web app defaults to calling the API server at `http://localhost:3001` (or change API Base in the UI).

By default the server listens on `http://localhost:3001` or the `PORT` environment variable if set.

## Commands

- `npm run cli`: start the interactive CLI.
- `npm run server`: start the HTTP API server.
- `npm run web`: start the browser app with live reload (Vite).
- `npm run web:dev`: start API server + browser app together and open the app in your browser.
- `npm run web:build`: build the browser app for static hosting.
- `npm run web:preview`: preview the built browser app.
- `npm test`: run the active vNext test suite.
- `npm run test:vnext`: same test suite, explicitly named.
- `npm run typecheck`: run TypeScript type checking.
- `npm run lint`: typecheck-backed local lint gate.
- `npm run lint:eslint`: run ESLint across `src`.

## CLI

The CLI starts a session, prints the opening narration, and then accepts player actions or slash commands.

Available commands:

- `/help`: show command help.
- `/state`: print the current telemetry snapshot.
- `/session`: show session and mode information.
- `/style <lyric|cinematic|michener>`: change narrator style.
- `/debug [on|off]`: toggle the live debug timeline.
- `/trace [on|off]`: alias for `/debug`.
- `/detail <summary|raw>`: change debug verbosity.
- `/new [sessionId]`: start or resume a session.
- `/exit`: leave the CLI.

CLI environment variables:

- `CHRONICLE_API_MODE`: `auto`, `fallback`, or `live`.
- `CHRONICLE_SESSION_ROOT`: override the session storage directory.
- `CHRONICLE_ALLOW_NON_TTY`: set to `1`, `true`, `yes`, or `on` to allow non-interactive runs.
- `CHRONICLE_CLI_TRANSCRIPT`: write a JSONL transcript of prompts, inputs, and outputs to this path.

## HTTP API

The server exposes a small compatibility API:

- `POST /api/init`
- `POST /api/turn`
- `GET /health`

### `POST /api/init`

Request body:

```json
{ "sessionId": "optional", "apiKey": "optional", "stream": true }
```

Response:

```json
{
  "sessionId": "string",
  "created": true,
  "initialNarration": "string",
  "telemetry": {},
  "runtime": "vnext"
}
```

### `POST /api/turn`

Request body:

```json
{
  "sessionId": "string",
  "playerText": "string",
  "apiKey": "optional",
  "stream": true,
  "narratorStyle": "lyric|cinematic|michener",
  "debug": { "includeTrace": true }
}
```

Response:

```json
{
  "sessionId": "string",
  "turn": 1,
  "narration": "string",
  "telemetry": {},
  "acceptedEvents": [],
  "rejectedEvents": [],
  "trace": {}
}
```

### Streaming

If `"stream": true`, both endpoints return `text/event-stream` responses.

- `POST /api/init`: `init.started`, `opening.delta`, `init.completed`, `error`
- `POST /api/turn`: `turn.started`, `narration.delta`, `turn.completed`, `error`

The completed SSE event carries the same payload shape as the non-streaming response.

### Error Shape

```json
{ "error": "message", "code": "error_code", "details": {} }
```

## Session Storage

Sessions are stored under `data/sessions/<sessionId>/` by default:

- `initial.json`: the immutable initial world state.
- `snapshot.json`: the latest committed state.
- `events.jsonl`: append-only turn records.

Replay is intended to be deterministic from `initial.json` plus `events.jsonl`.

## Development Notes

- `src/index.ts` exports the active vNext surface.
- The current world seed is `isle-of-marrow`.
- The API server uses `OPENAI_API_KEY` if present, but requests may also pass `apiKey` in the body.
- In `auto` mode, the CLI can fall back to deterministic behavior if the live OpenAI request fails.
