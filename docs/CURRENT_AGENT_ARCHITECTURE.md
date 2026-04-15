# Current Agent Architecture

This document describes the active architecture in the codebase today.

It is intentionally narrower than [`docs/CHRONICLE_NORTH_STAR.md`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/docs/CHRONICLE_NORTH_STAR.md).

The north star defines the intended end-state.
This file defines the implemented runtime boundary.

## Status

Chronicle does **not** yet have the full Steward + Council system in place.

What exists today is:

- a real Steward entry/exit path in the active turn engine
- a real hierarchy type layer (`TurnPlan`, council task/result packets, registry types)
- one implemented council domain: `systems`
- a legacy GM loop that still owns most turns
- proto-council components that remain advisory rather than domain-authoritative

## Runtime Shape

The active turn runtime lives in [`src/engine/turnEngine.ts`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/engine/turnEngine.ts).

Each player turn currently follows this shape:

1. `TurnEngine` builds bounded turn context.
2. `openStewardTurn()` classifies the action and may emit council tasks.
3. If the turn is clearly mechanics-owned, the steward attempts deterministic mechanics preflight.
4. If the turn matches the current systems slice, the engine dispatches the task to `runSystemsDesignerTask()`.
5. `closeStewardTurn()` decides whether the steward-owned result is safe to commit and whether narration can use a systems handoff packet.
6. If that steward path does not fully handle the turn, control falls back to the legacy GM loop via `runGMAgent()`.
7. Narration is generated from either the systems handoff packet or the legacy GM-driven turn result.

In other words:

- the steward is real
- the council is partial
- the GM is still the general fallback governor

## What The Steward Owns Today

The implemented steward surface is in [`src/agents/steward/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/steward).

Today the steward can:

- classify a turn using `classifyTurn()`
- recognize deterministic mechanics-owned turns
- build one systems council task for:
  - read-only observation
  - cardinal movement
- synthesize the result of that systems task
- decide whether to commit those proposed events or fall back to the GM

Today the steward does **not** yet:

- maintain its own distinct runtime agent with cross-session reasoning
- dispatch multiple council domains in parallel
- use `CouncilRegistry` at runtime
- directly own DirectorState evolution in a richer way than the existing GM contract
- replace the GM for ambiguous or multi-domain turns

## What The Council Means Today

The hierarchy contracts live in [`src/agents/hierarchy/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/hierarchy).

The council surface lives in [`src/agents/council/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/council).

Implemented now:

- `systemsDesigner`
  - real executable task runner
  - can own observation turns
  - can own safe cardinal movement turns by delegating to the mechanics worker

Scaffold only:

- `worldDesigner` types only
- `characterDesigner` types only

Not yet true in the active runtime:

- world designer dispatch
- character designer dispatch
- multi-council synthesis
- council-owned worker trees beyond the systems slice

## Relation To The GM

The GM remains the broad orchestration fallback in [`src/agents/gm/gmAgent.ts`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/gm/gmAgent.ts).

That GM still:

- consults NPC agents
- consults specialists
- manages agenda and DirectorState updates
- reviews mechanics and schedule resolutions
- finishes most turns

So the current architecture is best described as:

**Steward-first routing for a narrow systems-owned slice, with legacy GM fallback for everything else.**

It is **not** yet a fully promoted steward replacing the GM as the universal turn owner.

## Proto-Council Components

Several older agent surfaces already behave like proto-council pieces but are not formally promoted yet:

- [`src/agents/specialists/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/specialists)
- [`src/agents/npc/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/npc)
- [`src/agents/mechanics/`](/Users/lucarobadey/Desktop/Projects/Coding/Chronicle/src/agents/mechanics)

Right now they are mostly called by the GM or by the systems council slice, not by a generalized council registry.

## Official Working Definition

Until the broader migration lands, Chronicle should use this terminology:

- **Steward**: the active routing and synthesis layer that opens a turn, may dispatch bounded council work, and either closes the turn or falls back to the GM.
- **Council**: the bounded domain-owner interface represented by hierarchy contracts and council task/result packets.
- **Systems Council**: the only currently implemented council domain in active turn execution.
- **GM**: the legacy generalist controller that remains responsible for all turns the current steward path cannot safely own.

## Practical Migration Standard

A feature should only be called "moved to the council" when all of the following are true:

- the steward emits a domain task for it
- the domain has a concrete executable council agent, not only types
- the council result is structured and decision-ready
- the steward can close that path without GM intervention for the happy path
- fallback to GM is explicit rather than implicit

Until those conditions hold, the feature is still GM-owned with council-style scaffolding.
