# Chronicle vNext

Chronicle vNext is the active Chronicle runtime: a deterministic simulation core with a steward-routed agent hierarchy, a small HTTP API, and an operator-first CLI. The default world is **Isle of Marrow**.

## Agent Architecture

Chronicle is now running the steward + council shape in the active runtime.

- The current runtime boundary is documented in [`docs/CURRENT_AGENT_ARCHITECTURE.md`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/docs/CURRENT_AGENT_ARCHITECTURE.md).
- The long-term target remains [`docs/CHRONICLE_NORTH_STAR.md`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/docs/CHRONICLE_NORTH_STAR.md).

Short version: the steward is the turn router and synthesis layer, the council has real domain agents for character, world, and systems work, and the GM remains a fallback path for turns the steward cannot safely own.

## Current Status

The repo is centered on the active vNext runtime rather than a legacy hybrid.

- `src/engine/turnEngine.ts` is the main orchestration seam.
- `src/agents/steward/*` owns turn opening, task dispatch, and turn closure.
- `src/agents/council/*` contains the active domain agents.
- `src/cli/*` is now operator-first, with structured inspection and turn controls.
- `src/server.ts` still exposes the small HTTP compatibility API.

Recent commits that show the current direction:

- `7ad87f9` - `Add startup world selection and CLI thinking animation` on 2026-04-16.
- `a1a5847` - `Add operator-first CLI workflows` on 2026-04-15.
- `77d4399` - `Reshape steward as router and expand council into per-domain agent loops` on 2026-04-15.
- `8db9442` - `Promote steward to full GM: remove delegate_legacy_gm, add direct NPC/specialist/event tools` on 2026-04-15.
- `fa551be` - `Document current steward architecture and export hierarchy APIs` on 2026-04-15.

## What's In This Repo

- `src/sim/*`: world state, events, reducers, validation, invariants, systems, and telemetry/observation views.
- `src/engine/*`: turn orchestration, persistence, replay, and debug plumbing.
- `src/agents/*`: OpenAI-powered GM, NPC, and narrator agents plus the shared LLM client.
- `src/server.ts`: HTTP API for session initialization and turns.
- `src/cli.ts` and `src/cli/*`: operator-first CLI, reporting layer, and interactive play mode.
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
- The API server uses `OPENAI_API_KEY` if present, but requests may also pass `apiKey` in the body.
- In `auto` mode, the CLI can fall back to deterministic behavior if the live OpenAI request fails.
