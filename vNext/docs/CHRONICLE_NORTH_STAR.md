# Chronicle North Star

North Star specification for evolving Chronicle from a position-based narrative runtime into a governed, persistent, simulation-first world platform.

Status: North Star
Audience: humans, agents, maintainers
Scope: platform architecture, world state, simulation, governance, and language runtime

## 1. Purpose

Chronicle is a governed, persistent, simulation-first world platform.

The world is real, structured, and continues to exist whether or not the player is looking at it.

The AI does not author reality.

The AI governs, interprets, and pushes reality forward inside a world that is already represented as structured truth.

Chronicle is not aiming to become "AI that improvises scenes."

Chronicle is aiming to become a world simulator with language on top.

That thesis now sits inside a larger platform frame:

- the world persists across turns and sessions
- the world has intention and momentum independent of the player
- the world is stored as structured data, not hidden in prompts
- the runtime can deepen simulation selectively without rewriting the platform
- language remains an interface over governed truth, not a replacement for it

The shortest version is:

Dwarf Fortress crossed with adaptive AI governance and a world database, presented as a living interface you can inhabit.

Chronicle should therefore be built as a system where:

- the database remembers the world
- the simulation advances the world
- the governance layer decides what to deepen, surface, and pressure
- the language layer interprets committed truth into prose

The player is an actor inside that world, not the center of a content generator.

The LLM is not the keeper of truth.

The simulation is the keeper of truth.

This document defines the system Chronicle is trying to become.

## 2. The Core Problem

Current AI narrative systems are mostly reactive.

They wait for the player, then improvise a response.

Nothing pushes back.

Nothing has durable structure.

Nothing has its own agenda unless the model remembers to fake one.

Nothing continues cleanly between sessions except whatever the prompt or transcript happens to preserve.

This produces a common failure mode:

- the world behaves like a stage set
- entities exist only when mentioned
- pressure appears only when the player asks for it
- causality is thin
- continuity degrades with context loss
- the system rewards attention instead of representing reality

Chronicle's fundamental design goal is a world that has intention, momentum, and forward pressure independent of what the player initiates.

The player should not be interacting with an empty improviser.

The player should be inhabiting a governed world that already contains:

- places
- people
- objects
- relations
- systems
- incentives
- constraints
- pending consequences

The practical requirement follows directly:

Chronicle must make it cheap to ask, at any moment:

- what exists here?
- what is happening here?
- what would continue to happen if the player did nothing?
- what does this actor know?
- what is the world trying to do next?

If the platform cannot answer those questions from structured state, it is still operating as reactive narrative software rather than a world simulator.

## 3. Design Goals

Chronicle must support the following goals.

### 3.1. Positive Goals

- Persistent object permanence
- Persistent social and geographic identity
- Nested spatial and logical containment
- Ownership separated from possession
- Forward pressure independent of player initiation
- World intention represented as structured state rather than only style guidance
- Extensible detail without systemic rewrites
- Deterministic mutation of world state
- Believable long-term change through scheduled and lazy processes
- Pluggable simulation depth through capability packs
- Adaptive world thickening based on observed player behavior
- Cross-session persistence
- Off-session world advancement
- Strict separation of objective truth from subjective knowledge
- LLM participation without LLM authority over ground truth
- Bounded query packets rather than unscoped world dumps
- Layered runtime ownership so deterministic systems can preempt language work when appropriate

### 3.2. Anti-Goals

Chronicle must avoid:

- freeform LLM-written state patches as the main mutation path
- presentation-driven truth
- pure scene improvisation with no world substrate
- worlds that only thicken through manual bespoke rewrites
- requiring new hardcoded logic for every added item property
- global rewrites every time a new gameplay detail is introduced
- giving every agent the whole world context by default
- assuming every worker must be an LLM call
- simulating every unattended object every minute
- expensive off-session advancement before deterministic kernel systems exist
- treating "more prose" as equivalent to "more world"

### 3.3. Governing Principle

Chronicle should become a simulation operating system for persistent worlds.

That means the platform should be able to host multiple world configurations over time, with different simulation families activated through structured configuration rather than bespoke one-off game logic.

## 4. The Stack (Four Layers)

Chronicle should be built as four named layers:

1. Spine
2. Pulse
3. Veil
4. Voice

These are not branding labels.

They are ownership boundaries.

Each layer answers a different class of question.

Each layer can deepen without collapsing the responsibilities of the others.

### 4.1. Spine (World Database)

The Spine is the canonical truth.

Every location, house, room, item, person, faction, road, relation, and debt exists here as structured data.

