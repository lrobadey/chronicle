# SystemSpec Explained

## What is SystemSpec?

**SystemSpec** is a registry pattern that lets you define "systems" (pure functions) that automatically run based on game time, without the GM needing to explicitly call them.

Think of it like this:
- **v3 (current)**: GM agent decides everything. "Should I advance time? Should I update weather? Should I process travel?" → GM makes all decisions
- **v2 (SystemSpec)**: Systems register themselves and run automatically. "Every action, run these systems. Every hour, run these systems. Every day, run these systems." → Automatic execution

## How It Works

### 1. Define a System

A system is a pure function that takes world state and returns patches:

```typescript
// Example: Weather system that runs hourly
const weatherSystem: SystemReducer = (gtwg, action, pressures) => {
  const patches: PatchSet = [];
  
  // Check if it's time to update weather
  const worldTime = gtwg.metadata?.worldTime;
  // ... calculate weather based on time ...
  
  patches.push({
    op: 'set',
    entity: 'region-1',
    field: 'weather',
    value: 'rainy',
    proposer: 'weather-system'
  });
  
  return patches;
};
```

### 2. Register the System

```typescript
registerSystem({
  id: 'weather-system',
  reducer: weatherSystem,
  tickRate: 'hourly',  // Runs when hour boundary crosses
  ownership: ['weather', 'temperature'],  // Fields this system "owns"
  dependencies: ['time-system'],  // Run after time-system
  description: 'Updates weather based on time and season',
  version: '1.0.0'
});
```

### 3. Automatic Execution

When a player action happens, the **SystemOrchestrator**:

1. Asks the **Scheduler**: "Which systems should run this tick?"
2. Scheduler checks:
   - `tickRate: 'per_action'` → Always run
   - `tickRate: 'hourly'` → Run if hour boundary crossed
   - `tickRate: 'daily'` → Run if day boundary crossed
3. Runs all due systems in dependency order
4. Collects all patches
5. Commits via Arbiter

```typescript
// In SystemOrchestrator.processAction()
const { ctx, due } = this.scheduler.advance();  // Get systems to run

for (const sys of due) {
  const patches = sys.reducer(this.gtwg, action, []);
  collected = collected.concat(patches);
}

// Commit all patches at once
commitPatchSet(this.gtwg, this.ledger, collected, ...);
```

## Key Concepts

### Tick Rates

```typescript
type TickRate = 'per_action' | 'hourly' | 'daily';
```

- **`per_action`**: Runs every player action (e.g., movement system, inventory system)
- **`hourly`**: Runs when game time crosses an hour boundary (e.g., weather updates, NPC schedules)
- **`daily`**: Runs when game time crosses a day boundary (e.g., economy updates, seasonal changes)

### Ownership

```typescript
ownership: ['weather', 'temperature', 'humidity']
```

Declares which fields this system "owns". This could be used for:
- **Validation**: Prevent other systems from modifying these fields
- **Documentation**: Makes it clear who's responsible for what
- **Future permissions**: Could enable field-level access control

### Dependencies

```typescript
dependencies: ['time-system']
```

Ensures systems run in the correct order. If `weather-system` depends on `time-system`, the orchestrator will:
1. Run `time-system` first
2. Then run `weather-system` (which can now read updated time)

### System Reducer Signature

```typescript
type SystemReducer = (
  gtwg: GTWG,           // Current world state
  action: unknown,       // Player action (if any)
  pressures?: PressureSet // Inputs from other systems (v2 concept)
) => PatchSet;           // Patches to apply
```

Pure function - no side effects, deterministic, testable.

## Example: Complete System

