import React, { useState, useEffect, useCallback } from 'react';
import { GamePhase, type GameState, type MapData, type WeatherState } from './types';
import { useLocalStorage } from './hooks/useLocalStorage';
import ExperienceSetup from './components/CharacterSetup';
import ChatInterface from './components/ChatInterface';
import WorldStateDisplay from './components/WorldStateDisplay';
import MapDisplay from './components/MapDisplay';
import { GoogleGenAI, Type } from '@google/genai';
import { GMIcon, WorldLoadingIcon } from './components/IconComponents';
import ConstellationAnimation from './components/ConstellationAnimation';
import { updateWeather, validateInitialWeather } from './reducers/WeatherReducer';

const emptyMapData: MapData = {
  playerX: 0,
  playerY: 0,
  gridSize: 100,
  features: [],
};

const emptyGameState: GameState = {
  worldTime: '',
  worldState: '',
  regions: [],
  locations: [],
  people: [],
  quests: [],
  motives: [],
  lore: [],
  mapData: emptyMapData,
};

const App: React.FC = () => {
  const [gamePhase, setGamePhase] = useLocalStorage<GamePhase>('ai-story-phase', GamePhase.SETUP);
  const [gameState, setGameState] = useLocalStorage<GameState | null>('ai-story-state', null);
  const [weatherState, setWeatherState] = useLocalStorage<WeatherState | null>('ai-story-weather', null);
  const [isInitializing, setIsInitializing] = useState(true); // Used for initial load
  const [isGenerating, setIsGenerating] = useState(false); // Used for creating the experience

  // Weather update effect - runs when game state changes
  useEffect(() => {
    if (gameState && gameState.worldTime) {
      const newWeather = updateWeather(weatherState, gameState.worldTime, 'chronicle-seed');
      setWeatherState(newWeather);
    }
  }, [gameState?.worldTime]); // Removed weatherState from dependencies to prevent infinite loop

  useEffect(() => {
    const storedPhase = window.localStorage.getItem('ai-story-phase');
    if (storedPhase) {
      setGamePhase(JSON.parse(storedPhase));
    }
    const storedState = window.localStorage.getItem('ai-story-state');
    if (storedState) {
      setGameState(JSON.parse(storedState));
    }
    const storedWeather = window.localStorage.getItem('ai-story-weather');
    if (storedWeather) {
      setWeatherState(JSON.parse(storedWeather));
    }
    setIsInitializing(false);
  }, []);

  const handleExperienceDefined = useCallback(async (userPrompt: string) => {
    setIsGenerating(true);
    try {
      const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY as string | undefined;
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `The user wants to start an experience with the following theme: "${userPrompt}".
        
        Generate a focused starting world with:
        - One region (town, house, meadow, etc. - the story's primary setting)
        - One protagonist with name, backstory, and personality profile
        - One starting location within that region
        - One clear initial motive/drive for the protagonist
        - One starting quest hook
        
        IMPORTANT: Be creative and avoid formulaic responses. Think critically about the specific theme and create unique, unexpected elements. Don't rely on common tropes or stereotypical names/settings. Each world should feel genuinely different and surprising. Consider unusual time periods, unexpected locations, and creative character names that fit the theme but aren't predictable.
        
        AVOID THESE PATTERNS:
        - Don't use predictable or stereotypical names
        - Don't default to common time periods for the user's concept
        - Don't use generic location names
        - Don't rely on obvious genre tropes
        
        INSTEAD, BE CREATIVE:
        - Choose unexpected but logical time periods
        - Create unique, specific location names
        - Use creative character names that fit the theme
        - Think of unusual but believable settings
        - Surprise the player with unexpected details
        
        Keep the scope intimate and focused. The world should feel lived-in but not overwhelming. Unless stated otherwise, the world should follow real-world logic, without fantasy elements.
        
        Your response must be a JSON object with two fields:
        1. "initialState": An object representing the starting game state. It must contain all game state fields, INCLUDING "mapData", "worldTime", and "weather".
           - For "mapData", generate a starting area on a 100x100 grid. Place the player somewhere logical and add a few relevant surrounding features (buildings, roads, terrain).
           - For "worldTime", set a logical starting date and time for the scene, always including day, month, year, and time (e.g., "March 3, 1927, 08:00").
           - For "weather", create atmospheric weather conditions that fit the setting, time of year, and mood. Consider the location, season, and story tone. Weather should enhance the atmosphere without being overly dramatic.
           - For "climateZone", specify the climate type that best fits your setting: "tropical" (hot, humid), "desert" (hot days, cold nights), "temperate" (four seasons), "cold" (long winters), "arctic" (very cold), "mediterranean" (hot summers, mild winters), or "high_altitude" (cold due to elevation). Choose based on the geographic location and setting of your story.
        2. "openingNarrative": A descriptive, engaging opening paragraph to read to the player that sets the scene, written in a direct, subtle, and factual style. Include a detailed, high-level description of the region and specify what year the story takes place in. Introduce the protagonist and their starting location.`;

      const mapFeatureSchema = {
          type: Type.OBJECT,
          properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['building', 'road', 'terrain', 'player'] },
              name: { type: Type.STRING },
              x: { type: Type.INTEGER },
              y: { type: Type.INTEGER },
              width: { type: Type.INTEGER },
              height: { type: Type.INTEGER },
          },
          required: ["id", "type", "name", "x", "y", "width", "height"]
      };

      const mapDataSchema = {
          type: Type.OBJECT,
          properties: {
              playerX: { type: Type.INTEGER },
              playerY: { type: Type.INTEGER },
              gridSize: { type: Type.INTEGER },
              features: { type: Type.ARRAY, items: mapFeatureSchema },
          },
          required: ["playerX", "playerY", "gridSize", "features"]
      };

      const weatherSchema = {
          type: Type.OBJECT,
          properties: {
              type: { type: Type.STRING, enum: ['clear', 'rain', 'storm', 'fog', 'snow'] },
              intensity: { type: Type.INTEGER, minimum: 0, maximum: 5 },
              temperature: { type: Type.NUMBER },
              windSpeed: { type: Type.INTEGER },
              lastUpdate: { type: Type.STRING },
          },
          required: ["type", "intensity", "temperature", "windSpeed", "lastUpdate"]
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { 
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    initialState: {
                        type: Type.OBJECT,
                        properties: {
                            worldTime: { type: Type.STRING },
                            worldState: { type: Type.STRING },
                            regions: { type: Type.ARRAY, items: { type: Type.STRING } },
                            locations: { type: Type.ARRAY, items: { type: Type.STRING } },
                            people: { type: Type.ARRAY, items: { type: Type.STRING } },
                            quests: { type: Type.ARRAY, items: { type: Type.STRING } },
                            motives: { type: Type.ARRAY, items: { type: Type.STRING } },
                            lore: { type: Type.ARRAY, items: { type: Type.STRING } },
                            mapData: mapDataSchema,
                            weather: weatherSchema,
                            climateZone: { type: Type.STRING, enum: ['tropical', 'desert', 'temperate', 'cold', 'arctic', 'mediterranean', 'high_altitude'] },
                        },
                        required: ["worldTime", "worldState", "regions", "locations", "people", "quests", "motives", "lore", "mapData"]
                    },
                    openingNarrative: { type: Type.STRING }
                },
                required: ["initialState", "openingNarrative"]
            }
        }
      });

      const result = JSON.parse(response.text);
      
      // Set the game state
      setGameState(result.initialState);
      
      // Set initial weather if provided by AI, otherwise let the weather reducer handle it
      if (result.initialState.weather) {
        // Validate and correct the AI's initial weather to be season-appropriate
        const validatedWeather = validateInitialWeather(result.initialState.weather, result.initialState.worldTime);
        setWeatherState(validatedWeather);
      }
      
      // Set climate zone if provided by AI
      if (result.initialState.climateZone) {
        // Update the game state to include climate zone
        const updatedGameState = {
          ...result.initialState,
          climateZone: result.initialState.climateZone
        };
        setGameState(updatedGameState);
      }
      
      window.localStorage.setItem('ai-story-opening-narrative', result.openingNarrative);
      setGamePhase(GamePhase.PLAYING);

    } catch (error) {
      console.error("Error creating initial scenario:", error);
      alert("There was an error generating the story. Please try refining your idea and submitting again.");
    } finally {
      setIsGenerating(false);
    }
  }, [setGamePhase, setGameState]);

  const handleGameStateUpdate = useCallback((newState: GameState) => {
    setGameState(newState);
  }, [setGameState]);
  
  const resetGame = () => {
    if (window.confirm("Are you sure you want to end this adventure and start a new one? All progress will be lost.")) {
      localStorage.removeItem('ai-story-phase');
      localStorage.removeItem('ai-story-state');
      localStorage.removeItem('ai-story-weather');
      localStorage.removeItem('ai-story-opening-narrative');
      localStorage.removeItem('ai-story-messages');
      window.location.reload();
    }
  };

  if (isInitializing) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
        <GMIcon className="w-24 h-24" style={{ color: 'var(--aurora)' }} />
        <p className="mt-4 text-xl tracking-wider">The Historian is consulting the records...</p>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
        <div className="text-center">
          <div className="w-32 h-32 mx-auto mb-8">
            <ConstellationAnimation className="w-full h-full" />
          </div>
          <h2 className="text-3xl font-bold mb-4 gradient-text">Creating Your World</h2>
          <p className="text-lg mb-2" style={{ color: 'var(--text-muted)' }}>The Historian is crafting your adventure...</p>
        </div>
      </div>
    );
  }

  const params = new URLSearchParams(window.location.search);
  const simpleChat = params.get('simpleChat') === '1';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {(gamePhase === GamePhase.PLAYING || simpleChat) && (
        <header className="app-header p-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold gradient-text tracking-wider app-title">Chronicle</h1>
          <button
            onClick={resetGame}
            className="btn btn-danger"
          >
            New Adventure
          </button>
        </header>
      )}
      <main>
        {gamePhase === GamePhase.SETUP || !gameState ? (
          simpleChat ? (
            <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto h-[calc(100vh-81px)]">
              <div className="h-full">
                <ChatInterface
                  initialGameState={gameState || emptyGameState}
                  onGameStateUpdate={handleGameStateUpdate}
                  weatherState={weatherState}
                  agentEndpointUrl={(import.meta as any).env?.VITE_AGENT_ENDPOINT || 'http://localhost:8787/agent'}
                />
              </div>
            </div>
          ) : (
            <ExperienceSetup onCreate={handleExperienceDefined} />
          )
        ) : (
          (() => {
            if (simpleChat) {
              const endpoint = (import.meta as any).env?.VITE_AGENT_ENDPOINT || 'http://localhost:8787/agent';
              return (
                <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto h-[calc(100vh-81px)]">
                  <div className="h-full">
                    <ChatInterface
                      initialGameState={gameState}
                      onGameStateUpdate={handleGameStateUpdate}
                      weatherState={weatherState}
                      agentEndpointUrl={endpoint}
                    />
                  </div>
                </div>
              );
            }
            return (
              <div className="flex flex-col lg:flex-row gap-4 p-4 max-w-7xl mx-auto h-[calc(100vh-81px)]">
                <div className="flex flex-col flex-grow lg:w-2/3 xl:w-3/4 h-full gap-4">
                    <div className="h-1/2 lg:h-2/5 card p-2">
                        <MapDisplay mapData={gameState.mapData} weatherState={weatherState} />
                    </div>
                    <div className="h-1/2 lg:h-3/5">
                        <ChatInterface initialGameState={gameState} onGameStateUpdate={handleGameStateUpdate} weatherState={weatherState} />
                    </div>
                </div>
                <WorldStateDisplay gameState={gameState} weatherState={weatherState} />
              </div>
            );
          })()
        )}
      </main>
    </div>
  );
};

export default App;