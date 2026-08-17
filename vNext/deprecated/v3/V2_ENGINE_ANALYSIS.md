# V2 Engine Analysis: What Can Be Borrowed for V3

## Executive Summary

The v2 engine folder contains several well-architected components that could significantly improve v3's robustness, validation, and system orchestration. This document identifies specific patterns, code, and architectural improvements that can be borrowed.

---

## 1. Arbiter: Enhanced Validation & Conflict Detection

### What v2 Has
**File:** `old/engine/Arbiter.ts`

- **Conflict detection**: Detects when multiple patches modify the same `entity:field` in a single PatchSet
- **Reference validation**: Validates that patches reference existing entities/fields before applying
- **Lifecycle operation support**: Handles `create_entity`, `delete_entity`, `create_relation`, `delete_relation`
- **Metadata mutation support**: Special handling for `__meta__` entity (e.g., worldTime updates)
- **Structured error reporting**: Returns detailed validation errors with patch indices

### What v3 Has
**File:** `v3/state/arbiter.ts`

- Basic patch application (set/merge only)
- No conflict detection
- No reference validation
- No lifecycle operations
- Simple JSON pointer application

### What to Borrow

1. **Conflict Detection Logic** (lines 86-98)
   ```typescript
   function detectConflicts(patches: PatchSet): { ok: boolean; conflicts: string[] }
   ```
   - Prevents multiple patches from modifying the same field
   - Critical for preventing race conditions in multi-patch operations

2. **Reference Validation** (lines 26-84)
   ```typescript
   function validatePatchSetAgainstGTWG(gtwg: GTWG, patches: PatchSet)
   ```
   - Validates entity existence before operations
   - Validates field existence for increment/decrement
   - Validates relation endpoints exist
   - Prevents runtime errors from invalid references

3. **Lifecycle Operation Support**
   - `create_entity` / `delete_entity` validation
   - `create_relation` / `delete_relation` validation
   - Currently v3 tools handle this, but arbiter-level validation would catch errors earlier

4. **Structured Error Response**
   - v2's `CommitResult` includes `rejected: { reason, errors }`
   - v3 could return similar structured errors for better debugging

### Implementation Priority: **HIGH**
- Prevents silent failures
- Catches errors before state corruption
- Essential for multi-patch operations

---

## 2. SystemOrchestrator: Automatic System Execution

### What v2 Has
**File:** `old/engine/SystemOrchestrator.ts`

- **Centralized system execution**: Single entry point (`processAction`) that:
  - Determines which systems should run (via Scheduler)
  - Executes system reducers in order
  - Collects patches from all systems
  - Commits patches via Arbiter
  - Returns unified result
- **System registry integration**: Uses `getAllSystems()` to discover systems
- **Error isolation**: Catches system errors without crashing the orchestrator

### What v3 Has
- Systems are called manually by GM agent
- No automatic system execution
- No system registry
- Systems run ad-hoc based on GM decisions

### What to Borrow

1. **Orchestration Pattern**
   ```typescript
   processAction(action: unknown): { gtwg, ledger, patches }
   ```
   - Single entry point for turn processing
   - Automatic system discovery and execution
   - Unified patch collection

2. **Error Isolation**
   ```typescript
   try {
     const patches = sys.reducer(this.gtwg, action, []);
   } catch (err) {
     console.error(`[Orchestrator] System '${sys.id}' threw error`, err);
   }
   ```
   - Prevents one system failure from crashing the entire turn

3. **System Registry Integration**
   - Automatic discovery of registered systems
   - Dependency ordering (v2 has `dependencies` field in SystemSpec)

### Implementation Priority: **MEDIUM**
- Would enable automatic system execution (weather, economy, etc.)
- Reduces GM agent complexity
- But v3's agent-driven approach is also valid - this is more of an architectural choice

---

## 3. Scheduler: Tick-Based System Execution

### What v2 Has
**File:** `old/engine/Scheduler.ts`

- **Tick context**: Tracks `tick`, `hours`, `days` counters
- **Tick rate system**: Systems declare `tickRate: 'per_action' | 'hourly' | 'daily'`
- **Boundary detection**: Detects when hours/days cross boundaries
- **Automatic system selection**: Returns which systems should run this tick

### What v3 Has
- Manual time advancement via GM patches
- No tick-based system execution
- Systems run on-demand, not automatically

### What to Borrow

1. **Tick Context Management**
   ```typescript
   interface TickContext {
     tick: number;
     hours: number;
     days: number;
   }
   ```
   - Structured tick tracking
   - Derived time calculations

2. **Boundary Detection**
   - `crossedHour`, `crossedDay` flags
   - Enables hourly/daily system execution

3. **Tick Rate System**
   - Systems declare execution frequency
   - Scheduler automatically selects which systems to run

### Implementation Priority: **MEDIUM**
- Useful for automatic system execution
- But v3's manual approach gives GM more control
- Could be hybrid: scheduler suggests systems, GM decides

---

## 4. ChangeSummary: Patch-to-Event Conversion

### What v2 Has
**File:** `old/engine/ChangeSummary.ts`

