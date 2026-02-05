
import React from 'react';
import { WorldStateData } from '../types';
import { DatabaseIcon } from './Icons';

interface WorldStateProps {
  state: WorldStateData;
  newPatch: string | null;
}

const WorldState: React.FC<WorldStateProps> = ({ state, newPatch }) => {
  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <h3 className="text-lg font-bold text-green-400 mb-3 flex items-center gap-2">
        <DatabaseIcon className="w-5 h-5" />
        World State
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
        <div className="p-2 bg-gray-900/50 rounded">
          <h4 className="font-bold text-green-300 mb-1 border-b border-green-500/30 pb-1">GTWG</h4>
          <pre className="text-gray-300 whitespace-pre-wrap">{JSON.stringify(state.gtwg, null, 2)}</pre>
        </div>
        <div className="p-2 bg-gray-900/50 rounded">
          <h4 className="font-bold text-blue-300 mb-1 border-b border-blue-500/30 pb-1">PKG</h4>
          <pre className="text-gray-300 whitespace-pre-wrap">{JSON.stringify(state.pkg, null, 2)}</pre>
        </div>
        <div className="p-2 bg-gray-900/50 rounded h-48 overflow-y-auto">
          <h4 className="font-bold text-purple-300 mb-1 border-b border-purple-500/30 pb-1">CanonLedger</h4>
          <div className="space-y-1">
            {state.ledger.map((entry, index) => (
              <p key={index} className="text-gray-400">{entry}</p>
            ))}
            {newPatch && (
              <p className="text-yellow-300 bg-yellow-500/10 p-1 rounded animate-fade-in">{newPatch}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorldState;