The world is a database first, not a prompt.

The Spine answers:

- What exists?
- What kind of thing is it?
- Where is it?
- What is it connected to?
- What properties does it have?
- What processes are scheduled against it?
- What changed last?

The Spine is a large queryable entity-and-relations graph.

The world begins mostly coarse.

Detail expands lazily when attention goes there.

Expansion is permanent.

If a fishing village becomes important enough to materialize individual docks, storage sheds, local rivalries, and bait inventories, those additions stay in the Spine.

The system does not revert that place back into a coarse prompt summary later.

#### 4.1.1. Levels of Abstraction

Chronicle should intentionally use a small number of abstraction levels.

##### Level A. Entity Archetypes

Archetypes define broad kinds of things.

Examples:

- actor
- item
- location
- container
- surface
- structure
- portal
- faction

These are not bespoke features.

They are reusable categories.

##### Level B. Components

Components define what an entity can express.

Examples:

- physical
- material
- ownership
- condition
- container
- surface
- actor
- location
- decay
- routine

Adding detail should usually mean adding component data, not rewriting system logic.

##### Level C. Relations

Relations define how entities connect.

Examples:

- located_in
- part_of
- inside
- on
- carried_by
- worn_by
- owned_by
- resides_in
- connected_to

Adding new world richness should often mean adding relations, not inventing one-off object fields.

##### Level D. Processes

Processes are the reusable deterministic rules that operate on component and relation data.

Examples:

- movement
- transfer
- placement
- decay
- weathering
- theft risk
- spoilage
- social trust change

Adding new simulation behavior should usually mean adding a process preset, not rebuilding the world model.

##### Level E. Views

Views are actor-relative projections for UI, narration, and reasoning.

Examples:

- player local observation
- nearby affordances
- player knowledge summary
- NPC perspective summary

Views should be derived from the Spine plus Veil.

They are not canonical data.

#### 4.1.2. Extensibility Principle

Chronicle must be designed so that adding more detail is mostly a data exercise.

That means:

- new details are usually tags, component fields, archetype presets, or relation presets
- new gameplay categories are usually new process presets
- new world domains are usually capability packs configured against the same substrate
- new UI or narrative framing should reuse existing views and truth

This is the governing rule:

**Adding a new property should rarely require inventing a new simulation architecture.**

Examples:

- Adding sword length should be a `physical.lengthCm` field.
- Adding iron rusting should be `material.primary = iron` and `material.rustable = true`.
- Adding house ownership should be an `owned_by` relation.
- Adding "table in house in district in city" should be more nested `part_of` and `located_in` relations.
- Adding harbor dues should be a relation plus a scheduled or economic process, not a new custom storage model.

The system must prefer presets over bespoke behavior.

#### 4.1.3. Canonical Data Model

Chronicle World Spine v1 should extend the current `WorldState` with a dedicated `spine` object rather than replacing the entire runtime at once.

Current vNext runtime contract:

- `syncWorldSpine()` is a commit gate. It rebuilds the graph, validates canonical item placement and relation indexes, and throws a typed spine-integrity error on invalid commits.
- `setItemPlacement()` is the sanctioned item-placement mutator. It pre-validates the destination, mutates the graph, rebuilds indexes, and runs the same commit validator post-mutation.
- Turn processing keeps backward-compatible rejection strings while also attaching structured spine error details for callers that want machine-readable diagnostics.

```ts
WorldState {
  meta,
  map,
  systems,
  ledger,
  knowledge,
  actors,
  items,
  locations,
  spine: {
    entities: Record<EntityId, Entity>;
    relations: Record<RelationId, Relation>;
    indexes: {
      byType: Record<string, EntityId[]>;
      byFrom: Record<EntityId, RelationId[]>;
      byTo: Record<EntityId, RelationId[]>;
      byRelationType: Record<string, RelationId[]>;
    };
    schedules: Record<ScheduleId, ScheduledProcess>;
  };
}
```

The Spine schema is intentionally small.

It should remain small enough to stabilize, while still being open to additive component growth.

The current runtime already demonstrates this with implementation extensions such as lifecycle tracking on items.

That extension does not invalidate the model.

It proves the model can absorb more detail without changing its shape.

#### 4.1.4. Entity