- **Event extraction**: Converts patches into narratable events:
  - `time_advanced` - time changes with metadata
  - `travel` - player movement between locations
  - `entity_created` / `entity_deleted`
  - `relation_created` / `relation_deleted`
  - `field_changed` - salient field changes (health, status, etc.)
- **Before/after comparison**: Compares GTWG before/after to detect changes
- **Rich metadata**: Includes season, time of day, ETA, proposer info

### What v3 Has
- No change summary system
- Narrator receives raw patches and stateSummary
- No structured event extraction

### What to Borrow

1. **Event Extraction Logic**
   ```typescript
   summarizePatches(gtwgBefore, gtwgAfter, patches, tick): ChangeSummary
   ```
   - Converts patches to structured events
   - Enables richer narration context

2. **Travel Detection**
   - Detects player movement from relation changes
   - Extracts from/to locations
   - Includes travel time metadata

3. **Time Advancement Detection**
   - Detects time patches
   - Calculates minutes advanced
   - Includes season/time of day

4. **Salient Field Tracking**
   - Tracks important field changes (health, status, etc.)
   - Filters noise from minor updates

### Implementation Priority: **HIGH**
- Would significantly improve narrator context
- Enables event-driven narration
- Reduces narrator's need to parse raw patches

---

## 5. SystemSpec: System Registry & Validation

### What v2 Has
**File:** `old/engine/SystemSpec.ts`

- **System registry**: In-memory registry of all systems
- **System validation**: Validates system specs before registration
- **Dependency tracking**: Systems can declare dependencies on other systems
- **Ownership tracking**: Systems declare which fields they "own"
- **Type safety**: Strong typing for `SystemReducer` function signature

### What v3 Has
- No system registry
- Systems are ad-hoc functions
- No formal system definition

### What to Borrow

1. **System Registry Pattern**
   ```typescript
   registerSystem(spec: SystemSpec): { ok: true } | { ok: false; error: string }
   getAllSystems(): SystemSpec[]
   ```
   - Centralized system discovery
   - Enables automatic system execution

2. **System Validation**
   ```typescript
   validateSystemSpec(raw: Partial<SystemSpec>): { ok: boolean; error?: string }
   ```
   - Ensures systems are properly configured
   - Catches errors at registration time

3. **Dependency System**
   - `dependencies?: string[]` field
   - Enables execution ordering
   - Prevents circular dependencies

4. **Ownership Model**
   - `ownership: string[]` field
   - Could enable field-level permissions
   - Prevents systems from modifying fields they don't own

### Implementation Priority: **LOW-MEDIUM**
- Useful for formal system architecture
- But v3's flexibility is also valuable
- Could be optional: systems can register or run ad-hoc

---

## 6. PressurePatch: Enhanced Patch Types & Validation

### What v2 Has
**File:** `old/engine/PressurePatch.ts`

- **Lifecycle operations**: `create_entity`, `delete_entity`, `create_relation`, `delete_relation`
- **Numeric operations**: `increment`, `decrement` (with validation)
- **Patch validation**: `validatePatchSet()` with detailed errors
- **Helper factories**: `set()`, `add()`, `remove()` convenience functions
- **Pressure system**: Normalized system inputs (not used in v3, but interesting pattern)

### What v3 Has
- Only `set` and `merge` operations
- No lifecycle operations (handled by tools)
- No numeric operations
- Basic patch structure

### What to Borrow

1. **Lifecycle Operations**
   - Could add `create_entity`, `delete_entity` to Patch type
   - Currently handled by tools, but patch-level would be more consistent

2. **Numeric Operations**
   ```typescript
   case 'increment':
     const current = (target as any)[field] ?? 0;
     newGTWG = updateEntity(newGTWG, entity, { 
       [field]: current + (typeof value === 'number' ? value : 1) 
     });
   ```
   - Safer than `set` for numeric fields
   - Prevents overwriting with wrong value

3. **Patch Validation**
   ```typescript
   validatePatchSet(patches: PatchSet): { valid: boolean; errors: string[] }
   ```
   - Structural validation before application
   - Catches malformed patches early

4. **Helper Factories**
   - Convenience functions for common operations
   - Reduces boilerplate

### Implementation Priority: **MEDIUM**
- Lifecycle ops are already handled by tools (working fine)
- Numeric operations would be nice-to-have
- Validation is valuable

---

## 7. WorldTime: Enhanced Time Utilities

### What v2 Has
**File:** `old/engine/WorldTime.ts`

- **Season calculation**: `getSeason(iso: string)` - spring/summer/autumn/winter
- **Time of day**: `getTimeOfDay(iso: string)` - dawn/morning/noon/afternoon/dusk/night
- **Boundary detection**: `crossedBoundary(prevIso, nextIso, unit)` - hour/day boundaries
- **Boundary summary**: `summarizeBoundaryCrossings()` - detects hour/day/month/year crossings
- **Display formatting**: `formatIsoForDisplay(iso: string)` - human-readable time

### What v3 Has
**File:** `v3/state/time.ts`

- Rich time telemetry system
- Calendar calculations
- But missing some of v2's convenience functions

