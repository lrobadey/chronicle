import React, { useState } from 'react';
import type { GameState, WeatherState } from '../types';
import { ChevronDownIcon, ChevronUpIcon } from './IconComponents';

interface WorldStateDisplayProps {
  gameState: GameState;
  weatherState?: WeatherState | null;
}

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="sidebar-section">
            <div className="sidebar-header">
                <span>{title}</span>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-white/10 transition-colors"
                >
                    {isOpen ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                </button>
            </div>
            {isOpen && (
                <div className="sidebar-content">
                    {children}
                </div>
            )}
        </div>
    );
};

const WorldStateDisplay: React.FC<WorldStateDisplayProps> = ({ gameState, weatherState }) => {
  
  const renderList = (items: string[], emptyText: string) => (
    <ul className="space-y-2 text-sm list-disc list-inside" style={{ color: 'var(--text-secondary)' }}>
        {items && items.length > 0 ? (
            items.map((item, index) => <li key={index}>{item}</li>)
        ) : (
            <li className="list-none italic" style={{ color: 'var(--text-muted)' }}>{emptyText}</li>
        )}
    </ul>
  );

  const getWeatherIcon = (weatherType: string) => {
    switch (weatherType) {
      case 'clear':
        return '☀️';
      case 'rain':
        return '🌧️';
      case 'storm':
        return '⛈️';
      case 'fog':
        return '🌫️';
      case 'snow':
        return '❄️';
      default:
        return '🌤️';
    }
  };

  const getIntensityDescription = (intensity: number) => {
    switch (intensity) {
      case 0: return 'very light';
      case 1: return 'light';
      case 2: return 'moderate';
      case 3: return 'heavy';
      case 4: return 'very heavy';
      case 5: return 'extreme';
      default: return 'moderate';
    }
  };

  return (
    <aside className="w-full lg:w-1/3 xl:w-1/4 p-4 card h-full overflow-y-auto">
        <h2 className="text-xl font-bold gradient-text mb-2 app-title">Continuity Log</h2>
        <div className="space-y-2">
            
            <CollapsibleSection title="World State">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {gameState.worldState || <span className="italic" style={{ color: 'var(--text-muted)' }}>Not yet defined.</span>}
                </p>
            </CollapsibleSection>

            {weatherState && (
              <CollapsibleSection title="Weather" defaultOpen={true}>
                <div className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getWeatherIcon(weatherState.type)}</span>
                    <span className="capitalize font-medium">
                      {getIntensityDescription(weatherState.intensity)} {weatherState.type}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Temperature:</span>
                      <span className="ml-1">{weatherState.temperature}°C</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Wind:</span>
                      <span className="ml-1">{weatherState.windSpeed} km/h</span>
                    </div>
                  </div>
                  {weatherState.pressure && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Pressure:</span>
                        <span className="ml-1">{weatherState.pressure.pressure} hPa</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>System:</span>
                        <span className="ml-1 capitalize">{weatherState.pressure.system}</span>
                      </div>
                      {weatherState.pressure.trend && (
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Trend:</span>
                          <span className="ml-1 capitalize">{weatherState.pressure.trend}</span>
                        </div>
                      )}
                      {weatherState.pressure.changeRate && (
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Change:</span>
                          <span className="ml-1">{weatherState.pressure.changeRate > 0 ? '+' : ''}{weatherState.pressure.changeRate} hPa/h</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Last updated: {new Date(weatherState.lastUpdate).toLocaleTimeString()}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            <CollapsibleSection title="Quests">
                {renderList(gameState.quests, 'No active quests.')}
            </CollapsibleSection>
            
            <CollapsibleSection title="People">
                {renderList(gameState.people, 'No people of interest met.')}
            </CollapsibleSection>

            <CollapsibleSection title="Locations">
                {renderList(gameState.locations, 'No locations discovered.')}
            </CollapsibleSection>

            <CollapsibleSection title="Regions">
                {renderList(gameState.regions, 'No regions discovered.')}
            </CollapsibleSection>

            <CollapsibleSection title="Motives">
                {renderList(gameState.motives, 'No motives discovered.')}
            </CollapsibleSection>

            <CollapsibleSection title="Lore">
                {renderList(gameState.lore, 'No lore discovered.')}
            </CollapsibleSection>

        </div>
    </aside>
  );
};

export default WorldStateDisplay;