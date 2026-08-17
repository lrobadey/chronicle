# Current Agent Architecture

This document describes the architecture that is actually live in Chronicle today.

It is intentionally narrower than [`docs/CHRONICLE_NORTH_STAR.md`](./CHRONICLE_NORTH_STAR.md). The north star is the destination. This file is the runtime truth.

## Runtime Authority

The real ownership seam is [`src/engine/turnEngine.ts`](../src/engine/turnEngine.ts), especially `TurnEngine.runTurn()`.

That one method is where Chronicle:

- loads state and turn history
- opens the steward route for the incoming player action
- dispatches bounded council work when the turn can be cleanly classified
- decides whether council output is safe to commit
- falls back to the legacy GM loop when that bounded path does not safely resolve the turn
- runs the freeform steward loop for ambiguous `steward_judgment` turns
- hands the final state into narration and persistence

If a description of the architecture does not match that control flow, it is describing an aspiration or an older snapshot, not the live runtime.

## Plain-System Summary

The live system is best understood as three layers:

- **Steward ownership**: the steward gets first routing authority over the turn. It decides whether the turn is narrow enough for bounded handling or broad enough to require steward judgment.
- **Council dispatch**: when the turn fits a bounded domain shape, the steward sends targeted work to the council domains that are relevant.
- **GM fallback**: when the bounded path does not produce a commit-safe outcome, Chronicle still has an explicit legacy GM loop as a safety net.

That means Chronicle is **not** "the steward replaced the GM everywhere."

It is also **not** "the GM still owns everything and the steward is cosmetic."

The live truth is:

**The steward owns routing, the council owns bounded domain work, and the GM still exists as an explicit fallback path for turns the routed path cannot safely close.**

## What `runTurn()` Actually Does

At a high level, every turn currently follows this sequence:

1. Load the current world state and recent turn history.
2. Build bounded context bundles for steward, council, mechanics, and GM-facing work.
3. Call `openStewardTurn()` to classify the player action into one of three shapes:
   - `deterministic`
   - `simple_council`
   - `steward_judgment`
4. If `openStewardTurn()` emits council tasks, dispatch them to the real council runners:
   - `runCharacterDesignerTask()`
   - `runWorldDesignerTask()`
   - `runSystemsDesignerTask()`
5. Call `closeStewardTurn()` to decide whether the council output is actually handled and safe to commit.
6. If that classified council path fails to close cleanly, call the explicit legacy fallback loop through `runLegacyGMProposal()`, which in turn can run `runGMAgent()`.
7. If the original turn was classified as `steward_judgment` and was not already handled, run `runStewardAgent()` with a bounded tool runtime so the steward can inspect, dispatch, and finish the turn directly.
8. Narrate the final committed result and persist the turn record.

The key distinction is that Chronicle currently has **two steward phases**:

- a deterministic/open-close routing phase for turns that can be classified up front
- a tool-using steward judgment phase for turns that need broader synthesis

## Steward Ownership Today

The live steward surface sits in [`src/agents/steward/`](../src/agents/steward).

Today the steward really does own:

- opening the turn through `openStewardTurn()`
- classifying the turn via `classifyTurn()`
- deciding whether the turn is deterministic, simple council, or steward judgment
- creating bounded council tasks from that routing decision
- closing classified council turns through `closeStewardTurn()`
- running a direct steward tool loop through `runStewardAgent()` for `steward_judgment` turns
- carrying turn-level synthesis tools such as:
  - `inspect_world_summary`
  - `dispatch_character_task`
  - `dispatch_world_task`
  - `dispatch_systems_task`
  - `inspect_council_results`
  - `finish_steward_turn`

In systems terms, the steward is the **traffic controller and final turn-shaper**, not the universal doer of every subtask.

## What The Council Means In The Live Runtime

The hierarchy contracts live in [`src/agents/hierarchy/`](../src/agents/hierarchy/).

The active domain runners live in [`src/agents/council/`](../src/agents/council/).

The council is real in the live runtime, but it is still bounded.

Implemented today:

- `character`
  - executed by `runCharacterDesignerTask()`
  - used for NPC-facing or character-facing bounded interpretation
