import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { MapData, MapFeature, WeatherState } from '../types';

interface MapDisplayProps {
    mapData: MapData;
    weatherState?: WeatherState | null;
}

const getFeatureStyle = (feature: MapFeature, gridSize: number, isHovered: boolean = false, weatherState?: WeatherState | null): React.CSSProperties => {
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

    // Base color
    switch (feature.type) {
        case 'building':
            if (isHovered) {
                style.backgroundColor = 'rgba(0, 224, 255, 0.8)'; // Brighter aurora when hovered
                style.border = '2px solid rgba(0, 224, 255, 1)';
                style.animation = 'feature-glow 0.3s ease-out forwards';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(0, 224, 255, 0.5)'; // aurora
                style.border = '1px solid rgba(0, 224, 255, 0.7)';
            }
            break;
        case 'road':
            if (isHovered) {
                style.backgroundColor = 'rgba(163, 175, 191, 0.9)'; // Brighter silver-slate when hovered
                style.boxShadow = '0 0 15px rgba(163, 175, 191, 0.5)';
                style.transform = 'scale(1.01)';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(163, 175, 191, 0.7)'; // silver-slate
            }
            break;
        case 'terrain':
            if (isHovered) {
                style.backgroundColor = 'rgba(207, 233, 255, 0.7)'; // Brighter icefield when hovered
                style.boxShadow = '0 0 15px rgba(207, 233, 255, 0.4)';
                style.transform = 'scale(1.01)';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(207, 233, 255, 0.5)'; // icefield
            }
            break;
        case 'water':
            if (isHovered) {
                style.backgroundColor = 'rgba(64, 156, 255, 0.8)'; // Brighter deep blue when hovered
                style.border = '2px solid rgba(64, 156, 255, 1)';
                style.animation = 'feature-glow 0.3s ease-out forwards';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(64, 156, 255, 0.6)'; // deep blue
                style.border = '1px solid rgba(64, 156, 255, 0.8)';
            }
            // Weather effects for water
            if (weatherState) {
                switch (weatherState.type) {
                    case 'rain':
                        style.backgroundColor = 'rgba(64, 156, 255, 0.8)'; // Darker blue in rain
                        style.boxShadow = '0 0 8px rgba(64, 156, 255, 0.4)';
                        break;
                    case 'storm':
                        style.backgroundColor = 'rgba(30, 58, 138, 0.9)'; // Very dark blue in storms
                        style.boxShadow = '0 0 12px rgba(30, 58, 138, 0.6)';
                        break;
                    case 'snow':
                        style.backgroundColor = 'rgba(64, 156, 255, 0.4)'; // Lighter blue under snow
                        break;
                }
            }
            break;
        case 'forest':
            if (isHovered) {
                style.backgroundColor = 'rgba(34, 139, 34, 0.8)'; // Brighter forest green when hovered
                style.boxShadow = '0 0 15px rgba(34, 139, 34, 0.5)';
                style.transform = 'scale(1.01)';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(34, 139, 34, 0.7)'; // forest green
            }
            // Weather effects for forest
            if (weatherState) {
                switch (weatherState.type) {
                    case 'rain':
                        style.backgroundColor = 'rgba(0, 100, 0, 0.8)'; // Darker green in rain
                        style.boxShadow = '0 0 8px rgba(0, 100, 0, 0.4)';
                        break;
                    case 'storm':
                        style.backgroundColor = 'rgba(0, 50, 0, 0.9)'; // Very dark green in storms
                        style.boxShadow = '0 0 12px rgba(0, 50, 0, 0.6)';
                        break;
                    case 'fog':
                        style.backgroundColor = 'rgba(34, 139, 34, 0.5)'; // Lighter green in fog
                        style.filter = 'blur(0.5px)';
                        break;
                    case 'snow':
                        style.backgroundColor = 'rgba(34, 139, 34, 0.3)'; // Very light green under snow
                        break;
                }
            }
            break;
        case 'mountain':
            if (isHovered) {
                style.backgroundColor = 'rgba(105, 105, 105, 0.8)'; // Brighter stone gray when hovered
                style.boxShadow = '0 0 15px rgba(105, 105, 105, 0.5)';
                style.transform = 'scale(1.01)';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(105, 105, 105, 0.8)'; // stone gray
            }
            // Weather effects for mountain
            if (weatherState) {
                switch (weatherState.type) {
                    case 'rain':
                        style.backgroundColor = 'rgba(80, 80, 80, 0.9)'; // Darker gray in rain
                        style.boxShadow = '0 0 8px rgba(80, 80, 80, 0.4)';
                        break;
                    case 'storm':
                        style.backgroundColor = 'rgba(60, 60, 60, 1)'; // Very dark gray in storms
                        style.boxShadow = '0 0 12px rgba(60, 60, 60, 0.6)';
                        break;
                    case 'snow':
                        style.backgroundColor = 'rgba(255, 255, 255, 0.9)'; // White under snow
                        style.boxShadow = '0 0 8px rgba(255, 255, 255, 0.4)';
                        break;
                    case 'fog':
                        style.backgroundColor = 'rgba(105, 105, 105, 0.6)'; // Lighter gray in fog
                        style.filter = 'blur(0.5px)';
                        break;
                }
            }
            break;
        case 'landmark':
            if (isHovered) {
                style.backgroundColor = 'rgba(255, 215, 0, 0.8)'; // Brighter gold when hovered
                style.border = '2px solid rgba(255, 215, 0, 1)';
                style.animation = 'feature-glow 0.3s ease-out forwards';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(255, 215, 0, 0.9)'; // gold
                style.border = '1px solid rgba(255, 215, 0, 0.8)';
            }
            // Weather effects for landmark
            if (weatherState) {
                switch (weatherState.type) {
                    case 'rain':
                        style.backgroundColor = 'rgba(255, 215, 0, 0.7)'; // Slightly dimmer in rain
                        style.boxShadow = '0 0 8px rgba(255, 215, 0, 0.3)';
                        break;
                    case 'storm':
                        style.backgroundColor = 'rgba(255, 215, 0, 0.5)'; // Much dimmer in storms
                        style.boxShadow = '0 0 12px rgba(255, 215, 0, 0.2)';
                        break;
                    case 'fog':
                        style.backgroundColor = 'rgba(255, 215, 0, 0.6)'; // Dimmer in fog
                        style.filter = 'blur(0.5px)';
                        break;
                    case 'snow':
                        style.backgroundColor = 'rgba(255, 215, 0, 0.4)'; // Very dim under snow
                        break;
                }
            }
            break;
        default:
            if (isHovered) {
                style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.3)';
                style.transform = 'scale(1.01)';
                style.zIndex = 20;
            } else {
                style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            }
            break;
    }

    // Modify style based on visitState
    switch (feature.visitState) {
        case 'unvisited':
            style.opacity = 0.4;
            style.filter = 'grayscale(80%)';
            break;
        case 'visited':
            style.opacity = 0.7;
            break;
        case 'current':
            style.boxShadow = '0 0 12px 3px var(--aurora)';
            style.zIndex = 5;
            break;
        case 'important':
            style.border = '2px solid var(--aurora)';
            if (feature.visitState === 'important') {
                 style.boxShadow = '0 0 8px 1px var(--aurora)';
            }
            break;
        default:
            break;
    }

    return style;
};

