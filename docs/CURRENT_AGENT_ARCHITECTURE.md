# Current Agent Architecture

This document describes the active architecture in the codebase today.

It is intentionally narrower than [`docs/CHRONICLE_NORTH_STAR.md`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/docs/CHRONICLE_NORTH_STAR.md).

The north star defines the intended end-state.
This file defines the implemented runtime boundary.

## Status

Chronicle now has the active Steward + Council system in place.

What exists today is:

- a real Steward entry/exit path in the active turn engine
- a real hierarchy type layer (`TurnPlan`, council task/result packets, registry types)
- three implemented council domains: `character`, `world`, and `systems`
- a legacy GM loop that remains available as an explicit fallback and compatibility path
- stewardship and council dispatch that are domain-authoritative for the turns they own

## Runtime Shape

The active turn runtime lives in [`src/engine/turnEngine.ts`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/engine/turnEngine.ts).

Each player turn currently follows this shape:

1. `TurnEngine` builds bounded turn context.
2. `openStewardTurn()` classifies the action and may emit council tasks.
3. If the turn is clearly mechanics-owned, the steward attempts deterministic mechanics preflight.
4. The steward dispatches bounded council work to the appropriate domain runner, including `runCharacterDesignerTask()`, `runWorldDesignerTask()`, or `runSystemsDesignerTask()`.
5. `closeStewardTurn()` decides whether the steward-owned result is safe to commit and whether narration can use a council handoff packet.
6. If that steward path does not fully handle the turn, control falls back to the legacy GM loop via `runGMAgent()`.
7. Narration is generated from either the council handoff packet or the legacy GM-driven turn result.

In other words:

- the steward is real
- the council is real and domain-split
- the GM is still the fallback governor, not the primary owner of routine turns

## What The Steward Owns Today

The implemented steward surface is in [`src/agents/steward/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/steward).

Today the steward can:

- classify a turn using `classifyTurn()`
- recognize deterministic mechanics-owned turns
- build council tasks for:
  - read-only observation
  - cardinal movement
- route work to the matching council domain
- synthesize the result of those tasks
- decide whether to commit those proposed events or fall back to the GM

Today the steward does **not** yet:

- maintain its own persistent cross-session memory as a separate world-authority layer
- dispatch arbitrarily many council domains without bounded turn context
- use `CouncilRegistry` as an open-ended free-for-all
- directly own DirectorState evolution in a richer way than the existing GM contract
- replace the GM for ambiguous or multi-domain turns

## What The Council Means Today

The hierarchy contracts live in [`src/agents/hierarchy/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/hierarchy).

The council surface lives in [`src/agents/council/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/council).

Implemented now:

- `characterDesigner`
  - real executable task runner
  - handles character-facing bounded reasoning
- `worldDesigner`
  - real executable task runner
  - handles world-facing bounded reasoning
- `systemsDesigner`
  - real executable task runner
  - can own observation turns
  - can own safe cardinal movement turns by delegating to the mechanics worker

Not yet true in the active runtime:

- unbounded multi-council fanout with no turn budgeting
- autonomous council loops that bypass steward routing
- council-owned worker trees without turn-level guardrails

## Relation To The GM

The GM remains the broad orchestration fallback in [`src/agents/gm/gmAgent.ts`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/gm/gmAgent.ts).

That GM still:

- consults NPC agents
- consults specialists
- manages agenda and DirectorState updates
- reviews mechanics and schedule resolutions
- finishes most turns

So the current architecture is best described as:

**Steward-first routing with a real multi-domain council, plus explicit GM fallback for turns that need it.**

The GM is no longer the primary owner of the whole runtime, but it still remains part of the safety net and legacy compatibility path.

## Proto-Council Components

Several older agent surfaces already behave like proto-council pieces but are not formally promoted yet:

- [`src/agents/specialists/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/specialists)
- [`src/agents/npc/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/npc)
- [`src/agents/mechanics/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/mechanics)

Right now they are mostly called through steward/council routing or by the GM fallback, not by a generalized open-ended registry.

## Official Working Definition

Until the broader migration lands, Chronicle should use this terminology:

- **Steward**: the active routing and synthesis layer that opens a turn, dispatches bounded council work, and either closes the turn or falls back to the GM.
- **Council**: the bounded domain-owner interface represented by hierarchy contracts and council task/result packets.
- **Systems Council**: one of the currently implemented council domains in active turn execution.
- **GM**: the legacy generalist controller that remains responsible for turns the current steward path cannot safely own.

## Practical Migration Standard

A feature should only be called "moved to the council" when all of the following are true:

- the steward emits a domain task for it
- the domain has a concrete executable council agent, not only types
- the council result is structured and decision-ready
- the steward can close that path without GM intervention for the happy path
- fallback to GM is explicit rather than implicit

Until those conditions hold, the feature is still GM-owned with council-style scaffolding.