- `world`
  - executed by `runWorldDesignerTask()`
  - used for scene motion and world-thread surfacing
- `systems`
  - executed by `runSystemsDesignerTask()`
  - used for observation, movement, mechanics-owned handling, narrator handoff packets, and pending-prompt recommendations

The council does **not** currently operate as an open-ended autonomous committee.

It only runs when the steward or the steward runtime dispatches specific bounded tasks into those domains.

## Where GM Fallback Still Matters

The legacy GM path is still real in [`src/agents/gm/gmAgent.ts`](../src/agents/gm/gmAgent.ts), and `turnEngine.ts` still wires it in on purpose.

When a classified council turn does not close safely, `runTurn()` calls `runLegacyGMProposal(...)`.

That fallback path can still:

- inspect the world from the broad GM context
- consult NPC agents
- consult specialists
- resolve and review mechanics work
- schedule and review schedule work
- produce agenda updates and director updates
- finish a turn proposal through the GM runtime

So the GM is no longer the default first owner of every turn, but it is still the broad compatibility and recovery path when the newer routed architecture does not safely finish the job.

## The Three Live Turn Paths

Chronicle currently has three real turn paths:

### 1. Classified council path

Used when `openStewardTurn()` identifies a narrow, bounded path.

Examples:

- observation
- cardinal movement
- clear NPC interaction

Shape:

- steward classifies
- council domains run
- steward closes
- result commits if handled

### 2. Council-to-GM fallback path

Used when the classified path ran, but the result was not safe to commit.

Examples:

- no council domain produced a handled result
- proposed systems events were rejected or could not be fully applied
- the systems domain explicitly signaled fallback

Shape:

- steward classifies
- council domains run
- steward close says "not safely handled"
- legacy GM fallback takes over for proposal generation

### 3. Steward judgment path

Used when the turn does not fit a narrow deterministic or simple single-pattern route.

Examples:

- broader ambiguous actions
- turns where a pending prompt changes the routing logic
- multi-domain intent that needs live steward synthesis

Shape:

- steward open classifies as `steward_judgment`
- the classified council fast path does not own the turn
- `runStewardAgent()` uses bounded tools to inspect, dispatch, and finish the turn

This is the part of the runtime where the steward behaves most like an actual active controller rather than only a classifier.

## What `closeStewardTurn()` Really Means

[`src/agents/steward/closeTurn.ts`](../src/agents/steward/closeTurn.ts) is the handoff decision point for classified council work.

It currently does three important things:

- converts council output into durable `councilArtifacts`
- decides whether the result counts as `handled`
- prepares narrator handoff data and director updates such as releasing relevant held beats

In plain terms: this is the place where Chronicle decides whether the routed council answer is a real turn result or only useful advice that still needs fallback.

## What Is Actually Moved Out Of GM Ownership

The following are genuinely steward/council-owned in the live runtime:

- turn opening and route classification
- bounded council dispatch for `character`, `world`, and `systems`
- classified observation and cardinal-movement handling through the systems path
- systems narrator handoff packets and pending-prompt recommendations
- council artifact persistence in the turn record

The following are **not** fully moved out of GM ownership yet:

- broad recovery for failed classified turns
- the legacy NPC/specialist generalist loop
- the broad GM proposal runtime used during explicit fallback
- general turn handling for cases the steward classifies as needing open-ended judgment unless and until the steward tool loop itself finishes the turn

## Working Definition For The Repo

When describing the current system in README text, CLI copy, or internal docs, the accurate short form is:

**Chronicle is a steward-routed runtime with real bounded council domains and an explicit legacy GM fallback.**

That wording matches the live code more closely than either of these overclaims:

- "the GM is gone"
- "the steward fully owns every turn"

## Practical Standard For Calling Something "Council-Owned"

A capability should only be described as moved into the council when all of these are true in the runtime:

- the steward emits a concrete task for it
- a real council runner executes that task
- the result comes back in structured form
- `closeStewardTurn()` or `finish_steward_turn` can convert it into a committed turn result on the happy path
- fallback remains explicit if that path fails

If those conditions are not true, the feature is still partly or fully living in the legacy GM recovery layer.