```ts
Entity {
  id: string;
  kind: "actor" | "item" | "location" | "container" | "surface" | "structure";
  archetype: string;
  name: string;
  tags?: string[];
  components: {
    identity?: {
      tags?: string[];
      aliases?: string[];
    };
    physical?: {
      massKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      volumeL?: number;
      anchored?: boolean;
      portable?: boolean;
    };
    material?: {
      primary?: string;
      secondary?: string[];
      rustable?: boolean;
      flammable?: boolean;
      rotProfile?: string;
    };
    condition?: {
      durability?: number;
      wear?: number;
      rust?: number;
      rot?: number;
      broken?: boolean;
      notes?: string[];
    };
    ownership?: {
      legalOwnerId?: string;
      creatorId?: string;
      lastPossessorId?: string;
    };
    container?: {
      capacityL?: number;
      acceptsTags?: string[];
      sealed?: boolean;
    };
    surface?: {
      maxItems?: number;
      stable?: boolean;
    };
    actor?: {
      inventorySlots?: number;
      routineId?: string;
    };
    location?: {
      anchor?: { x: number; y: number; z?: number };
      radiusCells?: number;
      terrain?: string;
      exposureProfile?: string;
    };
    decay?: {
      class?: "indoor_stable" | "outdoor_weathering" | "organic_rot";
      lastSimulatedAtTurn?: number;
    };
  };
}
```

This schema is intentionally compositional.

An entity does not need a new top-level type every time Chronicle learns how to model another property.

It needs the right archetype, the right components, and the right relations.

#### 4.1.5. Relation

```ts
Relation {
  id: string;
  type:
    | "located_in"
    | "part_of"
    | "inside"
    | "on"
    | "carried_by"
    | "worn_by"
    | "owned_by"
    | "resides_in"
    | "connected_to";
  from: string;
  to: string;
  props?: Record<string, unknown>;
}
```

Relations are first-class.

Chronicle should prefer relation growth over bespoke field growth whenever the fact being represented is fundamentally about connection or placement.

#### 4.1.6. ScheduledProcess

```ts
ScheduledProcess {
  id: string;
  entityId?: string;
  processType: string;
  nextEligibleTurn: number;
  cadenceTurns?: number;
  data?: Record<string, unknown>;
}
```

Scheduled processes are how the Spine exposes work to the Pulse.

They are not prose hooks.

They are machine-readable commitments that some deterministic or governed process is eligible to run.

#### 4.1.7. Canonical Invariants

The following rules must always hold.

##### 4.1.7.1. Single Physical Placement

Every physical item must have exactly one primary placement relation:

- inside
- on
- carried_by
- worn_by
- located_in

An item cannot be both `on table` and `inside bag` at the same time.

##### 4.1.7.2. Ownership Is Not Possession

An item may be legally owned by one entity and physically possessed by another.

This distinction is required for theft, lending, gifting, inheritance, storage, recovery, and debt.

##### 4.1.7.3. Nested Resolution

The full place of an object is resolved by traversing upward through relations.

Example:

- sword-1 `on` table-1
- table-1 `located_in` kitchen-1
- kitchen-1 `part_of` house-1
- house-1 `located_in` field-edge-1

The sword is therefore on the table in the kitchen in the house at the field edge.

##### 4.1.7.4. No Presentation-Only Truth

If narration says the sword was left on the table, the Spine must contain a state mutation proving that.

##### 4.1.7.5. Views Are Derived

Player observation, nearby objects, agent packets, UI summaries, and narrative render prompts are always derived views.

They are never canonical truth.

#### 4.1.8. Presets

Chronicle should use presets at three levels.

##### 4.1.8.1. Archetype Presets

Examples:

- `weapon.sword.iron_longsword`
- `item.clothing.leather_glove`
- `surface.table.wooden_house_table`
- `container.bag.canvas_satchel`

These presets define default components and tags.

##### 4.1.8.2. Relation Presets

Examples:

- domestic room nesting
- market stall containment
- actor residence chain

These presets define common structure patterns.

##### 4.1.8.3. Process Presets

Examples:

- indoor stable decay
- salt-air corrosion
- organic spoilage
- cloth weathering

These presets define common deterministic rule bundles.

This is the mechanism that lets Chronicle add detail without rebuilding the whole system.

#### 4.1.9. Materialization Rule

Chronicle should begin worlds mostly coarse.

A district may exist before every house does.

A house may exist before every room does.

A faction may exist before every operative, ledger, dock contact, and warehouse route does.

When attention and governance decide to deepen a region or domain, the Spine materializes more concrete entities and relations.

Those expansions are durable world growth.

They are not temporary staging data.

### 4.2. Pulse (Simulation Kernel + Capability Packs)

The Pulse is the deterministic process layer.

It answers:

