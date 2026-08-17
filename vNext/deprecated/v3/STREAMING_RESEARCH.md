# Streaming AI Responses - Research & Implementation Plan

## Current State

### ✅ What's Already Working

1. **Event System**: The codebase has a robust event system (`GMEvent`) that supports streaming:
   - `llm_start` - When LLM begins processing
   - `llm_token` - Each token as it arrives (currently only emitted by LangChain path)
   - `llm_end` - When LLM finishes
   - `tool_start` / `tool_end` - Tool execution events
   - `agent_action` - Agent planning events
   - `error` - Error events

2. **UI Consumption**: The UI already consumes `llm_token` events:
   - `TurnStatusPanel` displays token count and tail (last 80 chars)
   - `ActivityBoard` shows token tail (last 60 chars)
   - Both update in real-time when events are emitted

3. **LangChain Path**: The LangChain implementation already streams:
   - Sets `streaming: true` in LLM config
   - Emits `llm_token` events via `handleLLMNewToken` callback
   - Works correctly with tool calling

### ❌ What's Missing

1. **OpenAI Direct Path**: The `runOpenAIGMAgentTurn` function does NOT stream:
   - Line 127: `await client.chat.completions.create(requestParams)` - no `stream: true`
   - Only emits `llm_start` and `llm_end`, never `llm_token`
   - Users see no progress during long responses

2. **Narrator**: The narrator doesn't stream either (uses LangChain's `invoke` which doesn't stream by default)

## How OpenAI Streaming Works

### Basic Streaming

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [...],
  stream: true  // Enable streaming
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    // Emit token event
    onEvent?.({ type: 'llm_token', token: content });
  }
}
```

### Streaming with Tool Calling

When tools are involved, the stream structure is more complex:

```typescript
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  
  // Content tokens (when model is generating text)
  if (delta?.content) {
    onEvent?.({ type: 'llm_token', token: delta.content });
  }
  
  // Tool calls (when model decides to use a tool)
  if (delta?.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      // Tool calls come in parts:
      // - First chunk: { index: 0, id: 'call_xxx', type: 'function', function: { name: 'query_world', arguments: '' } }
      // - Subsequent chunks: { index: 0, function: { arguments: '{"query":' } }
      // - More chunks: { index: 0, function: { arguments: ' "look around"' } }
      // Need to accumulate these!
    }
  }
}
```

### Challenges with Tool Calling + Streaming

1. **Accumulation Required**: Tool calls arrive incrementally:
   - First chunk has `id` and `name`
   - Subsequent chunks only have `arguments` fragments
   - Must accumulate `arguments` string before parsing JSON

2. **Multiple Tool Calls**: Model can call multiple tools in one response:
   - Each tool call has an `index` to identify which one
   - Need to track multiple tool calls simultaneously

3. **Content vs Tool Calls**: Response can have:
   - Pure content (no tools)
   - Pure tool calls (no content)
   - Mixed (content + tool calls) - rare but possible

4. **Finish Reason**: When stream ends, check `finish_reason`:
   - `stop` - Normal completion
   - `tool_calls` - Model wants to call tools
   - `length` - Hit token limit
   - `content_filter` - Content filtered

## Implementation Plan

### Phase 1: Add Streaming to OpenAI Direct Path

**File**: `v3/agents/gmOpenAI.ts`

**Changes**:

1. **Add `stream: true` to request** (line 110):
   ```typescript
   const requestParams = {
     model: selectedModel,
     messages,
     tools,
     tool_choice: 'auto',
     seed: seedInt,
     stream: true,  // Enable streaming
     // ... rest
   };
   ```

2. **Replace `await client.chat.completions.create()` with streaming loop**:
   ```typescript
   const stream = await client.chat.completions.create(requestParams);
   
   // Accumulators for streaming
   let accumulatedContent = '';
   const toolCallsAccumulator: Record<number, {
     id?: string;
     type?: string;
     function?: { name?: string; arguments?: string };
   }> = {};
   
   for await (const chunk of stream) {
     const delta = chunk.choices[0]?.delta;
     const finishReason = chunk.choices[0]?.finish_reason;
     
     // Handle content tokens
     if (delta?.content) {
       accumulatedContent += delta.content;
       onEvent?.({ type: 'llm_token', token: delta.content });
     }
     
     // Handle tool calls (accumulate)
     if (delta?.tool_calls) {
       for (const toolCallDelta of delta.tool_calls) {
         const idx = toolCallDelta.index;
         if (!toolCallsAccumulator[idx]) {
           toolCallsAccumulator[idx] = { function: {} };
         }
         
         const acc = toolCallsAccumulator[idx];
         if (toolCallDelta.id) acc.id = toolCallDelta.id;
         if (toolCallDelta.type) acc.type = toolCallDelta.type;
         if (toolCallDelta.function?.name) {
           acc.function = acc.function || {};
           acc.function.name = toolCallDelta.function.name;
         }
         if (toolCallDelta.function?.arguments) {
           acc.function = acc.function || {};
           acc.function.arguments = (acc.function.arguments || '') + toolCallDelta.function.arguments;
         }
       }
     }
     
     // When stream finishes, process accumulated data
     if (finishReason) {
       // Convert accumulated tool calls to final format
       const finalToolCalls = Object.values(toolCallsAccumulator)
         .filter(tc => tc.id && tc.function?.name)
         .map(tc => ({
           id: tc.id!,
           type: tc.type || 'function',
           function: {
             name: tc.function!.name!,
             arguments: tc.function!.arguments || '{}',
           },
         }));
       
       // Use accumulatedContent or finalToolCalls for processing
       // ... rest of existing logic
     }
   }
   ```

3. **Handle both content and tool calls**:
   - If `finish_reason === 'tool_calls'`: Process tool calls (existing logic)
   - If `finish_reason === 'stop'` and `accumulatedContent`: Parse JSON (existing logic)
   - If `finish_reason === 'stop'` and no content: This shouldn't happen, but handle gracefully

### Phase 2: Add Streaming to Narrator (Optional)

**File**: `v3/agents/narrator.ts`

The narrator uses LangChain's `ChatOpenAI.invoke()`. To stream:

1. Use `streamEvents()` or `stream()` method instead of `invoke()`
2. Or switch to OpenAI SDK directly (simpler, consistent with GM)

### Phase 3: Testing

1. **Test streaming with content-only responses** (no tools)
2. **Test streaming with tool calls** (query_world, apply_patches)
3. **Test streaming with multiple tool calls** in one turn
4. **Verify UI updates in real-time** (TurnStatusPanel, ActivityBoard)
5. **Test error handling** (network interruptions, malformed chunks)

## Benefits

1. **Better UX**: Users see progress during long responses
2. **Perceived Performance**: Feels faster even if total time is same
3. **Debugging**: Can see model "thinking" in real-time
4. **Consistency**: Matches LangChain path behavior

## Considerations

1. **Token Counting**: Current UI counts tokens - streaming will make this accurate
2. **Error Recovery**: If stream fails mid-way, need to handle gracefully
3. **Tool Call Parsing**: Must ensure accumulated JSON is valid before parsing
4. **Performance**: Streaming adds minimal overhead, actually improves perceived performance

## References

- OpenAI Streaming Docs: https://platform.openai.com/docs/api-reference/streaming
- OpenAI Node.js SDK: https://github.com/openai/openai-node
- Current LangChain streaming implementation: `v3/agents/gm.ts` lines 250-272

