# Chronicle vNext (Backend + CLI)

Chronicle vNext is a deterministic, event-driven simulation runtime with an agentic GM layer on top of the OpenAI Responses API. The active runtime is vNext only.

## Runtime Requirements

- Node.js 20 LTS (`.nvmrc` is pinned to `20`)
- npm
- Optional: `OPENAI_API_KEY` (without a key, the runtime uses deterministic fallback behavior)

## Active Architecture

- `src/sim/*`: deterministic world model, event validation, reducers, invariants, systems (time/tide/weather), and views.
- `src/engine/*`: turn orchestration, event commit path, JSONL session persistence, replay utilities.
- `src/agents/*`: GM, NPC, and narrator agents using the Responses API client.
- `src/server.ts`: preserved HTTP contract routes (`/api/init`, `/api/turn`).
- `src/cli.ts`: interactive CLI loop for init + turn execution.

Legacy runtime code was moved out of active source to `deprecated/legacy-v4/src`.

## API Contract (Preserved Routes)

### `POST /api/init`

Input:
```json
{ "sessionId": "optional", "apiKey": "optional" }
```

Output:
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

Input:
```json
{
  "sessionId": "string",
  "playerText": "string",
  "apiKey": "optional",
  "narratorStyle": "lyric|cinematic|michener",
  "debug": { "includeTrace": true }
}
```

Output (additive vNext fields):
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

Error shape:
```json
{ "error": "message", "code": "error_code", "details": {} }
```

## Session Persistence Format

Sessions are stored under `data/sessions/<sessionId>/`:

- `initial.json`: immutable vNext initial state.
- `snapshot.json`: latest committed state.
- `events.jsonl`: append-only turn records.

Replay determinism target is state equivalence: `replay(initial + events.jsonl) == snapshot`.

## Commands

- `npm run server`: start HTTP API server on port `3001` (or `PORT` env var).
- `npm run cli`: start interactive CLI.
- `npm test`: run active vNext test suite.
- `npm run test:vnext`: run vNext tests explicitly.
- `npm run typecheck`: TypeScript type check (`tsc --noEmit`).
- `npm run lint`: current local lint gate (typecheck-backed).
- `npm run lint:eslint`: ESLint over active source (requires installed ESLint deps).

## Troubleshooting

- If dependencies are stale after Node version changes:
  1. `rm -rf node_modules package-lock.json`
  2. `npm install`
- Ensure `node -v` reports Node 20.x.
- If OpenAI calls fail, verify `OPENAI_API_KEY` is present; runtime fallback still allows deterministic turns.

## Migration Notes

- v4 runtime is no longer exported from `src/index.ts`.
- v4 code is retained only in `deprecated/legacy-v4/src`.
- Existing non-vNext session snapshots are rejected (no automatic migration in this phase).
