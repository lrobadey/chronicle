# Chronicle World Spine

North Star specification for evolving Chronicle from a position-based narrative runtime into a believable text-based world simulator.

Status: North Star
Audience: humans, agents, maintainers
Scope: backend world state and simulation architecture

## 1. Purpose

Chronicle is not aiming to become "AI that improvises scenes."

Chronicle is aiming to become a world simulator with language on top.

The backend must represent a world that continues to exist whether or not the player is looking at it. The player is an actor inside that world, not the center of a content generator. The LLM is not the keeper of truth. The simulation is the keeper of truth.

This document defines the system Chronicle is trying to become.

## 2. System Thesis

Chronicle should be designed as a stack of nested systems:

1. Ground truth world structure
2. Deterministic processes acting on that structure
3. Knowledge and perception layers over that truth
4. Language layers that interpret and render the world

This is the core separation:

- The **what** is the experienced world: prose, interface, sensory description, choices, mood, emphasis, dramatic framing.
- The **how** is the simulation substrate: entities, relations, material state, process rules, causality, time, and persistence.

Chronicle should intentionally separate these concerns. Presentation should be allowed to vary without changing the underlying truth. Simulation should be allowed to deepen without rewriting the presentation model.

## 3. Design Goals

Chronicle World Spine must support:

- Persistent object permanence
- Nested spatial and logical containment
- Ownership separated from possession
- Extensible detail without systemic rewrites
- Deterministic mutation of world state
- Believable long-term change through scheduled and lazy processes
- Strict separation of objective truth from subjective knowledge
- LLM participation without LLM authority over ground truth

Chronicle World Spine must avoid:

- Freeform LLM-written state patches as the main mutation path
- Requiring new hardcoded logic for every added item property
- Presentation-driven truth
- Global rewrites every time a new gameplay detail is introduced
- Needing a full video-game simulation loop for every unattended object

## 4. Core System Layers

Chronicle should be built as four named layers.

### 4.1. Spine

The Spine is the ground-truth world model.

It answers:

- What exists?
- What is it?
- Where is it?
- What is it connected to?
- What properties does it have?
- What changed last?

The Spine stores entities, relations, indexes, and scheduled processes.

### 4.2. Pulse

The Pulse is the deterministic process layer.

It answers:

- What happens when time advances?
- What changes when weather shifts?
- What happens to unattended items?
- What changes when an actor performs an action?
- What processes should be applied now versus later?

The Pulse does not invent. It updates known state according to explicit rules.

### 4.3. Veil

The Veil is the knowledge, belief, and perception layer.

It answers:

- What does the player know?
- What does this NPC know?
- What is visible from here?
- What can be inferred versus what is certain?
- What should be omitted from narration because the actor lacks access to it?

The Veil is not the truth. It is a filtered, actor-relative projection of the truth.

### 4.4. Voice

The Voice is the language interface.

It answers:

- What did the player likely mean?
- How should the current truth be narrated?
- How should the current truth be framed for mood, pacing, and tone?

The Voice never becomes the source of state truth.

## 5. Levels of Abstraction

Chronicle should intentionally use a small number of abstraction levels.

### Level A. Entity Archetypes

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

These are not bespoke features. They are reusable categories.

### Level B. Components

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

### Level C. Relations

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

### Level D. Processes

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

### Level E. Views

Views are actor-relative projections for UI, narration, and reasoning.

Examples:

- player local observation
- nearby affordances
- player knowledge summary
- NPC perspective summary

Views should be derived from the Spine plus Veil. They are not canonical data.

## 6. Extensibility Principle

Chronicle must be designed so that adding more detail is mostly a data exercise.

That means:

- new details are usually tags, component fields, archetype presets, or relation presets
- new gameplay categories are usually new process presets
- new UI or narrative framing should reuse existing views and truth

This is the governing rule:

**Adding a new property should rarely require inventing a new simulation architecture.**

Examples:

- Adding sword length should be a `physical.lengthCm` field.
- Adding iron rusting should be `material.primary = iron` and `material.rustable = true`.
- Adding house ownership should be an `owned_by` relation.
- Adding "table in house in district in city" should be more nested `part_of` and `located_in` relations.

The system must prefer presets over bespoke behavior.

## 7. Canonical Data Model

Chronicle World Spine v1 should extend the current `WorldState` with a dedicated `spine` object rather than replacing the entire runtime at once.

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

### 7.1. Entity

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

### 7.2. Relation

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

### 7.3. ScheduledProcess

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

## 8. Canonical Invariants

The following rules must always hold.

### 8.1. Single Physical Placement