- What happens when time advances?
- What changes when weather shifts?
- What happens to unattended items?
- What changes when an actor performs an action?
- What changes off-screen?
- What processes should run now versus later?

The Pulse does not invent.

It updates known state according to explicit rules.

The Pulse has two parts:

1. The Kernel
2. Capability Packs

#### 4.2.1. The Kernel

The Kernel is permanent and universal.

It is the minimal simulation substrate every Chronicle world should share.

The Kernel should own:

- time
- weather
- tides
- travel
- inventories
- ownership
- containment
- economy primitives
- faction standing primitives
- scheduled process execution
- deterministic validation and application of common actions

The Kernel runs whether or not the player is active.

It is the reason the world can continue to exist without player attention.

Chronicle should not attempt to simulate every unattended object every minute.

Instead, Chronicle should use a hybrid approach:

- event-driven mutation for direct actions
- lazy catch-up simulation for unattended processes

##### 4.2.1.1. Lazy Catch-Up

Every entity that can change slowly over time may carry:

- a process class
- a last simulated turn
- environmental context

When relevant time passes, or when the entity becomes relevant again, the Pulse applies catch-up.

This allows:

- glove left in a field for a year
- sword left on a damp table for a season
- food left in a cellar for a month

without needing a full continuous simulation loop.

##### 4.2.1.2. Example: Glove in a Field

State:

- glove is an item
- glove material is leather
- glove placement is `located_in field-edge-1`
- location exposure profile is outdoor_weathering
- glove decay class is outdoor_weathering

One year later, when the area is revisited or time catch-up runs:

- wear increases
- rot increases modestly
- color fades
- chance of displacement is evaluated only if a rule explicitly allows scavenging, flooding, burial, or theft

The glove remains there unless the simulation produced an event that moved, destroyed, or transformed it.

This is how believable permanence is preserved.

#### 4.2.2. Capability Packs

Capability packs are prewritten simulation families that get configured per world.

Examples:

- fishing
- sailing
- farming
- politics
- smuggling
- crime investigation

Capability packs are not generated at runtime.

They are designed in advance, registered against the platform, and activated through governance decisions plus structured data.

This is what makes Chronicle a simulation operating system rather than a single game.

Capability packs should contribute some combination of:

- schemas
- process presets
- scheduled-process types
- deterministic reducers or validators
- query packet builders
- configuration surfaces
- governance hooks
- observability surfaces for narrators and agents

A fishing pack, for example, may eventually define:

- fish stocks
- weather sensitivity
- boat availability
- tides and harbor timings
- market demand links
- role relationships between crews, buyers, and smugglers

A politics pack may define:

- factions
- offices
- loyalties
- debts
- influence flows
- election or succession rules

What is defined now:

- the architectural role of capability packs
- the requirement that they be structured, prewritten, and governed
- the requirement that they plug into the Kernel rather than bypass it

What is not yet defined:

- the formal capability pack interface
- the exact registration contract
- the exact schema each pack must provide
- the exact configuration surface exposed to world builders and governance

The first implementation step is defining what a pack looks like as structured data:

- what schema it follows
- how it registers with the Kernel
- what configuration surface it exposes
- what deterministic hooks it owns
- what query packet surfaces it adds

Until that interface exists, capability packs remain a north-star concept rather than a finished subsystem.

### 4.3. Veil (Query Layer + Knowledge Layer)

The Veil is the bounded access layer over the Spine and Pulse.

It combines two responsibilities:

1. Query
2. Knowledge and perception filtering

The Veil answers:

- What packet should this agent receive?
- What does the player know?
- What does this NPC know?
- What is visible from here?
- What can be inferred versus what is certain?
- What should be omitted because the actor lacks access to it?

The Veil is not the truth.

It is a filtered, actor-relative projection of the truth.

#### 4.3.1. Query Packets

Agents never carry the full world.

They ask for scoped packets.

Examples:

- get house summary
- expand house interior
- list actors in district
- get relation between two NPCs
- list active quest threads
- get contents of container
- get player-visible affordances here
- get active capability-pack pressures in this harbor

Packets must be:

- compressed
- bounded
- query-shaped
- agent-readable
- derivable from structured truth

The platform should prefer explicit query interfaces over ad hoc context stuffing.

This keeps costs bounded.

It also keeps accountability clear.

If an agent says something false, the failure should be traceable to a query or interpretation mistake, not to an invisible prompt-overflow compromise.

#### 4.3.2. Knowledge Separation

Chronicle must separate:

- objective truth
- actor knowledge
- sensory observation
- inferred narrative framing

