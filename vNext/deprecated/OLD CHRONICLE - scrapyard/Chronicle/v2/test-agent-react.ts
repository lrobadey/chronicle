// Test ReAct agent with proper prompt format
import { config } from 'dotenv';
config();

import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { PromptTemplate } from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

console.log('🧪 Testing ReAct Agent...');

async function testReActAgent() {
  try {
    console.log('1. Creating tools...');
    
    const systemTool = new DynamicStructuredTool({
      name: 'run_system',
      description: 'Execute a V2 system with an action',
      schema: z.any(),
      func: async (input) => {
        console.log('System tool called with:', input, 'Type:', typeof input);
        let system, action;
        
        if (typeof input === 'string') {
          try {
            const parsed = JSON.parse(input);
            system = parsed.system;
            action = parsed.action;
          } catch {
            system = 'unknown';
            action = { type: 'unknown' };
          }
        } else {
          system = input.system;
          action = input.action;
        }
        
        const result = {
          system,
          action,
          result: `Successfully executed ${action.type} in ${system} system`,
          patches: [`Modified entity via ${system} system`]
        };
        return JSON.stringify(result);
      }
    });

    const queryTool = new DynamicStructuredTool({
      name: 'query_world',
      description: 'Query the game world state',
      schema: z.any(),
      func: async (input) => {
        console.log('Query tool called with:', input, 'Type:', typeof input);
        let query;
        
        if (typeof input === 'string') {
          try {
            const parsed = JSON.parse(input);
            query = parsed.query;
          } catch {
            query = input;
          }
        } else {
          query = input.query;
        }
        
        const mockWorldState = {
          currentLocation: 'Ancient Rome - Forum',
          availableActions: ['travel', 'talk to NPCs', 'join faction'],
          nearbyEntities: ['Senate', 'Temple of Jupiter', 'Market'],
          playerStatus: 'healthy'
        };
        return `Query: ${query}. World state: ${JSON.stringify(mockWorldState)}`;
      }
    });

    console.log('✅ Tools created');

    console.log('2. Creating ReAct agent...');
    
    const model = new ChatOpenAI({ 
      model: "gpt-4o-mini"
    });

    // Proper ReAct prompt format
    const prompt = PromptTemplate.fromTemplate(`
You are Chronicle Agent - a game master assistant. Answer the following questions as best you can. You have access to the following tools:

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action (must be valid JSON matching the tool's schema)
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

IMPORTANT: Action Input must be valid JSON. For query_world, use: {{"query": "your query string"}}

Begin!

Question: {input}
Thought:{agent_scratchpad}`);

    const agent = await createReactAgent({
      llm: model,
      tools: [systemTool, queryTool],
      prompt
    });

    const executor = new AgentExecutor({
      agent,
      tools: [systemTool, queryTool],
      verbose: true,
      maxIterations: 5,
      returnIntermediateSteps: true
    });

    console.log('✅ ReAct agent created');

    console.log('3. Testing agent execution...');
    
    const result = await executor.invoke({
      input: "The player wants to travel to the Temple of Jupiter in Ancient Rome. Help them do this."
    });

    console.log('✅ Agent execution completed');
    console.log('Final result:', result.output);

    console.log('\n🎉 ReAct Agent is WORKING!');
    return true;
    
  } catch (error) {
    console.error('❌ ReAct agent test failed:', error);
    console.error('Stack:', error.stack);
    return false;
  }
}

testReActAgent();
