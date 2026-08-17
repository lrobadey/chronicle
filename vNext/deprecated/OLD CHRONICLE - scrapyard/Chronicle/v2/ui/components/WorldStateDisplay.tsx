import React, { useState } from 'react';
import type { WorldSidebarData } from '../types/UITypes';
import type { WeatherState } from '../../types/WeatherTypes';

interface Props {
  sidebar: WorldSidebarData;
  weather?: WeatherState | null;
}

const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-section">
      <div className="sidebar-header">
        <span>{title}</span>
        <button onClick={() => setOpen(!open)} className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-white/10 transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      {open && <div className="sidebar-content">{children}</div>}
    </div>
  );
};

const WorldStateDisplay: React.FC<Props> = ({ sidebar, weather }) => {
  const render = (items: string[], empty: string) => (
    <ul className="space-y-2 text-sm list-disc list-inside" style={{ color: 'var(--text-secondary)' }}>
      {items && items.length ? items.map((it, i) => <li key={i}>{it}</li>) : (
        <li className="list-none italic" style={{ color: 'var(--text-muted)' }}>{empty}</li>
      )}
    </ul>
  );
  const icon = (t: string) => t === 'clear' ? '☀️' : t === 'rain' ? '🌧️' : t === 'storm' ? '⛈️' : t === 'fog' ? '🌫️' : '❄️';
  const intensityDesc = (n: number) => ['very light','light','moderate','heavy','very heavy','extreme'][n] ?? 'moderate';
  return (
    <aside className="w-full lg:w-1/3 xl:w-1/4 p-4 card h-full overflow-y-auto">
      <h2 className="text-xl font-bold gradient-text mb-2 app-title">Continuity Log</h2>
      <div className="space-y-2">
        <Section title="World State">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{sidebar.worldState || <span className="italic" style={{ color: 'var(--text-muted)' }}>Not yet defined.</span>}</p>
        </Section>
        {weather && (
          <Section title="Weather" defaultOpen>
            <div className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex items-center gap-2"><span className="text-lg">{icon(weather.type)}</span><span className="capitalize font-medium">{intensityDesc(weather.intensity)} {weather.type}</span></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span style={{ color: 'var(--text-muted)' }}>Temperature:</span><span className="ml-1">{weather.temperature}°C</span></div>
                <div><span style={{ color: 'var(--text-muted)' }}>Wind:</span><span className="ml-1">{weather.windSpeed} km/h</span></div>
                {weather.pressure && (
                  <>
                    <div><span style={{ color: 'var(--text-muted)' }}>Pressure:</span><span className="ml-1">{weather.pressure.pressure} hPa</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>System:</span><span className="ml-1 capitalize">{weather.pressure.system}</span></div>
                    {weather.pressure.trend && <div><span style={{ color: 'var(--text-muted)' }}>Trend:</span><span className="ml-1 capitalize">{weather.pressure.trend}</span></div>}
                    {typeof weather.pressure.changeRate === 'number' && <div><span style={{ color: 'var(--text-muted)' }}>Change:</span><span className="ml-1">{weather.pressure.changeRate > 0 ? '+' : ''}{weather.pressure.changeRate} hPa/h</span></div>}
                  </>
                )}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Last updated: {new Date(weather.lastUpdate).toLocaleTimeString()}</div>
            </div>
          </Section>
        )}
        <Section title="Quests">{render(sidebar.quests, 'No active quests.')}</Section>
        <Section title="People">{render(sidebar.people, 'No people of interest met.')}</Section>
        <Section title="Locations">{render(sidebar.locations, 'No locations discovered.')}</Section>
        <Section title="Regions">{render(sidebar.regions, 'No regions discovered.')}</Section>
        <Section title="Motives">{render(sidebar.motives, 'No motives discovered.')}</Section>
        <Section title="Lore">{render(sidebar.lore, 'No lore discovered.')}</Section>
      </div>
    </aside>
  );
};

export default WorldStateDisplay;