```typescript
// Weather system that updates based on time
function createWeatherSystem(): SystemReducer {
  return (gtwg, action, pressures) => {
    const patches: PatchSet = [];
    const worldTime = (gtwg as any).metadata?.worldTime;
    if (!worldTime) return patches;
    
    const date = new Date(worldTime);
    const hour = date.getHours();
    const month = date.getMonth();
    
    // Simple weather logic
    let weather = 'clear';
    if (month >= 10 || month <= 2) weather = 'snowy';  // Winter
    if (hour >= 18 || hour < 6) weather = 'dark';       // Night
    
    patches.push({
      op: 'set',
      entity: 'world',
      field: 'weather',
      value: weather,
      proposer: 'weather-system'
    });
    
    return patches;
  };
}

// Register it
registerSystem({
  id: 'weather-system',
  reducer: createWeatherSystem(),
  tickRate: 'hourly',
  ownership: ['weather'],
  description: 'Updates weather based on time of day and season'
});
```

Now, every time the game time crosses an hour boundary, the weather system automatically runs and updates the weather - no GM intervention needed!

## How v2 Uses It

### 1. SystemOrchestrator Integration

```typescript
// In SystemOrchestrator.processAction()
const { ctx, due } = this.scheduler.advance();

// due = ['movement-system', 'weather-system', 'economy-system']
// (if hour boundary crossed and they're registered)

for (const sys of due) {
  const patches = sys.reducer(this.gtwg, action, []);
  collected = collected.concat(patches);
}
```

### 2. Agent Tool Integration

The GM agent can also manually run systems via a tool:

```typescript
// Tool: run_system
{
  name: 'run_system',
  description: 'Execute a named system reducer',
  call(input) {
    const spec = getSystem(input.system);  // Look up in registry
    const patches = spec.reducer(gtwg, input.action, []);
    return { patches };
  }
}
```

So the GM can say "run weather-system" if they want, but it also runs automatically.

### 3. Dynamic System Loading

v2 even supports loading systems at runtime:

```typescript
// Load a system from code string (AI-generated?)
const artifact = {
  id: 'custom-economy-system',
  code: `(gtwg, action) => { /* system logic */ }`,
  tickRate: 'daily',
  ownership: ['economy', 'prices']
};

loadSystemArtifact(artifact);  // Registers it
```

This enables the AI to generate new systems dynamically!

## Comparison: v2 vs v3

### v2 Approach (SystemSpec)
- **Automatic**: Systems run based on tick rates
- **Declarative**: "This system runs hourly"
- **Centralized**: All systems in one registry
- **Predictable**: Same systems run every hour/day
- **Less flexible**: GM can't easily skip systems

### v3 Approach (Current)
- **Manual**: GM decides when to update systems
- **Imperative**: "GM, should we update weather now?"
- **Distributed**: Systems are ad-hoc functions
- **Flexible**: GM has full control
- **More work**: GM must remember to update systems

## Should v3 Adopt SystemSpec?

### Pros
1. **Automatic system execution** - Weather, economy, etc. update without GM thinking about it
2. **Consistency** - Systems always run at the right time
3. **Discoverability** - Registry shows what systems exist
4. **Testability** - Pure functions are easy to test
5. **Future: AI-generated systems** - Could enable dynamic system creation

### Cons
1. **Less GM control** - Can't easily skip or modify system behavior
2. **Architectural shift** - Different philosophy from current agent-driven approach
3. **Complexity** - Adds scheduler, registry, dependency resolution
4. **Rigidity** - Systems must fit the tick rate model

### Hybrid Approach

v3 could adopt SystemSpec **optionally**:

```typescript
// Systems can register for automatic execution
registerSystem({
  id: 'weather-system',
  reducer: weatherReducer,
  tickRate: 'hourly'
});

// But GM can also call systems manually
const patches = weatherReducer(world, action);

// Or skip automatic execution for this turn
orchestrator.processAction(action, { skipSystems: ['weather-system'] });
```

This gives you:
- Automatic execution when you want it
- Manual control when you need it
- Best of both worlds

## Implementation for v3

If you wanted to add SystemSpec to v3, you'd need:

1. **SystemSpec registry** (port from v2)
2. **Scheduler** (port from v2, but adapt to v3's time system)
3. **SystemOrchestrator** (optional - could integrate into existing turn flow)
4. **System registration** (at startup or dynamically)

The key question: **Do you want automatic system execution, or do you prefer GM-driven control?**

If you want automatic execution for things like weather/economy, SystemSpec is perfect. If you want the GM to have full control, the current approach is better.

