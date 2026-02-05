import React, { useEffect, useState } from 'react';
import type { MapData, MapFeature } from '../types/UITypes';
import type { WeatherState } from '../../types/WeatherTypes';

interface Props {
  mapData: MapData;
  weather?: WeatherState | null;
}

function featureStyle(feature: MapFeature, gridSize: number, hovered: boolean, weather?: WeatherState | null): React.CSSProperties {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${(feature.x / gridSize) * 100}%`,
    top: `${(feature.y / gridSize) * 100}%`,
    width: `${(feature.width / gridSize) * 100}%`,
    height: `${(feature.height / gridSize) * 100}%`,
    boxSizing: 'border-box',
    transition: 'all 0.3s ease-in-out',
    opacity: 1,
  };
  const hov = hovered;
  switch (feature.type) {
    case 'building':
      style.backgroundColor = hov ? 'rgba(0, 224, 255, 0.8)' : 'rgba(0, 224, 255, 0.5)';
      style.border = hov ? '2px solid rgba(0, 224, 255, 1)' : '1px solid rgba(0, 224, 255, 0.7)';
      break;
    case 'road':
      style.backgroundColor = hov ? 'rgba(163, 175, 191, 0.9)' : 'rgba(163, 175, 191, 0.7)';
      break;
    case 'terrain':
      style.backgroundColor = hov ? 'rgba(207, 233, 255, 0.7)' : 'rgba(207, 233, 255, 0.5)';
      break;
    case 'water':
      style.backgroundColor = 'rgba(64, 156, 255, 0.6)';
      if (weather) {
        if (weather.type === 'rain') style.backgroundColor = 'rgba(64, 156, 255, 0.8)';
        if (weather.type === 'storm') style.backgroundColor = 'rgba(30, 58, 138, 0.9)';
        if (weather.type === 'snow') style.backgroundColor = 'rgba(64, 156, 255, 0.4)';
      }
      break;
    case 'forest':
      style.backgroundColor = 'rgba(34, 139, 34, 0.7)';
      if (weather) {
        if (weather.type === 'rain') style.backgroundColor = 'rgba(0, 100, 0, 0.8)';
        if (weather.type === 'storm') style.backgroundColor = 'rgba(0, 50, 0, 0.9)';
        if (weather.type === 'fog') { style.backgroundColor = 'rgba(34, 139, 34, 0.5)'; style.filter = 'blur(0.5px)'; }
        if (weather.type === 'snow') style.backgroundColor = 'rgba(34, 139, 34, 0.3)';
      }
      break;
    case 'mountain':
      style.backgroundColor = 'rgba(105, 105, 105, 0.8)';
      if (weather) {
        if (weather.type === 'rain') style.backgroundColor = 'rgba(80, 80, 80, 0.9)';
        if (weather.type === 'storm') style.backgroundColor = 'rgba(60, 60, 60, 1)';
        if (weather.type === 'snow') style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        if (weather.type === 'fog') { style.backgroundColor = 'rgba(105, 105, 105, 0.6)'; style.filter = 'blur(0.5px)'; }
      }
      break;
    case 'landmark':
      style.backgroundColor = 'rgba(255, 215, 0, 0.9)';
      if (weather) {
        if (weather.type === 'rain') style.backgroundColor = 'rgba(255, 215, 0, 0.7)';
        if (weather.type === 'storm') style.backgroundColor = 'rgba(255, 215, 0, 0.5)';
        if (weather.type === 'fog') { style.backgroundColor = 'rgba(255, 215, 0, 0.6)'; style.filter = 'blur(0.5px)'; }
        if (weather.type === 'snow') style.backgroundColor = 'rgba(255, 215, 0, 0.4)';
      }
      break;
  }
  switch (feature.visitState) {
    case 'unvisited': style.opacity = 0.4; style.filter = 'grayscale(80%)'; break;
    case 'visited': style.opacity = 0.7; break;
    case 'current': style.boxShadow = '0 0 12px 3px var(--aurora)'; (style as any).zIndex = 5; break;
    case 'important': style.border = '2px solid var(--aurora)'; style.boxShadow = '0 0 8px 1px var(--aurora)'; break;
  }
  return style;
}

const MapDisplay: React.FC<Props> = ({ mapData, weather }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  if (!mapData) return <div className="w-full h-full flex items-center justify-center bg-gray-900 rounded-lg"><p className="text-gray-500">Loading map...</p></div>;
  const { features, playerX, playerY, gridSize } = mapData;
  const playerStyle: React.CSSProperties = {
    position: 'absolute', left: `${(playerX / gridSize) * 100}%`, top: `${(playerY / gridSize) * 100}%`,
    width: `${(1 / gridSize) * 100}%`, height: `${(1 / gridSize) * 100}%`, backgroundColor: 'var(--aurora)', borderRadius: '50%', boxShadow: '0 0 8px var(--aurora)', zIndex: 10,
  };
  const overlay: React.CSSProperties = (() => {
    if (!weather) return {};
    const base: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 } as any;
    switch (weather.type) {
      case 'rain': return { ...base, background: `linear-gradient(180deg, rgba(59,130,246,${0.1 + weather.intensity * 0.05}) 0%, rgba(59,130,246,${0.05 + weather.intensity * 0.02}) 100%)`, animation: 'rain-fall 1s linear infinite' };
      case 'storm': return { ...base, background: `linear-gradient(180deg, rgba(30,58,138,${0.2 + weather.intensity * 0.08}) 0%, rgba(30,58,138,${0.1 + weather.intensity * 0.04}) 100%)`, animation: 'storm-fall 0.5s linear infinite' };
      case 'fog': return { ...base, background: `rgba(156,163,175,${0.1 + weather.intensity * 0.1})`, backdropFilter: 'blur(2px)' };
      case 'snow': return { ...base, background: `linear-gradient(180deg, rgba(255,255,255,${0.05 + weather.intensity * 0.03}) 0%, rgba(255,255,255,${0.02 + weather.intensity * 0.01}) 100%)`, animation: 'snow-fall 2s linear infinite' };
      default: return {};
    }
  })();
  return (
    <div className="w-full h-full map-container overflow-hidden p-2">
      <h3 className="text-lg font-bold gradient-text mb-2 pl-1 app-title">World Map</h3>
      <div className="relative w-full h-[calc(100%-2rem)]" style={{ background: 'var(--bg-secondary)' }}>
        {features.map((f) => (
          <div key={f.id} style={featureStyle(f, gridSize, hovered === f.id, weather)} onMouseEnter={() => setHovered(f.id)} onMouseLeave={() => setHovered(null)} />
        ))}
        <div style={playerStyle} />
        <div style={overlay} />
        {weather && (
          <div className="absolute top-2 right-2 glass px-2 py-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <div className="flex items-center gap-1">
              <span className="capitalize">{weather.type}</span><span>•</span><span>{weather.temperature}°C</span><span>•</span><span>{weather.windSpeed} km/h</span>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes rain-fall{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes storm-fall{0%{transform:translateY(-100%) translateX(-10px)}100%{transform:translateY(100%) translateX(10px)}}@keyframes snow-fall{0%{transform:translateY(-100%) translateX(-5px)}100%{transform:translateY(100%) translateX(5px)}}`}</style>
    </div>
  );
};

export default MapDisplay;


