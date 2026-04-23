# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chronicle vNext is a deterministic simulation core with a steward-routed agent runtime, a small HTTP API, and an operator-first CLI. The default world is `isle-of-marrow`. Node.js 20.x is required (`engines` in `package.json`).

`OPENAI_API_KEY` (or `VITE_OPENAI_API_KEY` for CLI startup) is optional — without one, Chronicle runs in a deterministic fallback mode.

## Commands

Runtime / dev:

- `npm run cli` — interactive CLI (entry: `src/cli.ts`, router: `src/cli/operatorCli.ts`).
- `npm run cli -- turn run "<text>"` / `turn explain "<text>"` / `inspect <subcmd>` — one-shot operator commands.
- `npm run cli:isle-of-marrow` / `npm run cli:tel-mora` — skip the world prompt.
- `npm run staff-cli` — interactive staff-interview tool (`src/staff-cli.ts`).
- `npm run server` — HTTP API on `PORT` (default `3001`): `POST /api/init`, `POST /api/turn`, `GET /health`. Supports SSE when `stream: true`.
- `npm run web` — Vite dev server for the React UI in `src/web/` (proxies `/api` and `/health` to `:3001`).
- `npm run web:dev` — spawns API + web together via `src/dev/webDev.ts`.
- `npm run web:build` / `npm run web:preview` — static build / preview.

Quality gates:

- `npm run typecheck` — `tsc --noEmit`. `npm run lint` is aliased to typecheck; ESLint is opt-in via `npm run lint:eslint`.
- `npm test` / `npm run test:vnext` — the tests are **not** run via vitest. The script wipes `.tmp-tests/`, compiles `tsconfig.test.json` to CommonJS, writes a `package.json` shim, and runs `node --test .tmp-tests/tests-vnext/**/*.test.js`. Tests live in `src/tests-vnext/**/*.test.ts`.
- Run a single test file: `rm -rf .tmp-tests && tsc -p tsconfig.test.json && echo '{"type":"commonjs"}' > .tmp-tests/package.json && node --test .tmp-tests/tests-vnext/engine/turnEngine.test.js` (replace path). There is a `vitest.config.ts` in the repo, but the declared test script doesn't use it — prefer the node-test path above unless you're intentionally switching runners.

Note: `vite` is invoked as `vite src` (and `vite build src`) — the `src/` directory is the web root and contains `index.html`.

## Architecture

The authoritative runtime seam is `src/engine/turnEngine.ts` — specifically `TurnEngine.runTurn()`. Treat it as the source of truth for turn ordering; the `docs/` files describe intent, not necessarily live behavior.

### Turn flow (read this before changing agent code)

1. Load state + history, build bounded context bundles (`src/engine/contextBuilders.ts`).
2. `openStewardTurn()` classifies the player action as `deterministic`, `simple_council`, or `steward_judgment`.
3. If council tasks are emitted, dispatch to the domain runners in `src/agents/council/`: `runCharacterDesignerTask`, `runWorldDesignerTask`, `runSystemsDesignerTask`.
4. `closeStewardTurn()` (`src/agents/steward/closeTurn.ts`) decides whether council output is commit-safe. This is also where council output becomes `councilArtifacts`, narrator handoff data is assembled, and held beats are released.
5. If the classified path doesn't close cleanly, fall back to `runLegacyGMProposal()` → `runGMAgent()` (`src/agents/gm/gmAgent.ts`). The GM loop is an explicit safety net, not dead code.
6. For `steward_judgment` turns not already handled, `runStewardAgent()` runs a tool loop (`inspect_world_summary`, `dispatch_character_task`, `dispatch_world_task`, `dispatch_systems_task`, `inspect_council_results`, `finish_steward_turn`).
7. Narrate via `src/agents/narrator/` and persist via the session store.

Keep this in mind: a feature is only "council-owned" if the steward emits a task for it, a real council runner executes it, `closeStewardTurn()` / `finish_steward_turn` can commit its output, and fallback stays explicit when it fails. Otherwise it's still in the GM recovery layer. See `docs/CURRENT_AGENT_ARCHITECTURE.md` for the full contract and `docs/CHRONICLE_NORTH_STAR.md` for the long-term target.

### Layout

