# Chronicle Narrative Pipeline

This document outlines the core narrative/gameplay loop for Chronicle, detailing every step and system involved in processing a player action, building context, and generating the next GM/LLM response.

---

## 1. Player Action
- **Input:** Player sends a message (e.g., "I want to visit Riverton and talk to the mayor.")
- **Storage:** Message is appended to the transcript (the "novel").

## 2. Context Builder: Conversation History
- **Retrieves** the last 10 (or N) messages from the transcript.
- **Purpose:** Provides the LLM with the exact recent conversation, preserving tone, intent, and narrative flow.

## 3. PKG & GTWG: Knowledge and World State
- **PKG:** Player Knowledge Graph (what the player knows: facts, rumors).
- **GTWG:** Ground-Truth World Graph (all entities, locations, relations, bios, etc.).
- **Purpose:** Sources of truth for what exists and what the player knows.

## 4. Systemic Projections (Deterministic, No LLM)
- **Immediate:** Entities/locations the player can currently see/interact with.
- **Quest-Relevant:** Entities/locations/items directly related to active quests.
- **Known:** All entities the player has discovered (from PKG).
- **Purpose:** Calculated using PKG and GTWG, without LLM reasoning.

## 5. Tiny LLM: Dynamic Context Relevance
- **Input:** Player message and PKG (list of known entities, with names, aliases, descriptions).
- **Action:** Extracts referenced entities/locations from the message, mapping them to IDs/names in the PKG.
- **Output:** Structured list of relevant entities and their relations, based on what the player referenced or implied.
- **Purpose:** Adds dynamic, context-aware relevance (e.g., if the player mentions a faraway town, it's surfaced even if not immediate or quest-relevant).

## 6. System Expansion: Relation Traversal
- **Action:** System expands the context by traversing the GTWG for all related entities/locations the player knows (e.g., contained_in, owns, in_quest).
- **Purpose:** Ensures the context includes not just the referenced entity, but all relevant connections.

## 7. Context Object Assembly
- **Sections:**
  - Current Location
  - Active Quests
  - Player Stats & Description
  - World Time
  - World Description
  - Projection (immediate, quest-relevant, relevant)
  - Bios (for all relevant characters/locations)
  - Conversation History (last 10 messages)
- **Purpose:** This structured object is the full "state of the world and story" for the LLM.

## 8. Main LLM: GM Response Generation
- **Input:** Structured context object.
- **System Prompt:** Tells the LLM how to interpret each section, how to reason about what the player knows, and how to maintain narrative and systemic consistency.
- **Action:** LLM generates the next GM message, narrative, and any proposed world/bio updates (in structured format).

## 9. World & Bio Updates
- **Action:** Any changes proposed by the LLM (e.g., new facts, bio updates, relationship changes) are validated and applied to the GTWG, PKG, and CanonLedger.
- **History:** All changes are recorded for audit, rollback, and narrative consistency.

## 10. Loop Continues
- **The new GM message is appended to the transcript.**
- **The player responds, and the loop repeats.**

---

## Notes on LLM Context
- The main LLM receives a filtered, contextually relevant slice of the GTWG (immediate, quest-relevant, relevant, known), not the entire world.
- The LLM is instructed to only reveal what the player knows, unless introducing new content in a narratively appropriate way.
- Bios are included for all relevant entities to ensure consistent personalities and worldbuilding.

---

## Visual Timeline of a Single Turn

1. Player sends message → stored in transcript
2. System retrieves last 10 messages
3. System loads PKG and GTWG
4. System calculates immediate, quest-relevant, known projections
5. Tiny LLM extracts referenced entities from message (using PKG)
6. System expands context with related entities (using GTWG)
7. System assembles structured context object (all labeled sections)
8. Main LLM receives context, generates GM response + updates
9. System applies updates to GTWG/PKG/CanonLedger
10. GM message is stored, loop repeats

---

## FUTURE: Agentic Approach with LangChain

The pipeline above represents the current planned approach. However, we've identified an even more flexible and dynamic approach using **LangChain agents** that would replace this rigid pipeline with an intelligent, tool-calling system.

### **Agentic Architecture Overview**

Instead of a fixed pipeline, a single **LangChain agent** would:

1. **Receive the player message** + conversation history
2. **Reason about what needs to be done** (using the LLM's reasoning capabilities)
3. **Dynamically decide which tools to call** and in what order
4. **Execute tool calls** and receive results
5. **Reason about the results** and decide next steps
6. **Loop/chain more tools** if needed, or provide final response

### **Available Tools for the Agent**

The agent would have access to these tools (functions):

- **`query_gtwg`** - Query the Ground-Truth World Graph for entities, relations, bios
- **`query_pkg`** - Query the Player Knowledge Graph for what the player knows
- **`run_travel_system`** - Execute travel reducer with parameters
- **`run_quest_system`** - Execute quest reducer with parameters
- **`run_weather_system`** - Execute weather reducer with parameters
- **`update_bio`** - Propose bio updates for characters/locations
- **`update_pkg`** - Add new facts or rumors to player knowledge
- **`get_conversation_history`** - Retrieve last N messages
- **`apply_patches`** - Apply PatchSets to GTWG via Arbiter

### **Example Agent Workflow**

```
Player: "I want to travel to Riverton and talk to the mayor"

Agent reasoning:
1. "This involves travel AND social interaction"
2. Calls query_gtwg tool → finds Riverton location and mayor entity
3. Calls query_pkg tool → checks what player knows about mayor
4. Calls run_travel_system tool → calculates movement, updates location
5. Calls run_quest_system tool → checks if this affects any active quests
6. Calls update_bio tool → updates mayor's bio if conversation happens
7. Generates narrative response incorporating all results
```

### **Advantages of Agentic Approach**

- **Dynamic interpretation** - Each message is interpreted fresh, no rigid pipeline
- **Selective tool usage** - Agent decides what it needs based on the situation
- **Flexible chaining** - Can call tools in any order, multiple times
- **Self-correcting** - Can retry or adjust approach based on results
- **Context preservation** - Maintains conversation state across tool calls
- **Maximum modularity** - Adding new systems is just adding new tools

### **Implementation Strategy**

1. **Build tools first** - Create all the individual tool functions
2. **Create agent** - Set up LangChain agent with tool access
3. **Test incrementally** - Start with simple actions, add complexity
4. **Replace pipeline** - Gradually replace the rigid pipeline with agent calls

### **Learning Resources**

- **LangChain docs**: https://langchain.com/docs/use_cases/autonomous_agents/
- **Tool calling**: https://langchain.com/docs/modules/agents/tools/
- **Agent types**: ReAct, conversational, etc.
- **Memory management**: For conversation state
- **Error handling**: For robust tool calling

This agentic approach would provide the ultimate flexibility and intelligence for Chronicle's narrative system, allowing the LLM to truly "think" about what it needs to do and execute the right tools in the right order for each unique situation.

---

This pipeline is the core of Chronicle's narrative and simulation engine. Every system, from world state to player knowledge to narrative generation, is integrated into this loop.
