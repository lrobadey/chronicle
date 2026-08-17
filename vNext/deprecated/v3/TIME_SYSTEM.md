# Time System Documentation

## Overview

Chronicle now includes a deterministic time system where elapsed game time drives environmental systems like tide, weather, and economy. Time advances through GM patches, making it explicit, flexible, and observable.

## Architecture

### World State
```typescript
systems: {
  time: {
    elapsedMinutes: number;      // Source of truth: cumulative minutes since game start
    startHour?: number;           // Starting hour of day (0-23), e.g., 14 = 2 PM
  }
}
```

### Tide System (Calculated from Time)
```typescript
systems: {
  tide: {
    phase: 'low' | 'rising' | 'high' | 'falling';
    cycleMinutes: number;         // Full cycle duration (default: 720 = 12 hours)
  }
}
```

The tide phase is **calculated on-the-fly** from `elapsedMinutes` using a sinusoidal function, not stored as independent state.

## How Time Advances

The GM updates time after every player action using `apply_patches`:

```typescript
{
  op: 'set',
  path: '/systems/time/elapsedMinutes',
  value: currentTime + actionDuration,
  note: 'Time passes: 5 minutes'
}
```

### Action Duration Guidelines (from GM Prompt)
- **Looking/examining**: 1-2 minutes
- **Short conversations**: 5-10 minutes  
- **Short movement** (<100m): 3-10 minutes
- **Long movement**: Use ETA from `move_to_position` result (convert seconds to minutes)
- **Extended activities** (resting, long talks): 30+ minutes

### Movement Integration
The `move_to_position` tool calculates ETA based on distance and speed:
```typescript
ETA (seconds) = distance (meters) / speed (m/s)
```

The GM reads this ETA and advances time accordingly.

## Tide Calculation

Implemented in `v3/state/systems.ts`:

```typescript
export function calculateTideState(
  elapsedMinutes: number,
  cycleMinutes: number = 720
): TideState
```

**Properties:**
- **Sinusoidal**: `level = 0.5 + 0.5 * sin(2π * t / cycleMinutes)`
- **Range**: 0.0 (low) to 1.0 (high)
- **Phases**:
  - `low`: level < 25%
  - `rising`: level 25-75%, derivative > 0
  - `high`: level > 75%
  - `falling`: level 25-75%, derivative < 0

**Returns:**
```typescript
{
  phase: 'low' | 'rising' | 'high' | 'falling',
  level: number,              // 0.0 to 1.0
  minutesUntilChange: number  // Time until next phase
}
```

## Location Accessibility

Locations can specify tide-dependent access:

```typescript
{
  id: 'the-maw',
  tideAccess: 'low'  // Only accessible at low tide
}
```

**Values:**
- `'always'` (default): Always accessible
- `'low'`: Only accessible when tide phase is 'low'
- `'high'`: Only accessible when tide phase is 'high'

## Display

### CLI State Summary
Shows:
```
- Time: 2:13 PM (13 min)
- Tide: rising (56%)
```

### Full State Summary
```
Time: 2:13 PM, Day 1 (13 min elapsed)
Tide: rising (level: 56%, changes in 167 min)
```

## Example: Isle of Marrow Timeline

**Game Start: 2:00 PM**
- Tide: Rising at 50%
- The Maw: Flooded

**11:00 PM (540 min elapsed)**
- Tide: Low at 0%
- The Maw: **ACCESSIBLE** ✓

**2:00 AM (720 min elapsed)**
- Tide: Rising at 50%
- The Maw: Flooded

## Future Extensions

Potential additions (not yet implemented):
- **Weather system**: Calculate from time + randomness
- **NPC schedules**: NPCs move based on time of day
- **Economy fluctuations**: Market prices shift with time
- **Day/night descriptions**: Narrator adjusts based on hour
- **Fatigue system**: Player needs rest after X hours

## Testing

Run time system tests:
```bash
npm run v3:cli
```

The CLI will show time advancing after each action when the GM is connected to an API key.

## Implementation Files

- `v3/state/world.ts` - World state interface and initialization
- `v3/state/systems.ts` - Tide calculation and time formatting
- `v3/agents/prompts.ts` - GM instructions for time management
- `v3/cli.ts` - Display formatting and integration