The player should only receive what can be observed, remembered, inferred, or learned.

The simulation may know:

- the sword is upstairs in a locked chest
- Mira Salt has seen it
- the chest belongs to the householder

The player should not receive that unless the Veil allows it.

This separation is essential for:

- mystery
- discovery
- rumor
- trust
- deception
- believable ignorance

#### 4.3.3. Compression Rule

The Veil should not hand agents raw graph bulk when a narrower packet will do.

The purpose of the Veil is not only secrecy.

It is also compression discipline.

Chronicle should push as much world knowledge as possible through stable packet shapes so agent work becomes predictable, parallelizable, and auditable.

### 4.4. Voice (Runtime Orchestrator + Language Interface)

The Voice is the runtime orchestration and language layer.

It receives player input, runs TurnPlan, dispatches work to the agent hierarchy, validates outcomes against world invariants, writes accepted changes, and hands the narrator a bounded truth summary.

The Voice never becomes the source of state truth.

The Voice answers:

- What did the player likely mean?
- Which system owns this action?
- Which council agents need to be consulted?
- What deterministic operations should run before language work?
- What committed truth should be rendered into prose?
- How should that truth be framed for tone, pacing, and emphasis?

#### 4.4.1. Deterministic Action Model

The LLM should not write arbitrary state patches.

Chronicle should use a deterministic action pipeline:

1. Player input is interpreted into a small structured intent
2. The resolver maps references to concrete entity ids
3. The validator checks whether the action is legal and unambiguous
4. The reducer emits deterministic world events
5. The Pulse applies process catch-up
6. The Veil computes actor-relative views
7. The Voice narrates committed truth

This pipeline remains valid inside the larger governed platform.

The Steward and Council decide what work is needed.

The actual world mutation path still goes through deterministic validation and committed events.

#### 4.4.2. Intent Examples

The LLM should emit intents like:

```json
{ "action": "place_item", "itemRef": "my sword", "targetRef": "the table", "mode": "on" }
```

```json
{ "action": "store_item", "itemRef": "the glove", "targetRef": "the satchel", "mode": "inside" }
```

```json
{ "action": "give_item", "itemRef": "the sealed jar", "targetRef": "Father Kel" }
```

The LLM should not emit direct world writes like:

```json
{ "path": "/items/sword/location", "value": "table-1" }
```

#### 4.4.3. Deterministic Verbs

Chronicle World Spine v1 should support a small set of deterministic verbs first:

- move_actor
- pick_up_item
- place_item_on_surface
- store_item_in_container
- drop_item_at_location
- give_item_to_actor
- equip_item
- unequip_item
- open_container
- close_container
- advance_time

These verbs should cover the majority of early believable-world interactions.

#### 4.4.4. Orchestration Rule

The Voice is allowed to coordinate.

It is not allowed to replace the Spine, Pulse, or Veil with prose-time improvisation.

If a proposed outcome cannot be grounded in structured truth and valid state mutation, it should not be committed merely because it sounds plausible.

## 5. The Three-Tier Agent Hierarchy

Chronicle should move from a flat "GM with tools" model toward a three-tier hierarchy.

This hierarchy is about authority boundaries, context boundaries, and parallelism boundaries.

It is not a claim that every tier must be implemented as an LLM.

### 5.1. Tier 1 — The Steward

The Steward is the top of the hierarchy.

It is the only agent with cross-session awareness.

It has two jobs per turn:

1. open the turn
2. close the turn

When opening the turn, the Steward:

- reads `DirectorState`
- classifies the incoming action
- decides whether deterministic system ownership exists
- decomposes the turn into parallel tasks
- dispatches those tasks to the appropriate council agents

When closing the turn, the Steward:

- receives compressed council returns
- synthesizes the proposed outcome
- decides what should be committed, surfaced, deferred, or held
- updates `DirectorState`
- passes a bounded truth summary down for narration

The Steward never touches raw world data directly.

The Steward never writes narration.

The Steward routes, decomposes, and synthesizes.

The Steward is where Chronicle's world-level judgment should live:

- what matters now
- what should escalate
- what should stay latent
- what systems should deepen next

### 5.2. Tier 2 — The Council

The Council consists of domain specialists with bounded deep context.

They receive tasks from the Steward, spin up workers, synthesize packets, and report compressed decision-ready summaries upward.

They do not report raw world bulk.

They report domain conclusions.

The initial council should include:

#### 5.2.1. World Designer

Owns:

- canonical geography
- locations
- factions
- history
- coarse world structure
- lazy expansion
- map consistency