Every physical item must have exactly one primary placement relation:

- inside
- on
- carried_by
- worn_by
- located_in

An item cannot be both `on table` and `inside bag` at the same time.

### 8.2. Ownership Is Not Possession

An item may be legally owned by one entity and physically possessed by another.

This distinction is required for theft, lending, gifting, inheritance, storage, and recovery.

### 8.3. Nested Resolution

The full place of an object is resolved by traversing upward through relations.

Example:

- sword-1 `on` table-1
- table-1 `located_in` kitchen-1
- kitchen-1 `part_of` house-1
- house-1 `located_in` field-edge-1

The sword is therefore on the table in the kitchen in the house at the field edge.

### 8.4. No Presentation-Only Truth

If narration says the sword was left on the table, the Spine must contain a state mutation proving that.

### 8.5. Views Are Derived

Player observation, nearby objects, and narrative summaries are always derived views. They are never canonical truth.

## 9. Deterministic Action Model

The LLM should not write arbitrary state patches.

Chronicle should use a deterministic action pipeline:

1. Player input is interpreted into a small structured intent
2. The resolver maps references to concrete entity ids
3. The validator checks whether the action is legal and unambiguous
4. The reducer emits deterministic world events
5. The Pulse applies process catch-up
6. The Veil computes actor-relative views
7. The Voice narrates committed truth

### 9.1. Intent Examples

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

### 9.2. Deterministic Verbs

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

## 10. Pulse: Time and Change

Chronicle should not attempt to simulate every unattended object every minute.

Instead, Chronicle should use a hybrid approach:

- event-driven mutation for direct actions
- lazy catch-up simulation for unattended processes

### 10.1. Lazy Catch-Up

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

### 10.2. Example: Glove in a Field

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

## 11. Presets

Chronicle should use presets at three levels:

### 11.1. Archetype Presets

Examples:

- `weapon.sword.iron_longsword`
- `item.clothing.leather_glove`
- `surface.table.wooden_house_table`
- `container.bag.canvas_satchel`

These presets define default components and tags.

### 11.2. Relation Presets

Examples:

- domestic room nesting
- market stall containment
- actor residence chain

These presets define common structure patterns.

### 11.3. Process Presets

Examples:

- indoor stable decay
- salt-air corrosion
- organic spoilage
- cloth weathering

These presets define common deterministic rule bundles.

This is the mechanism that lets Chronicle add detail without rebuilding the whole system.

## 12. Knowledge and Believability

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

This separation is essential for mystery, discovery, rumor, trust, and believable ignorance.

## 13. Relation to Current Runtime

Current Chronicle already has strong foundations:

- deterministic state object
- deterministic reducers
- append-only event history
- replayable sessions

Chronicle World Spine v1 should build on that instead of replacing it wholesale.

Migration principle:

- preserve current session persistence
- preserve deterministic turn execution
- extend world truth model
- move item permanence and nested placement into Spine first

The first implementation does not need a dedicated external graph database.

The graph should live inside the current snapshot model until scale and tooling needs justify externalization.

## 14. Implementation North Star

Agents working on Chronicle should understand the build direction as follows:

Chronicle is becoming a nested world simulator where the objective world is a graph-backed deterministic substrate, processes mutate that substrate according to explicit rules, knowledge is projected from truth rather than invented, and language is layered on top as an interpreter and renderer rather than a source of state authority.

The first believable milestone is not full social simulation.

The first believable milestone is:

- stable object identity
- stable nested placement
- stable ownership and possession
- stable material and condition tracking
- deterministic local actions
- believable lazy world change over time

If Chronicle can reliably answer:

- where is the sword really?
- who owns it?
- who currently possesses it?
- what is it sitting on?
- what house is that inside?
- what is its material?
- how worn is it?
- how did it get there?

then Chronicle has crossed from "stateful narrative toy" into "world simulator foundation."

## 15. Build Order

Chronicle World Spine v1 should be built in this order:

1. Add `spine.entities`, `spine.relations`, and indexes to `WorldState`
2. Mirror current actors, items, and locations into Spine entities
3. Introduce canonical placement relations and enforce single-placement invariants
4. Replace pickup and drop with generalized placement reducers
5. Add ownership, material, and condition components for items
6. Add deterministic resolver and validator for local object actions
7. Add lazy decay and weathering catch-up for unattended items
8. Build actor-relative observation and affordance views from the Spine
9. Restrict LLM output to intents plus narration

## 16. Final Rule

Chronicle should never ask the LLM to remember the world.

Chronicle should ask the LLM to speak about a world the simulation already remembers.