- `src/sim/` — deterministic core: `state.ts`, `events.ts`, `reducer.ts` (event → state), `validate.ts`, `invariants.ts`, `spine.ts` (authoritative item placement), `systems/` (tide, time, travel, weather, reputation, decay, constraints), `views/` (observe, telemetry, diff). No LLM code lives here.
- `src/engine/` — `turnEngine.ts`, `contextBuilders.ts` (bounded per-agent contexts), `debug.ts` (event sink), `errors.ts` (typed `ChronicleError` hierarchy used by server/CLI), `session/` (`jsonlStore.ts`, `replay.ts`, `types.ts`).
- `src/agents/`
  - `steward/` — `openTurn`, `closeTurn`, `stewardAgent` (tool loop), `tools`, `prompts`, `types`.
  - `council/` — three domain designers, each with `agent.ts`, `prompts.ts`, `tools.ts`, `types.ts`.
  - `gm/` — legacy fallback loop and its tools.
  - `hierarchy/` — shared `CouncilDomain`, `CouncilTask`, packet definitions, `promptReply`, `registry`, `turnPlan`. Read `types.ts` before touching the steward↔council contract.
  - `npc/`, `narrator/`, `specialists/`, `mechanics/`, `schedule/`, `staffInterview/` — bounded helpers reachable from GM or steward runtime.
  - `llm/` — `openaiClient`, `trace` (tool-trace recording), `types`, `defaults`, `errorUtils`. Tool traces are pushed via `pushToolTrace` and surface in CLI inspect/trace views.
- `src/cli/` — operator CLI (`operatorCli.ts` command router, `operatorEngine.ts` engine wrapper, `operatorRender.ts` output renderers, `app.ts` shared CLI helpers, `thinkingAnimation.ts`, `staffApp.ts`, `commandParsing.ts`, `lastRunExplainCli.ts`).
- `src/server.ts` — thin HTTP + SSE wrapper over `TurnEngine`; maps `ChronicleError` subclasses to structured `{ error, code, details }` responses.
- `src/web/` — React 19 + Vite UI (`App.tsx`, `main.tsx`, `model.ts`, `styles.css`). UI talks to the API via proxy.
- `src/worlds/` — world modules. `registry.ts` exports `DEFAULT_WORLD_ID = 'isle-of-marrow'` and `resolveWorldModule()`. New worlds must be registered in the `WORLD_MODULES` list.
- `src/index.ts` — public surface; re-exports from `sim`, `engine`, and agent namespaces.

### Session storage

Sessions live under `data/sessions/<sessionId>/` (gitignored):

- `initial.json` — immutable starting state.
- `snapshot.json` — latest committed state.
- `events.jsonl` — append-only turn records.

Replay (`src/engine/session/replay.ts`) is deterministic from `initial.json` + `events.jsonl`. Changes to the reducer, spine, or event schema must preserve replay compatibility or bump incompatibility markers (see `IncompatibleSessionError`).

### CLI environment variables

- `CHRONICLE_API_MODE` — `auto` | `fallback` | `live`.
- `CHRONICLE_SESSION_ROOT` — overrides `data/sessions`.
- `CHRONICLE_STARTUP_WORLD_ID` — default world for `play`, `turn run`, `session new`.
- `CHRONICLE_SKIP_WORLD_PROMPT` — skip the interactive world picker.
- `CHRONICLE_ALLOW_NON_TTY` — `1`/`true`/`yes`/`on` permits non-interactive runs.
- `CHRONICLE_CLI_TRANSCRIPT` — path to write a JSONL transcript of CLI events.

## Conventions

- TypeScript ESM. `tsconfig.json` enables `allowImportingTsExtensions` and `noEmit`; runtime uses `tsx`. Tests compile separately to CommonJS via `tsconfig.test.json` and run under `node --test`.
- Path alias `@/*` → repo root.
- ESLint: `@typescript-eslint/no-explicit-any` is off; unused vars must be prefixed with `_`. `deprecated/`, `dist/`, `data/` are ignored.
- `deprecated/` holds legacy snapshots for reference; do not import from it, and it's excluded from typecheck/tests.
- Errors thrown in the engine should extend `ChronicleError` (see `src/engine/errors.ts`) so the server and CLI can map them consistently.
- The default world seed is `isle-of-marrow`; tests typically use fixed anchor timestamps (e.g. `2025-01-01T14:00:00Z`) for determinism.
- The LLM layer is pluggable: `TurnEngine` accepts an `LLMClient` in its config, and tests inject a `QueueLLM` (`src/tests-vnext/helpers/queueLLM.ts`) rather than hitting OpenAI.
