# Chronicle vNext

Chronicle vNext is the active Chronicle runtime: a deterministic simulation core with a steward-routed agent runtime, a small HTTP API, and an operator-first CLI. The default world is **Isle of Marrow**.

## Agent Architecture

Chronicle is now running the steward + council shape in the active runtime.

- The current runtime boundary is documented in [`docs/CURRENT_AGENT_ARCHITECTURE.md`](docs/CURRENT_AGENT_ARCHITECTURE.md).
- The long-term target remains [`docs/CHRONICLE_NORTH_STAR.md`](docs/CHRONICLE_NORTH_STAR.md).

Short version: the steward owns turn routing, the council owns bounded domain work for character, world, and systems tasks, and the GM remains an explicit fallback path when the routed path does not safely close a turn.

## Current Status

The repo is centered on the active vNext runtime rather than a legacy hybrid.

- `src/engine/turnEngine.ts` is the main orchestration seam.
- `src/agents/steward/*` owns turn opening, route classification, bounded dispatch, and steward-judgment completion.
- `src/agents/council/*` contains the active domain agents.
- `src/cli/*` is now operator-first, with structured inspection and turn controls.
- `src/server.ts` still exposes the small HTTP compatibility API.

Recent commits that show the current direction:

- `f9aa6d7` - `Simplify Chronicle web shell and menu controls` on 2026-04-21.
- `7936f5c` - `Refine Chronicle agent routing and ownership boundaries` on 2026-04-21.
- `1b0b3de` - `Phase 1: lean council/steward briefs, tighter inspects, LLM trace timing` on 2026-04-20.
- `93fb290` - `Record executionMs on every tool trace and fix systems result schema` on 2026-04-20.
- `ce273ae` - `Release held beats on steward close` on 2026-04-16.

## What's In This Repo

- `src/sim/*`: world state, events, reducers, validation, invariants, systems, and telemetry/observation views.
- `src/engine/*`: turn orchestration, persistence, replay, and debug plumbing.
- `src/agents/*`: steward, council, GM, NPC, narrator, and shared LLM client surfaces.
- `src/server.ts`: HTTP API for session initialization and turns.
- `src/cli.ts` and `src/cli/*`: operator-first CLI, reporting layer, and interactive play mode.
- `deprecated/*`: legacy source snapshots kept for reference only.

## Requirements

- Node.js 20.x
- npm
- Optional: `OPENAI_API_KEY`
- Optional: `VITE_OPENAI_API_KEY` as the legacy/shared key name used by the CLI and HTTP server

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

Examples:

```bash
npm run cli -- turn explain "look around"
npm run cli -- turn run "go north" --view full
npm run cli -- inspect trace --session <session-id> --view raw
```

Run the HTTP server:

```bash
npm run server
```

Run the browser UI (served by Vite):

```bash
npm run web
```

For the production-style browser app and API on one origin:

```bash
npm start
```

Or run both API + web app in one command (also auto-opens your browser):

```bash
npm run web:dev
```

In development, Vite proxies same-origin `/api` calls to `http://localhost:3001`. In the production-style `npm start` flow, the Chronicle server serves both the built app and API from `http://localhost:3001`. You can change API Base under Session → Advanced when hosting the UI and API separately.

Set `OPENAI_API_KEY` or `VITE_OPENAI_API_KEY` in the server environment for live model calls. `OPENAI_API_KEY` takes precedence when both are present. You can also enter a key under Session → Advanced; browser-entered keys stay in memory for the current tab and are sent only in Chronicle API request bodies. Without a key, Chronicle remains usable in deterministic fallback mode.

The Session drawer also lets you choose the world used by the next fresh session, change narrator style, enable trace capture, reconnect to a different API base, and recover from stale sessions.

By default the server listens on `http://localhost:3001` or the `PORT` environment variable if set.

## Commands

- `npm run cli`: start the interactive CLI.
- `npm run server`: start the HTTP API server.
- `npm start`: build the browser app and serve it with the API on one origin.
- `npm run web`: start the browser app with live reload (Vite).
- `npm run web:dev`: start API server + browser app together and open the app in your browser.
- `npm run web:build`: build the browser app for static hosting.
- `npm run web:preview`: preview the built browser app.
- `npm test`: run the active vNext test suite.
- `npm run test:vnext`: same test suite, explicitly named.
- `npm run typecheck`: run TypeScript type checking.
- `npm run lint`: typecheck-backed local lint gate.
- `npm run lint:eslint`: run ESLint across `src`.

`web:preview` previews static UI assets only. Use `npm start` when you want the browser app and Chronicle API together.

## CLI

The CLI is now operator-first. The main surface is a command tree for inspecting route decisions, council dispatch, trace timelines, steward state, artifacts, and history. `play` remains available as an interactive mode on top of the same reporting layer.

Top-level commands:

- `chronicle play`
- `chronicle turn run "<text>"`
- `chronicle turn explain "<text>"`
- `chronicle inspect session|state|route|steward|council|trace|history|artifacts|prompts|world`
- `chronicle staff ask "<question>"`
- `chronicle staff interactive`
- `chronicle session new [sessionId]`
- `chronicle session resume <sessionId>`
- `chronicle session list`
- `chronicle worlds list`

Useful flags:

- `--json`: emit machine-readable output.
- `--view <summary|operator|full|raw>`: control depth of backstage detail.
- `--raw`: include raw payloads and exact trace/tool data.
- `--verbose`: include extra bounded summaries.
- `--diff`: include detailed before/after state data.
- `--no-narration`: suppress narration blocks in one-shot reports.
- `--session <id>`: target an existing session for inspect commands.
- `--world <id>`: select the startup world for `play`, `turn run`, or `session new`.

Interactive play mode:

- Start with `npm run cli` or `npm run cli -- play`.
- Enter actions normally.
- Use `:inspect ...`, `:session ...`, and `:staff ask ...` inside the play loop.
- Legacy slash commands still work temporarily inside `play`, but they print deprecation notices.

CLI environment variables:

- `CHRONICLE_API_MODE`: `auto`, `fallback`, or `live`.
- `CHRONICLE_SESSION_ROOT`: override the session storage directory.
- `CHRONICLE_STARTUP_WORLD_ID`: choose the default world for `play` and session creation.
- `CHRONICLE_ALLOW_NON_TTY`: set to `1`, `true`, `yes`, or `on` to allow non-interactive runs.

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
- The API server uses `OPENAI_API_KEY` or `VITE_OPENAI_API_KEY` if present, but requests may also pass `apiKey` in the body.
- In `auto` mode, the CLI can fall back to deterministic behavior if the live OpenAI request fails.