const MapDisplay: React.FC<MapDisplayProps> = ({ mapData, weatherState }) => {
    const [hoveredFeature, setHoveredFeature] = useState<{ feature: MapFeature; x: number; y: number } | null>(null);
    const [tooltipElement, setTooltipElement] = useState<HTMLDivElement | null>(null);

    // Create tooltip portal
    useEffect(() => {
        if (!tooltipElement) {
            const element = document.createElement('div');
            element.id = 'map-tooltip-portal';
            element.style.position = 'fixed';
            element.style.top = '0';
            element.style.left = '0';
            element.style.width = '100%';
            element.style.height = '100%';
            element.style.pointerEvents = 'none';
            element.style.zIndex = '9999';
            document.body.appendChild(element);
            setTooltipElement(element);
        }

        return () => {
            if (tooltipElement) {
                document.body.removeChild(tooltipElement);
            }
        };
    }, [tooltipElement]);

    // Calculate optimal tooltip position
    const getTooltipPosition = (mouseX: number, mouseY: number) => {
        const tooltipWidth = 200; // Approximate tooltip width
        const tooltipHeight = 50; // Slightly larger for two lines
        const padding = 10;
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let left = mouseX + padding;
        let top = mouseY - tooltipHeight - padding; // Always try to position above first
        
        // If not enough space above, position below
        if (top < padding) {
            top = mouseY + padding;
        }
        
        // Force tooltip to appear above cursor when there's space
        if (mouseY > tooltipHeight + padding * 2) {
            top = mouseY - tooltipHeight - padding;
        }
        
        // Check if tooltip would go off the right edge
        if (left + tooltipWidth > viewportWidth) {
            left = mouseX - tooltipWidth - padding;
        }
        
        // Check if tooltip would go off the left edge
        if (left < padding) {
            left = padding;
        }
        
        // Final safety check - ensure tooltip is always visible
        left = Math.max(padding, Math.min(left, viewportWidth - tooltipWidth - padding));
        top = Math.max(padding, Math.min(top, viewportHeight - tooltipHeight - padding));
        
        return { left, top };
    };

    if (!mapData) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-900 rounded-lg">
                <p className="text-gray-500">Loading map...</p>
            </div>
        );
    }
    
    const { features, playerX, playerY, gridSize } = mapData;

    const playerStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${(playerX / gridSize) * 100}%`,
        top: `${(playerY / gridSize) * 100}%`,
        width: `${(1 / gridSize) * 100}%`,
        height: `${(1 / gridSize) * 100}%`,
        backgroundColor: 'var(--aurora)',
        borderRadius: '50%',
        boxShadow: '0 0 8px var(--aurora)',
        zIndex: 10,
        transform: 'translate(0, 0)', // Fix potential half-pixel issues
    };

    // Weather overlay styles
    const getWeatherOverlayStyle = (): React.CSSProperties => {
        if (!weatherState) return {};
        
        const baseStyle: React.CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 15,
        };

        switch (weatherState.type) {
            case 'rain':
                return {
                    ...baseStyle,
                    background: `linear-gradient(180deg, 
                        rgba(59, 130, 246, ${0.1 + weatherState.intensity * 0.05}) 0%, 
                        rgba(59, 130, 246, ${0.05 + weatherState.intensity * 0.02}) 100%)`,
                    animation: 'rain-fall 1s linear infinite',
                };
            case 'storm':
                return {
                    ...baseStyle,
                    background: `linear-gradient(180deg, 
                        rgba(30, 58, 138, ${0.2 + weatherState.intensity * 0.08}) 0%, 
                        rgba(30, 58, 138, ${0.1 + weatherState.intensity * 0.04}) 100%)`,
                    animation: 'storm-fall 0.5s linear infinite',
                };
            case 'fog':
                return {
                    ...baseStyle,
                    background: `rgba(156, 163, 175, ${0.1 + weatherState.intensity * 0.1})`,
                    backdropFilter: 'blur(2px)',
                };
            case 'snow':
                return {
                    ...baseStyle,
                    background: `linear-gradient(180deg, 
                        rgba(255, 255, 255, ${0.05 + weatherState.intensity * 0.03}) 0%, 
                        rgba(255, 255, 255, ${0.02 + weatherState.intensity * 0.01}) 100%)`,
                    animation: 'snow-fall 2s linear infinite',
                };
            default:
                return {};
        }
    };
    
    return (
        <div className="w-full h-full map-container overflow-hidden p-2">
            <h3 className="text-lg font-bold gradient-text mb-2 pl-1 app-title">World Map</h3>
            <div className="relative w-full h-[calc(100%-2rem)]" style={{ background: 'var(--bg-secondary)' }}>
                {features.map((feature) => (
                    <div
                        key={feature.id}
                        style={getFeatureStyle(feature, gridSize, hoveredFeature?.feature.id === feature.id, weatherState)}
                        onMouseEnter={(e) => setHoveredFeature({ feature, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHoveredFeature(null)}
                    />
                ))}
                <div style={playerStyle} />
                
                {/* Weather overlay */}
                <div style={getWeatherOverlayStyle()} />
                
                {/* Weather indicator */}
                {weatherState && (
                    <div className="absolute top-2 right-2 glass px-2 py-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <div className="flex items-center gap-1">
                            <span className="capitalize">{weatherState.type}</span>
                            <span>•</span>
                            <span>{weatherState.temperature}°C</span>
                            <span>•</span>
                            <span>{weatherState.windSpeed} km/h</span>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Weather animations - using CSS-in-JS instead of jsx style */}
            <style dangerouslySetInnerHTML={{
              __html: `
                @keyframes rain-fall {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(100%); }
                }
                @keyframes storm-fall {
                    0% { transform: translateY(-100%) translateX(-10px); }
                    100% { transform: translateY(100%) translateX(10px); }
                }
                @keyframes snow-fall {
                    0% { transform: translateY(-100%) translateX(-5px); }
                    100% { transform: translateY(100%) translateX(5px); }
                }
                @keyframes feature-glow {
                    0% { 
                        box-shadow: 0 0 5px rgba(0, 224, 255, 0.3);
                        transform: scale(1);
                    }
                    50% { 
                        box-shadow: 0 0 20px rgba(0, 224, 255, 0.6), 0 0 40px rgba(0, 224, 255, 0.3);
                        transform: scale(1.02);
                    }
                    100% { 
                        box-shadow: 0 0 20px rgba(0, 224, 255, 0.6), 0 0 40px rgba(0, 224, 255, 0.3);
                        transform: scale(1.02);
                    }
                }
              `
            }} />
            
            {hoveredFeature && tooltipElement && ReactDOM.createPortal(
                <div
                    className="px-3 py-2 rounded-lg text-sm pointer-events-none shadow-lg border backdrop-blur-sm"
                    style={{
                        position: 'fixed',
                        ...getTooltipPosition(hoveredFeature.x, hoveredFeature.y),
                        maxWidth: '200px',
                        wordWrap: 'break-word',
                        background: 'var(--bg-glass)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                    }}
                >
                    <div className="font-semibold text-aurora">{hoveredFeature.feature.name}</div>
                    {hoveredFeature.feature.type && (
                        <div className="text-xs opacity-70 capitalize">{hoveredFeature.feature.type}</div>
                    )}
                </div>,
                tooltipElement
            )}
        </div>
    );
};

export default MapDisplay;