## Chronicle: The Living Narrative Engine

Chronicle is a flexible, agent-driven narrative engine designed to create self-sustaining, text-based worlds. It combines deterministic simulation systems with real-time reasoning agents powered by large language models.

### Core idea
- **Deterministic foundation**: Weather, time, travel, economy, combat, and other world rules update automatically each turn. Systems are seed-based, logical, reproducible, and explainable.
- **Agentic Game Master (GM)**: An LLM-powered orchestrator that interprets player actions, reasons in context, plans, and calls tools. It can dynamically spin up, connect, or modify systems at runtime.
- **Narrative layer**: Outcomes are summarized into an evolving text record—the “chronicle”—producing a readable history of everything that happens.
- **State persistence**: Every event is written to the world database. Time, causality, and memory are permanent parts of the simulation.

### What makes it unique
- **Total flexibility**: Any setting, any ruleset—from space colonies to dog suburbs to vampire courts—on the same logical substrate.
- **Runtime system creation**: New mechanics can be generated and attached dynamically by the AI, expanding scope without human coding.
- **Agentic intelligence**: The GM reasons instead of following scripts; it chooses which systems to engage or create based on context.
- **Text-first design**: No graphics—only world logic and emergent narrative. Every action becomes part of a permanent written record.

### How it works (at a glance)
- **Deterministic layer**: Physics, systems, and world rules update automatically each turn—reliable, transparent, and seed-based.
- **Agentic layer**: The GM interprets player actions, delegates to sub-agents, and decides which systems to engage or create.
- **Narrative layer**: The engine summarizes outcomes and world changes as evolving text—the “chronicle” itself.

## v3 directory
This folder contains the v3 implementation of Chronicle.

- **agents/**: Reasoning agents.
  - `agents/gm.ts`: The Game Master that orchestrates systems, calls tools, and writes outcomes.
  - `agents/narrator.ts`, `agents/prompts.ts`: Narrative helpers and prompt scaffolding.
- **tools/**: Deterministic tool interfaces used by agents.
  - `tools/index.ts`, `tools/types.ts`
- **state/**: World state types and deterministic reducers.
  - `state/world.ts`, `state/arbiter.ts`, `state/pkg.ts`
- **ui/**: Minimal UI harness for demos.
  - `ui/App.tsx`
- **config.ts**: Shared configuration for v3.
- **cli.ts**: Command-line entry points.
- **server.ts**: HTTP API server for web UI integration.
- **smoke.ts**, **test-api.ts**: Quick tests and example integrations.

## Running the Demo

See [DEMO_GUIDE.md](./DEMO_GUIDE.md) for complete instructions on running the v3 demo.

Quick start:
```bash
# Terminal 1: Start API server
npm run demo:server

# Terminal 2: Start web UI
npm run demo:web
```

### Extending Chronicle
- **Add systems** by implementing deterministic mechanics and exposing tool interfaces the GM can call.
- **Add tools** for agents to query/modify world state deterministically.
- **Add sub-agents** for domain responsibilities (e.g., economy arbiter, travel planner) and have the GM delegate.

### Vision
Chronicle isn’t a game. It’s a world framework—a simulation that writes its own history, adapts its own systems, and lets players live inside self-evolving stories.
