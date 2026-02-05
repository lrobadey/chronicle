import React from 'react';
import { ToolIcon } from './Icons';

interface AgentOrchestratorProps {
  steps: string[];
  isThinking: boolean;
  activeTool: string | null;
  currentAgent: 'executor' | 'narrator' | null;
}

const AgentOrchestrator: React.FC<AgentOrchestratorProps> = ({ steps, isThinking, activeTool, currentAgent }) => {
  const getAgentTitle = () => {
    if (!currentAgent) return 'ReAct Agent Executor';
    return currentAgent === 'executor' ? 'Executor Agent (Logic)' : 'Narrator Agent (Story)';
  }

  const getBorderColor = () => {
    if (!isThinking) return 'border-gray-700';
    return currentAgent === 'executor' ? 'border-cyan-500' : 'border-purple-500';
  }

  const getHeaderColor = () => {
    if (!currentAgent) return 'text-cyan-400';
    return currentAgent === 'executor' ? 'text-cyan-400' : 'text-purple-400';
  }


  return (
    <div className={`p-4 bg-gray-800 rounded-lg border-2 ${isThinking ? `${getBorderColor()} animate-pulse` : 'border-gray-700'} transition-colors duration-500`}>
      <h3 className={`text-lg font-bold ${getHeaderColor()} mb-3 flex items-center gap-2 transition-colors duration-500`}>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M12 6a2 2 0 100-4 2 2 0 000 4zm0 14a2 2 0 100-4 2 2 0 000 4zm6-8a2 2 0 100-4 2 2 0 000 4zm-14 0a2 2 0 100-4 2 2 0 000 4z" /></svg>
        {getAgentTitle()}
      </h3>
      <div className="space-y-2 text-sm h-48 overflow-y-auto font-mono text-gray-300 pr-2">
        {steps.map((step, index) => (
          <p key={index} className="animate-fade-in">&gt; {step}</p>
        ))}
        {isThinking && steps.length > 0 && <div className={`w-2 h-4 ${currentAgent === 'executor' ? 'bg-cyan-400' : 'bg-purple-400'} animate-blink ml-1 inline-block`}></div>}
      </div>
      {isThinking && activeTool && (
        <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2 text-yellow-400 animate-fade-in">
          <ToolIcon className="w-5 h-5 animate-spin-slow" />
          <span className="font-semibold text-sm">Using Tool:</span>
          <span className="font-mono bg-yellow-900/50 text-yellow-300 px-2 py-1 rounded-md text-sm font-bold">{activeTool}</span>
        </div>
      )}
    </div>
  );
};

export default AgentOrchestrator;