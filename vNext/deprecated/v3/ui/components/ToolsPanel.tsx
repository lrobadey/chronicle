import React from 'react';
import { Tool } from '../types';
import { ToolIcon } from './Icons';

interface ToolsPanelProps {
  tools: Tool[];
  activeTools: string[];
}

const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools, activeTools }) => {
  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <h3 className="text-lg font-bold text-yellow-400 mb-3 flex items-center gap-2">
        <ToolIcon className="w-5 h-5" />
        Agent Tools
      </h3>
      <div className="space-y-3">
        {tools.map(tool => (
          <div key={tool.id} className={`p-3 rounded-md border ${activeTools.includes(tool.id) ? 'bg-yellow-500/20 border-yellow-400 shadow-lg shadow-yellow-500/10' : 'bg-gray-700/50 border-gray-600'} transition-all duration-300`}>
            <p className="font-semibold text-yellow-300">{tool.name}</p>
            <p className="text-xs text-gray-400">{tool.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ToolsPanel;