The World Designer decides how new world detail should be materialized without breaking spatial or historical coherence.

#### 5.2.2. Character Designer

Owns:

- NPC personas
- relationships
- private intentions
- dialogue posture
- moods
- social dynamics

The Character Designer should be able to produce, per NPC per scene:

- a public utterance
- a private intent

The public utterance is what can surface through narration or direct speech.

The private intent is what governance and future reasoning can retain without leaking it to the player.

#### 5.2.3. Systems Designer

Owns:

- capability packs
- mechanic activation
- simulation rule configuration
- query surfaces for physical-world mechanics
- identification of deterministic ownership candidates

The Systems Designer is where Chronicle's "simulation operating system" identity becomes concrete.

This role decides what system family should exist, not just what one scene should say.

#### 5.2.4. Registry Rule

The Council is a registry, not a fixed list.

Additional council agents can be added later.

Examples:

- Quest Planner
- Economy Planner
- Settlement Planner
- Faction Planner
- Investigation Planner

No additional council domain should be introduced unless it has a clear authority boundary and a clear packet interface.

#### 5.2.5. Relation to the Current Codebase

The current codebase already contains proto-council pieces:

- scene specialist and world specialist in `src/agents/specialists/`
- mechanics agent in `src/agents/mechanics/`
- NPC agents in `src/agents/npc/`

Those components are currently advisory and are called sequentially by the GM or engine runtime.

The long-term vision promotes them to autonomous domain owners with their own worker patterns and bounded query surfaces.

### 5.3. Tier 3 — Workers

Workers are stateless, disposable, and parallelizable.

They receive a scoped query and return a structured packet.

They have:

- no identity
- no memory
- no continuity

They can be parallelized freely, retried without side effects, and swapped without touching the tier above.

Council agents own their workers entirely.

The Steward never sees what workers ran.

This is important.

The Steward should reason at the level of domain conclusions, not implementation plumbing.

Many workers will not be LLM agents.

Many workers will be:

- database queries
- view builders
- reducers
- validators
- schedulers
- deterministic packet assemblers

The worker tier exists as a conceptual boundary, not a requirement that every worker be an LLM invocation.

## 6. DirectorState

`DirectorState` is a small persistent structured object that survives between turns and across sessions.

It is the mechanism of forward pressure.

It is held by the Steward.

The Spine holds world truth.

`DirectorState` holds world pressure, prioritization, and deferred surfacing state.

The object should stay small.

If it becomes a second world database, the design has failed.

### 6.1. Required Contents

`DirectorState` should contain:

- **Active threads**: named story pressures currently in play, each with a pressure level
- **Held beats**: things the world knows but is deliberately not surfacing yet
- **Player behavior patterns**: aggregate signal about what the player keeps engaging with
- **Pending world events**: things that will happen at future turns regardless of player action
- **Capability candidates**: systems that may be worth deepening based on observed play

### 6.2. Provisional Shape

The exact interface is not yet locked.

The shape should be approximately like this:

```ts
DirectorState {
  activeThreads: Array<{
    id: string;
    name: string;
    pressure: number;
    domain?: string;
    status?: "rising" | "stable" | "cooling";
  }>;
  heldBeats: Array<{
    id: string;
    note: string;
    releaseConditions?: string[];
  }>;
  playerBehaviorPatterns: {
    favoredDomains?: string[];
    favoredActions?: string[];
    revisitSignals?: Record<string, number>;
    relationshipSignals?: Record<string, number>;
    systemCuriosity?: Record<string, number>;
  };
  pendingWorldEvents: Array<{
    id: string;
    summary: string;
    dueTurn?: number;
    pressure?: number;
    domain?: string;
  }>;
  capabilityCandidates: Array<{
    packId: string;
    score: number;
    reason: string;
  }>;
}
```

This shape is illustrative.

It is not yet a final runtime contract.

The north-star requirement is smaller than that:

- it must persist
- it must survive sessions
- it must provide forward pressure
- it must inform turn opening and closing

### 6.3. Relation to Current Runtime

The current `WorldAgendas` interface in `src/sim/state.ts` is a proto-DirectorState.

`SceneAgenda` and `WorldAgenda` already carry pressure-like information:

- scene focus
- pressures
- unresolved beats
- active threads
- introduction opportunities
- escalation hooks

`DirectorState` should subsume and extend those structures rather than discarding the underlying idea.

## 7. Turn Execution Flow

Chronicle's long-term turn loop should be:

