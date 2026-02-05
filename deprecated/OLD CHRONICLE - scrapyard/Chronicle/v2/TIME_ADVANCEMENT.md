# Time Advancement System - V2 Architecture

**🎯 Purpose**: Allow AI agents to advance world time for non-travel actions using the existing patch system architecture.

---

## **How It Works**

### **1. Two Time Advancement Methods**

**Travel-Based Time Advancement** (Existing):
```
Player Travel → Calculate ETA → Travel System → Patches → World Time Advances
```

**Action-Based Time Advancement** (New):
```
Player Action → AI Estimates Time Cost → advance_time Tool → Patches → World Time Advances
```

### **2. The advance_time Tool**

**Tool Name**: `advance_time`

**Purpose**: Advance world time by a specified number of minutes for actions like:
- Waiting (as requested by player)
- Thorough searching (15-30 minutes)
- Extended conversations (10-20 minutes)
- Crafting/repair activities (30-120 minutes)
- Resting (as requested by player)

**Input Schema**:
```typescript
{
  minutes: number,        // Required: minutes to advance (1-1440)
  reason?: string         // Optional: why time is advancing
}
```

**Output**:
```typescript
{
  success: boolean,
  timeAdvanced: {
    minutes: number,
    hours: number,
    remainingMinutes: number,
    previousTime: string,
    newTime: string,
    timeDescription: string
  },
  patches: Patch[],       // Ready to apply to GTWG
  narrative: string       // Human-readable time change description
}
```

### **3. Patch Generation**

The tool generates patches that follow the existing V2 architecture:

```typescript
{
  op: 'set',
  entity: '__meta__',
  field: 'worldTime',
  value: newIsoTimestamp,
  proposer: 'time_system',
  metadata: {
    reason: 'Player waiting',
    minutesAdvanced: 240,
    previousTime: '2024-03-15T08:00:00.000Z'
  }
}
```

### **4. Integration with Existing Systems**

**Same Patch System**: Uses identical patch structure as travel system
**Same Validation**: Patches go through Arbiter validation
**Same Application**: Uses `apply_patches` tool
**Same Metadata**: Updates GTWG metadata.worldTime

---

## **Usage Examples**

### **Example 1: Player Waits**
```
Player: "I wait for four hours"
AI: Calls advance_time({ minutes: 240, reason: 'Player waiting' })
AI: Applies patches via apply_patches
AI: Reports: "Time advances by 4 hours. The world moves forward from 8:00 AM to 12:00 PM."
```

### **Example 2: Thorough Search**
```
Player: "I thoroughly search the villa for hidden compartments"
AI: Calls advance_time({ minutes: 30, reason: 'Thorough search' })
AI: Applies patches via apply_patches
AI: Reports: "After a thorough 30-minute search..."
```

### **Example 3: Extended Conversation**
```
Player: "I have a long conversation with the merchant about trade routes"
AI: Calls advance_time({ minutes: 45, reason: 'Extended conversation' })
AI: Applies patches via apply_patches
AI: Reports: "The conversation lasts nearly an hour..."
```

---

## **AI Instructions**

### **When to Use advance_time**
- **Waiting**: Player explicitly requests to wait
- **Searching**: Thorough searches, investigations
- **Conversations**: Extended dialogues, negotiations
- **Crafting**: Building, repairing, creating items
- **Resting**: Sleeping, meditating, recovering

### **When NOT to Use advance_time**
- **Travel**: Use travel system instead
- **Quick actions**: Brief conversations, simple tasks
- **Instant effects**: Immediate spell casting, quick item use

### **Time Cost Guidelines**
- **Brief action**: 1-5 minutes (no time advancement needed)
- **Simple task**: 5-15 minutes (consider time advancement)
- **Moderate task**: 15-60 minutes (definitely advance time)
- **Major task**: 1-4 hours (advance time with reason)
- **Extended activity**: 4+ hours (break into smaller increments)

---

## **Technical Implementation**

### **File Structure**
```
v2/
├── agent/
│   ├── tools.ts              # advance_time tool implementation
│   ├── AgentOrchestrator.ts  # Tool registration
│   └── prompt.ts             # Updated AI instructions
├── demos/
│   └── time-advancement-demo.ts  # Demo script
└── __tests__/
    └── TimeAdvancementTool.test.ts  # Unit tests
```

### **Dependencies**
- **WorldTime utilities**: Uses existing `addMinutesToIso` function
- **Patch system**: Integrates with existing `PressurePatch` types
- **GTWG metadata**: Updates `__meta__.worldTime` field
- **Validation**: Prevents invalid time advances

### **Error Handling**
- **Invalid minutes**: Must be positive number
- **Time limits**: Cannot advance more than 24 hours at once
- **Missing metadata**: Graceful fallback to current time
- **Patch validation**: Follows existing patch validation rules

---

## **Benefits of This Approach**

### **1. Architectural Consistency**
- **Same patch system** as travel and other V2 systems
- **Same validation rules** and error handling
- **Same metadata structure** for world state

### **2. AI Control**
- **AI decides** when time should advance
- **AI estimates** appropriate time costs
- **AI provides** narrative context for time changes

### **3. Extensibility**
- **Easy to add** new time-consuming actions
- **Easy to modify** time cost guidelines
- **Easy to integrate** with future time-based systems

### **4. Player Experience**
- **Realistic time progression** for all actions
- **Consistent world state** across all systems
- **Natural narrative flow** with time references

---

## **Future Enhancements**

### **Phase 1: Basic Time Effects**
- [ ] Weather changes based on time advancement
- [ ] Day/night cycle effects on gameplay
- [ ] Seasonal progression over long time periods

### **Phase 2: Advanced Time Features**
- [ ] Time-based world events
- [ ] Scheduled NPC activities
- [ ] Time-sensitive quests and objectives

### **Phase 3: Time Manipulation**
- [ ] Time travel mechanics
- [ ] Temporal paradox prevention
- [ ] Multiple timeline support

---

## **Testing**

### **Run Demo**
```bash
npm run demo:time
```

### **Run Tests**
```bash
npm run test:time
```

### **Manual Testing**
1. Start with simple time advancement (e.g., 30 minutes)
2. Test edge cases (24 hours, 1 minute)
3. Verify patches are generated correctly
4. Confirm time updates in GTWG metadata
5. Test AI integration with various prompts

---

## **Summary**

The time advancement system provides a **clean, consistent way** for AI agents to advance world time without needing to modify the core architecture. By using the existing patch system, it maintains architectural integrity while giving the AI full control over time progression for non-travel actions.

**Key Benefits**:
- ✅ **Architecturally consistent** with existing V2 systems
- ✅ **AI-controlled** time advancement for realistic gameplay
- ✅ **Patch-based** updates following established patterns
- ✅ **Comprehensive validation** and error handling
- ✅ **Easy to extend** for future time-based features

This system bridges the gap between the rigid travel time calculations and the flexible AI-driven time management, creating a unified approach to world time progression in Chronicle V2.