### What to Borrow

1. **Season Calculation**
   ```typescript
   getSeason(iso: string): 'spring' | 'summer' | 'autumn' | 'winter'
   ```
   - Simple, pure function
   - Useful for weather/narrative context

2. **Time of Day**
   ```typescript
   getTimeOfDay(iso: string): 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night'
   ```
   - More granular than v3's current `timeOfDay`
   - Useful for narration

3. **Boundary Detection**
   ```typescript
   crossedBoundary(prevIso: string, nextIso: string, unit: 'hour' | 'day'): boolean
   ```
   - Detects when time crosses boundaries
   - Useful for triggering hourly/daily systems

4. **Boundary Summary**
   ```typescript
   summarizeBoundaryCrossings(prevIso: string, nextIso: string)
   ```
   - Returns all boundary crossings at once
   - More efficient than multiple calls

### Implementation Priority: **LOW**
- v3 already has time utilities
- These are nice-to-have convenience functions
- Easy to port if needed

---

## Recommended Implementation Order

### Phase 1: Critical Validation (High Priority)
1. **Conflict Detection** from Arbiter
2. **Reference Validation** from Arbiter
3. **Change Summary** system for narrator

### Phase 2: Enhanced Operations (Medium Priority)
4. **Numeric Patch Operations** (increment/decrement)
5. **Patch Validation** helpers
6. **Time Utilities** (season, time of day, boundaries)

### Phase 3: Architecture (Low-Medium Priority)
7. **System Registry** (optional, for formal systems)
8. **Scheduler** (optional, for automatic system execution)
9. **SystemOrchestrator** (optional, if adopting automatic systems)

---

## Architectural Considerations

### v3's Strengths to Preserve
- **Agent-driven flexibility**: GM decides what to do, not rigid systems
- **Coordinate-based movement**: More flexible than exit-based
- **Simple patch model**: Easy to understand and debug
- **Tool-based lifecycle**: Tools handle entity/relation creation cleanly

### v2's Strengths to Adopt
- **Validation rigor**: Catch errors early
- **Conflict detection**: Prevent race conditions
- **Event extraction**: Better narrator context
- **System organization**: Registry pattern for discoverability

### Hybrid Approach
- Keep v3's agent-driven model
- Add v2's validation and conflict detection
- Add change summary for narrator
- Make system registry optional (systems can register or run ad-hoc)
- Keep tools for lifecycle operations (don't need patch-level lifecycle)

---

## Code Examples: Quick Wins

### 1. Add Conflict Detection to v3 Arbiter
```typescript
// In v3/state/arbiter.ts
function detectConflicts(patches: Patch[]): { ok: boolean; conflicts: string[] } {
  const seen = new Map<string, Patch>();
  const conflicts: string[] = [];
  patches.forEach((p) => {
    const key = `${p.path}`; // v3 uses path, not entity:field
    if (seen.has(key)) {
      conflicts.push(`Multiple patches modify the same path (${key}) in the same PatchSet.`);
    } else {
      seen.set(key, p);
    }
  });
  return { ok: conflicts.length === 0, conflicts };
}
```

### 2. Add Change Summary for Narrator
```typescript
// New file: v3/state/changeSummary.ts
export function summarizePatches(
  worldBefore: SimpleWorld,
  worldAfter: SimpleWorld,
  patches: Patch[]
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  
  // Detect time advancement
  const timeBefore = worldBefore.systems?.time?.elapsedMinutes ?? 0;
  const timeAfter = worldAfter.systems?.time?.elapsedMinutes ?? 0;
  if (timeAfter > timeBefore) {
    events.push({
      kind: 'time_advanced',
      meta: { minutes: timeAfter - timeBefore }
    });
  }
  
  // Detect travel (player location change)
  if (worldBefore.player.location !== worldAfter.player.location) {
    events.push({
      kind: 'travel',
      fromId: worldBefore.player.location,
      toId: worldAfter.player.location
    });
  }
  
  // ... more event detection
  
  return events;
}
```

### 3. Add Reference Validation
```typescript
// In v3/state/arbiter.ts
function validatePatches(world: SimpleWorld, patches: Patch[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  patches.forEach((p, idx) => {
    // Validate path exists (for set operations on nested fields)
    const pathParts = p.path.split('/').filter(Boolean);
    let current: any = world;
    for (const part of pathParts.slice(0, -1)) {
      if (current[part] === undefined) {
        errors.push(`Patch #${idx} path '${p.path}' references non-existent field '${part}'`);
        return;
      }
      current = current[part];
    }
  });
  
  return { valid: errors.length === 0, errors };
}
```

---

## Conclusion

The v2 engine folder contains several well-designed patterns that would significantly improve v3's robustness and capabilities. The highest-value additions are:

1. **Conflict detection** - Prevents race conditions
2. **Reference validation** - Catches errors early
3. **Change summary** - Better narrator context
4. **Numeric operations** - Safer than set for numbers

The architectural components (SystemOrchestrator, Scheduler, SystemSpec) are valuable but represent a different design philosophy. They could be adopted optionally or in a hybrid approach.