1. Player input arrives
2. Steward reads `DirectorState`
3. Steward runs `TurnPlan`
4. If deterministic owner exists, system handles directly
5. If not, Steward dispatches parallel tasks to the Council
6. Council fans out to workers, gathers packets, compresses and returns
7. Steward synthesizes proposed events
8. Orchestrator validates against world invariants
9. Accepted events write to the world database
10. Steward updates `DirectorState`
11. Narrator renders prose from a bounded truth summary

### 7.1. Step Detail

#### 7.1.1. Player Input Arrives

The runtime receives raw player input.

No world write happens yet.

No narration happens yet.

#### 7.1.2. Steward Reads DirectorState

Before reasoning about the specific input, the Steward reads the current pressure state.

This is what gives Chronicle continuity of intention.

The turn should begin with existing momentum, not with a blank interpretive pass.

#### 7.1.3. Steward Runs TurnPlan

`TurnPlan` is the seam that decides:

- what kind of action this is
- whether the action has a deterministic owner
- which council agents are relevant
- which packets need to be queried
- whether any held beats or pending events should influence the turn

`TurnPlan` is not narration.

It is routing.

#### 7.1.4. Deterministic Ownership Check

If a deterministic system already owns the action, that system should handle it directly.

Examples:

- local movement
- inspect
- wait
- simple inventory transfer
- straightforward travel confirmation

Chronicle should not pay coordination overhead for cases that are already mechanically owned.

#### 7.1.5. Council Dispatch

If deterministic ownership does not fully cover the action, the Steward dispatches parallel tasks to the relevant council agents.

This is where Chronicle stops acting like a single large GM prompt.

#### 7.1.6. Council Fan-Out

Council agents may query workers, call deterministic packet builders, or invoke domain reasoning as needed.

They return compressed summaries upward.

They do not stream raw world state back to the Steward.

#### 7.1.7. Steward Synthesis

The Steward combines council summaries, deterministic outputs, and current pressure state into a proposed turn outcome.

The synthesis should resolve:

- what happened
- what changed
- what remains latent
- what new pressures were created

#### 7.1.8. Validation

The orchestrator validates the proposed events against world invariants.

If a proposal violates the Spine, it fails regardless of narrative appeal.

#### 7.1.9. Commit

Accepted events write to the world database.

This is the only moment when proposed change becomes canonical truth.

#### 7.1.10. DirectorState Update

After commit, the Steward updates `DirectorState`.

This is where Chronicle records:

- thread escalation or cooling
- newly held beats
- player preference signals
- scheduled future pressures
- capability-pack candidate scores

#### 7.1.11. Narration

Only after commit does the narrator render prose from a bounded truth summary.

The narrator should speak about what is now true.

The narrator should not decide what became true.

### 7.2. Relation to the Current `TurnEngine`

The current `TurnEngine.runTurn()` flow is roughly:

- load session
- resolve pending prompts
- build context
- run the GM agent
- let the GM call tools sequentially
- validate events
- write state
- narrate result

That flow is a workable transitional architecture.

The missing seam is `TurnPlan`.

`TurnPlan` should be inserted before the current GM loop so the runtime can decide:

- whether the GM is even needed
- whether deterministic handling should preempt it
- whether council work should be parallel rather than sequential

## 8. Adaptive World Thickening

Chronicle should not deepen every domain equally.

It should deepen where the player lives.

The Steward watches player behavior patterns in `DirectorState`.

If the player repeatedly engages with a domain, the Steward can propose activating or deepening the relevant capability pack.

The Council deliberates.

If approved, the orchestrator activates the pack or expands its configuration.

The world becomes denser where the player actually spends time.

Examples:

- repeated harbor, tide, boat, and trade interactions may justify activating deeper sailing or smuggling systems
- repeated household, inheritance, and ownership friction may justify deeper domestic economy or law systems
- repeated interpersonal probing may justify deeper social reputation and rumor propagation

Adaptive thickening should obey two rules:

1. Deepening must write into the Spine and Pulse, not only into prompt prose.
2. Deepening must remain reversible only in activation scope, not in already-materialized world truth.

If Chronicle creates a real fish market economy because the player keeps living in that system, the world has genuinely become richer.

That is not cosmetic difficulty scaling.

That is world growth.

## 9. Off-Session World Advancement

At the premium end, the Steward can run between sessions.

Factions act.

Rumors spread.

NPCs move.

Market prices shift.

Infrastructure changes.

The player returns to a world that continued without them.

This is an important part of the long-term vision.

It is also the last thing that should be built.

Off-session advancement depends on deep deterministic systems in the Kernel to be cost-effective.

