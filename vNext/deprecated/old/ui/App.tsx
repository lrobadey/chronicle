import React, { useEffect, useState } from 'react';
import MapDisplay from './components/MapDisplay';
import ChatInterface from './components/ChatInterface';
import WorldStateDisplay from './components/WorldStateDisplay';
import type { MapData, WorldSidebarData } from './types/UITypes';
import type { WeatherState } from '../types/WeatherTypes';

// Placeholder props to wire V2 UI without kernel glue
export interface V2AppProps {
  initialMap: MapData;
  initialSidebar: WorldSidebarData;
  initialWeather?: WeatherState | null;
  onSend: (text: string, onStream: (chunk: string) => void) => Promise<{ narrative: string } | void>;
}

const App: React.FC<V2AppProps> = ({ initialMap, initialSidebar, initialWeather = null, onSend }) => {
  const [map, setMap] = useState(initialMap);
  const [sidebar, setSidebar] = useState(initialSidebar);
  const [weather, setWeather] = useState<WeatherState | null>(initialWeather);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="app-header p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold gradient-text tracking-wider app-title">Chronicle V2</h1>
        <div />
      </header>
      <main>
        <div className="flex flex-col lg:flex-row gap-4 p-4 max-w-7xl mx-auto h-[calc(100vh-81px)]">
          <div className="flex flex-col flex-grow lg:w-2/3 xl:w-3/4 h-full gap-4">
            <div className="h-1/2 lg:h-2/5 card p-2">
              <MapDisplay mapData={map} weather={weather} />
            </div>
            <div className="h-1/2 lg:h-3/5">
              <ChatInterface onSend={onSend} />
            </div>
          </div>
          <WorldStateDisplay sidebar={sidebar} weather={weather} />
        </div>
      </main>
    </div>
  );
};

export default App;


