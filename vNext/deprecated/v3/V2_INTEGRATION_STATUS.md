## Chronicle v2 → v3 Capability Map

| Capability | Status in v3 | Status in v2 scrapyard | Notes / Follow‑ups |
|------------|--------------|------------------------|--------------------|
| PKG & telemetry | ✅ Rich PKG v2 + unified telemetry (`state/pkg.ts`, `state/telemetry.ts`) | ➖ Basic GameState + ad-hoc builder | v3 is source of truth; use it as feed for new UI/context filters. |
| Continuity UI | ⚠️ Minimal JSON dump (`ui/components/WorldState.tsx`) | ✅ Collapsible continuity panel (`OLD … /components/WorldStateDisplay.tsx`) | Port scrapyard UX to surface PKG + telemetry data cleanly. |
| Weather system | ❌ Not implemented (time & tide only) | ✅ Deterministic reducer + climate/pressure hooks | Extract reducer into `state/weather.ts`, expose via telemetry + UI. |
| Client patch reducer | ⚠️ Manual state assignment inside `ui/App.tsx` | ✅ `mergeChangesWithState` reducer applies AI patches deterministically | Mirror arbiter logic client-side so UI only consumes reducer output. |
| Context filtering | ❌ Planned only | ✅ Detailed plan (`CONTEXT_FILTERING.md`) + file scaffolding list | Build telemetry-aware filter pipeline for GM/Narrator prompts. |
| Turn constraints | ⚠️ Turn contract validated but no dynamic constraints | ✅ Architecture doc for constraint calculation/validation | Add constraint builder + validator using tide/time/terrain data. |
| Meta-GM hooks | ⚠️ Not documented in v3 | ✅ Future plan for dynamic specialist agents | Document interface stubs for later without changing runtime. |

### Alignment Notes

1. **Keep v3 deterministic rails as primary source.** Scrapyard ideas (weather, UI, filters, constraints) should *consume* telemetry/PKG rather than re-create their own state.
2. **Scrapyard UX is battle-tested.** Copy the presentation patterns (continuity panel, streaming chat) but feed them v3 data structures.
3. **Document incremental progress.** Each ported capability should be captured in `IMPLEMENTATION_SUMMARY.md` once finished so future agents know what changed.
4. **Meta-GM remains future work.** Only add documentation hooks now; no dynamic codegen until deterministic systems + constraints are stable.