LLM-driven off-session advancement is expensive.

Deterministic advancement is cheap.

Chronicle should therefore build between-session advancement in this order:

1. deterministic weather and time progression
2. deterministic economy and territory pressure
3. deterministic movement and scheduled event resolution
4. selective governed narrative advancement

The principle is:

cheap state movement first, expensive interpretive enrichment second.

## 10. Relation to Current Codebase

Chronicle already contains meaningful pieces of this architecture.

The important question is not whether the north star exists today.

It does not.

The important question is whether the right seams and substrates already exist.

They do.

- `src/sim/spine.ts`
  The entity-relation graph is already implemented. It defines spine entities, relations, schedules, placement rules, index building, graph sync, and sanctioned placement mutation.
- `src/sim/reducer.ts`
  The deterministic event reducer already exists and handles roughly 12 event types today, including movement, travel, item transfer, time advancement, inspection, exploration, and entity creation.
- `src/sim/systems/`
  The kernel already has deterministic systems for time, tide, weather, travel, and movement constraints.
- `src/sim/invariants.ts`
  World invariant checking already exists and validates actor positions, spine integrity, inventory-placement consistency, and lifecycle-related item rules.
- `src/agents/gm/`
  Chronicle currently has a flat GM agent with a tool-calling loop. This is the transitional monolith that currently interprets input, consults helpers, and proposes events.
- `src/agents/specialists/`
  Chronicle already has proto-council specialists for `scene` and `world`. They are advisory today.
- `src/agents/mechanics/`
  Chronicle already has a transitional mechanics agent and deterministic resolver for simple action ownership. This is the clearest existing precursor to `TurnPlan` plus deterministic preemption.
- `src/agents/npc/`
  Chronicle already has NPC dialogue agents. They are early precursors to a future Character Designer domain with public utterance plus private intent boundaries.
- `src/agents/narrator/`
  Chronicle already has a narration agent. This is the correct location for prose rendering once bounded truth summaries become stricter.
- `src/engine/turnEngine.ts`
  Chronicle already has an orchestrator that loads state, runs the current turn loop, validates outcomes, writes accepted events, and invokes narration.
- `src/sim/state.ts`
  Chronicle already has `SceneAgenda`, `WorldAgenda`, and `WorldAgendas`. Those structures are the current proto-form of `DirectorState`.

The core migration principle remains:

- preserve current session persistence
- preserve deterministic turn execution
- extend the world truth model
- insert better orchestration seams before attempting a rewrite

The first implementation does not need a dedicated external graph database.

The graph should live inside the current snapshot model until scale and tooling needs justify externalization.

## 11. Build Order

Chronicle should be built toward this north star in phases.

The sequence matters.

The order should maximize leverage and preserve working software while the architecture evolves.

### Phase 1 — Create the Seams

1. Extract a `TurnPlan` step before the GM runs.
   `TurnPlan` should classify action type, identify needed agents, and check for deterministic ownership.
2. Introduce a persistent `DirectorState` object that survives between turns.
   This should subsume the existing `WorldAgendas` concept rather than duplicate it.
3. Have the GM read `DirectorState` at turn start to bias its decisions.
   This is the cheapest early form of forward pressure.

### Phase 2 — Introduce the Hierarchy

4. Extract the Steward as a separate agent that decomposes and synthesizes.
   Today the GM does both jobs.
5. Promote existing specialists and NPC agents to council-level domain owners.
   They should stop being only ad hoc consultations and start owning stable packet interfaces.
6. Formalize the worker pattern.
   Workers should receive scoped queries and return structured packets.

### Phase 3 — Deepen the Simulation

7. Define the capability pack interface.
   Specify the schema, registration model, deterministic hooks, and configuration surface.
8. Implement a first capability pack.
   Fishing is a good candidate because it touches time, weather, inventory, travel, and economy without requiring full civilization simulation.
9. Add deterministic pressure generators to the Kernel.
   Good early candidates are faction territory pressure, supply chains, and infrastructure damage.

### Phase 4 — Adaptive Systems

10. Add player behavior tracking inside `DirectorState`.
11. Add adaptive capability pack activation based on observed play.
12. Add a lazy world expansion framework for coarse-to-detail materialization.

### Phase 5 — Off-Session Advancement

13. Add deterministic between-session simulation for weather, economy, and faction movement.
14. Add selective LLM-driven between-session narrative advancement for premium worlds.

## 12. The Final Rule

Chronicle should never ask the LLM to remember the world.

Chronicle should ask the LLM to speak about a world the simulation already remembers.
