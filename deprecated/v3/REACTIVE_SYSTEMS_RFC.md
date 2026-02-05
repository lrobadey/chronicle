# Reactive Systems RFC: Synthesizing v2 and v3

## The Vision: "Conscious Mind, Autonomous Body"

To build the best narrative engine, we should synthesize the two approaches into a hybrid architecture:

- **The GM Agent (v3)** is the **"Conscious Mind"**. It handles player intent, improvisation, storytelling, and high-level causality. It decides *if* time passes, but not *exactly* how the tide height changes.
- **The System Orchestrator (v2)** is the **"Autonomous Body"**. It handles digestion, heartbeat, weather cycles, and economic tides. When the mind says "an hour passes," the body automatically updates the hunger, the sun position, and the weather.

## Architecture: The Reactive Loop

Instead of choosing one or the other, we run them in sequence for every turn.

### 1. The Flow
1.  **Player Action**: "I wait for the storm to pass."
2.  **GM Agent (Mind)**:
    *   Interprets intent.
    *   Decides time should pass (e.g., 4 hours).
    *   Emits patch: `time.elapsedMinutes += 240`.
3.  **System Orchestrator (Body)**:
    *   Observes: Time advanced by 240 minutes.
    *   Calculates: This crosses 4 hour boundaries.
    *   Runs: `WeatherSystem`, `TideSystem`, `HungerSystem` for those 4 hours.
    *   Emits patches: `weather: "stormy" -> "clearing"`, `tide: "high" -> "low"`.
4.  **Commit**: All patches (GM + Systems) applied atomically.
5.  **Narrator**: Describes the result, seeing both the time passed AND the weather clearing.

### 2. Advantages
*   **Reduced Hallucination**: The GM doesn't need to guess the tide chart or weather patterns.
*   **Consistency**: Tides and moons follow strict mathematical cycles.
*   **Agency Preserved**: The GM can still manually override systems (e.g., "A magical storm defies the weather forecast") by applying a patch that overwrites the system's patch.

## Implementation Plan

### Step 1: Define SystemSpec for v3
Create `v3/state/systems/framework.ts`:

```typescript
export type TickRate = 'per_action' | 'hourly' | 'daily';

export interface SystemSpec {
  id: string;
  // Systems receive the WORLD state and the DELTA (what changed)
  reducer: (world: SimpleWorld, delta: WorldDelta) => Patch[];
  tickRate: TickRate;
}

// Simple registry
export const SYSTEM_REGISTRY = new Map<string, SystemSpec>();
```

### Step 2: Create the Reactive Scheduler
Create `v3/state/systems/scheduler.ts`:

```typescript
export function computeSystemPatches(
  worldBefore: SimpleWorld,
  patches: Patch[]
): Patch[] {
  const systemPatches: Patch[] = [];
  
  // 1. Detect Time Change
  const timePatch = patches.find(p => p.path === '/systems/time/elapsedMinutes');
  if (!timePatch) return [];

  const prevTime = worldBefore.systems.time.elapsedMinutes;
  const newTime = timePatch.value;
  
  // 2. Determine Boundaries
  const crossedHour = Math.floor(prevTime / 60) < Math.floor(newTime / 60);
  
  // 3. Run Systems
  for (const sys of SYSTEM_REGISTRY.values()) {
    if (sys.tickRate === 'hourly' && crossedHour) {
      systemPatches.push(...sys.reducer(worldBefore, { timeDelta: newTime - prevTime }));
    }
  }
  
  return systemPatches;
}
```

### Step 3: Hook into Server Loop
Modify `v3/server.ts` inside `executeTurn`:

```typescript
// ... after GM runs ...
const gmPatches = gm.result.patches;

// NEW: Run Reactive Systems
const systemPatches = computeSystemPatches(session.world, gmPatches);

// Combine patches (Systems run AFTER GM to update consequences)
const allPatches = [...gmPatches, ...systemPatches];

// Apply everything
const finalWorld = applyPatches(session.world, allPatches);
```

## Proposed Systems to Port First

1.  **TideSystem**: Updates `/systems/tide` based on time.
2.  **WeatherSystem**: Updates `/systems/weather` based on season and random seed.
3.  **TorchSystem**: Decrements torch fuel if a torch is lit.

This synthesis gives us the rigorous simulation of v2 with the infinite flexibility of v3.

