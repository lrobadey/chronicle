import React from 'react';
import type { EventLogEntry, TurnPhase } from '../types';

interface EventLogProps {
  entries: EventLogEntry[];
  phase: TurnPhase;
}

const PHASE_LABELS: Record<TurnPhase, string> = {
  idle: 'Idle',
  gm_start: 'GM reasoning',
  gm_complete: 'GM complete',
  narrator_start: 'Narrator crafting',
  narrator_complete: 'Narrator complete',
};

const TYPE_STYLES: Record<EventLogEntry['type'], string> = {
  phase: 'border-cyan-400/40 text-cyan-200',
  tool: 'border-yellow-400/50 text-yellow-100',
  status: 'border-blue-400/40 text-blue-100',
  error: 'border-red-400/50 text-red-100',
};

const EventLog: React.FC<EventLogProps> = ({ entries, phase }) => {
  return (
    <div className="p-4 bg-gray-900/70 rounded-lg border border-gray-700/60 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-cyan-200 tracking-wide">GM Event Log</h3>
        <span className="text-xs uppercase text-gray-400">{PHASE_LABELS[phase] || 'Idle'}</span>
      </header>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No agent events yet.</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`border-l-4 pl-3 py-1 bg-gray-800/70 rounded ${TYPE_STYLES[entry.type]} text-xs`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{entry.label}</span>
                <span className="text-[10px] text-gray-400">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              {entry.detail && <p className="text-[11px] text-gray-300 mt-0.5">{entry.detail}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default EventLog;
