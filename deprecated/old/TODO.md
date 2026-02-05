# V2 Development TODO

## ✅ COMPLETED TASKS

### Pagus Clanis MVP Integration
- [x] **Define Pagus Clanis GTWG entities and relations module** - Created `v2/data/PagusClanis.ts` with 6 regions, 3 characters, and 13 relations
- [x] **Implement createPagusClanisGTWG factory returning immutable GTWG** - Factory function creates complete dataset
- [x] **Add minimal query adapter for query_gtwg** - Supports entity, by_type, relations_of, connected, by_property queries
- [x] **Create demo script to validate dataset and queries** - `v2/demos/pagus-demo.ts` with runtime wiring
- [x] **Add adapter unit test (no network) for query_gtwg** - `v2/__tests__/PagusClanisAdapter.test.ts` validates core functionality
- [x] **Add agent demo wiring (network) and sanity run** - End-to-end agent execution with tool calls

### Time Advancement System
- [x] **Create advance_time tool** - Allows AI to advance world time without travel calculations
- [x] **Integrate with existing patch system** - Uses same patch architecture as travel system
- [x] **Add comprehensive validation** - Prevents invalid time advances (negative, >24 hours)
- [x] **Create demo script** - `v2/demos/time-advancement-demo.ts` for testing
- [x] **Add unit tests** - `v2/__tests__/TimeAdvancementTool.test.ts` validates functionality
- [x] **Update agent prompts** - Clear instructions for using time advancement tool

### What the Demo Shows
✅ **Agent correctly follows rules**: Only queries PKG, doesn't reveal GTWG secrets  
✅ **Tool calls work**: Agent successfully calls `query_pkg` and `query_gtwg`  
✅ **Data is available**: Adapter sanity checks show all Pagus Clanis data exists  
✅ **Architecture works**: End-to-end runtime wiring functions  
✅ **Agent reasoning**: Properly reasons about PKG vs GTWG separation  
✅ **Time advancement works**: AI can advance time for waiting, searching, conversations  

**Demo Output**: Agent receives "What locations are in Pagus Clanis?", queries PKG (empty), queries GTWG (gets data), but respects rules and doesn't reveal secrets to player.

**Time Advancement**: Agent can now handle "I wait four hours" by calling `advance_time` tool, generating patches, and applying them to advance world time.

## 🔄 PENDING TASKS

### Documentation
- [ ] **Document data modeling decisions and IDs to avoid collisions** - Create design doc for Pagus Clanis schema
- [ ] **Document time advancement patterns** - Best practices for AI time management

### Next Integration Steps
- [ ] **Add ownership query support** - Enhance adapter to handle ownership queries properly
- [ ] **Implement PKG projection logic** - Make `project_pkg` actually populate player knowledge
- [ ] **Add more complex queries** - Support graph traversal and relationship queries
- [ ] **Integration with other tools** - Wire up `run_system`, `apply_patches` tools
- [ ] **Time-based world effects** - Day/night cycles, seasonal changes, time-triggered events

## 🎯 MVP SUCCESS CRITERIA

The MVP demonstrates:
- ✅ Agent can call `query_gtwg` tool successfully
- ✅ Tool returns actual GTWG data (6 regions, 3 characters, 13 relations)
- ✅ Agent follows PKG/GTWG separation rules correctly
- ✅ End-to-end runtime wiring works
- ✅ Adapter handles free-form queries with keyword matching
- ✅ Unit tests validate core functionality
- ✅ **NEW**: Time advancement system works for non-travel actions
- ✅ **NEW**: AI can advance time using existing patch architecture

**Status**: MVP is working! The agent can successfully call tools and access the Pagus Clanis dataset while respecting architectural constraints. **Time advancement system is now fully functional** for waiting, searching, conversations, and other time-consuming actions.
