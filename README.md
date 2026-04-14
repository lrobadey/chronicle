# Chronicle vNext

Chronicle vNext is the active Chronicle runtime: a deterministic simulation core with an agentic GM layer, a small HTTP API, an interactive CLI, and a browser UI. The shipped worlds are **Isle of Marrow** and **Tel Mora**.

## What's In This Repo

- `src/sim/*`: world state, events, reducers, validation, invariants, systems, and telemetry/observation views.
- `src/engine/*`: turn orchestration, persistence, replay, and debug plumbing.
- `src/agents/*`: OpenAI-powered GM, NPC, narrator, specialist, mechanics, steward, and staff-interview agents plus the shared LLM client.
- `src/worlds/*`: world modules and world selection.
- `src/server.ts`: HTTP API for session initialization, turns, health checks, and static web serving.
- `src/cli.ts` and `src/cli/app.ts`: interactive command-line play loop.
- `src/staff-cli.ts`: staff interview CLI.
- `deprecated/*`: legacy source snapshots kept for reference only.

## Requirements

- Node.js 20.x
- npm
- Optional: `OPENAI_API_KEY`
- Optional: `VITE_OPENAI_API_KEY`

If no API key is available, Chronicle falls back to deterministic runtime behavior.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the main CLI:

```bash
npm run cli
```

Start directly in Isle of Marrow or Tel Mora:

```bash
npm run cli:isle-of-marrow
npm run cli:tel-mora
```

Run the staff interview CLI:

```bash
npm run staff-cli
```

Run the HTTP server:

```bash
npm run server
```

Run the browser UI with Vite:

```bash
npm run web
```

Run the API server and browser app together, then open the browser:

```bash
npm run web:dev
```

The web app defaults to `http://127.0.0.1:3001` for its API base. The server listens on `http://localhost:3001` by default, or on `PORT` if set.

## Commands

- `npm run cli`: start the interactive CLI.
- `npm run cli:isle-of-marrow`: start the CLI in Isle of Marrow without world selection.
- `npm run cli:tel-mora`: start the CLI in Tel Mora without world selection.
- `npm run staff-cli`: start the staff interview CLI.
- `npm run server`: start the HTTP API server.
- `npm run web`: start the browser app with live reload.
- `npm run web:dev`: start API server + browser app together and open the app.
- `npm run web:build`: build the browser app for static hosting.
- `npm run web:preview`: preview the built browser app.
- `npm test`: run the vNext test suite.
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
- `/reasoning <low|medium|high>`: change GM reasoning effort.
- `/debug [on|off]`: toggle the live debug timeline.
- `/trace [on|off]`: alias for `/debug`.
- `/detail <summary|raw>`: change debug verbosity.
- `/new [sessionId]`: start or resume a session in the current world.
- `/exit`: leave the CLI.

CLI environment variables:

- `CHRONICLE_API_MODE`: `auto`, `fallback`, or `live`.
- `CHRONICLE_SESSION_ROOT`: override the session storage directory.
- `CHRONICLE_STARTUP_WORLD_ID`: set the startup world before the world prompt runs.
- `CHRONICLE_SKIP_WORLD_PROMPT`: set to `1`, `true`, `yes`, or `on` to skip world selection.
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
{ "sessionId": "optional", "worldId": "optional", "apiKey": "optional", "stream": true }
```

Response:

```json
{
  "sessionId": "string",
  "created": true,
  "initialNarration": "string",
  "telemetry": {},
  "history": {},
  "world": {},
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
  "summary": {},
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
- The current default world id is `isle-of-marrow`.
- `OPENAI_API_KEY` and `VITE_OPENAI_API_KEY` are both recognized by the CLI.
- The HTTP server uses `OPENAI_API_KEY` if present, but requests may also pass `apiKey` in the body.
- In `auto` mode, the CLI can fall back to deterministic behavior if the live OpenAI request fails.
