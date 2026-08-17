import { GoogleGenAI, Type } from "@google/genai";
import type { GameState, AIResponse, AIChanges, WeatherState } from '../types';
import { getWeatherActivityEffects, getWeatherActivityImpact, getWeatherTravelMultiplier } from '../reducers/WeatherReducer';

const SYSTEM_INSTRUCTION = `You are 'The Historian', a world-class AI storyteller, database manager, and master cartographer. Your primary goal is to build an emergent world through subtle, direct narration, while meticulously maintaining a structured JSON object representing the game's state, including a 2D map.

**PERSPECTIVE & NAMING**
- Always narrate in third person, referring to the protagonist by the character name generated at start. Never address the reader as “you”.
- Names for people, places, and organizations must feel authentic to the setting. Aim for subtle plausibility, not clever puns or overt thematic wordplay.

**Narrative Style: Direct & Subtle (Michener-like)**
- **Show, Don't Tell:** Describe scenes, actions, and character expressions factually. Avoid interpreting emotions for the player.
- **Factual & Grounded Tone:** Present the world as it is. Focus on sensory details. Let the player draw their own conclusions.
- **Subtlety is Key:** Introduce plot points indirectly. The player should feel like they are discovering the world.
- **Focus on Worldbuilding and grounded realism:** Your narration should consistently build upon the established world state. Focus on grounded realism: every description, consequence, and detail should feel internally consistent with the world’s logic—whether the setting is mundane or fantastical.

**Narrative Momentum:**
- **Always Advance the Story:** Your response must not be static. It must always build on the player's action AND move the story forward in a natural, subtle way. Always advance the story in a way that feels like an interactive novel.
- **Create Forward Pressure:** Subtly introduce a new detail, a new sensory input, an NPC action, a change in the environment, or a minor challenge. The world doesn't just wait for the player; it evolves around them.
- **Encourage Action:** The goal is to make the player feel excited about what's next. Your narration should naturally lead to a point where the player has a clear reason to act again, without being explicitly prompted with "What do you do?".
- **Long-term Story Planning:** Consider how current actions will affect the story 5-10 turns from now. Plant seeds for future developments, maintain story arcs across multiple interactions, and think about the broader narrative consequences of each action.

**Time Management:**
- **Update World Time:** You are in charge of the 'worldTime' field. You MUST advance time realistically based on the player's actions.
- **Realistic Progression:** A short conversation might take 5-10 minutes. Walking across a large area could take 30 minutes or more. Resting for the night should advance the day and time significantly. Be realistic and granular with your timekeeping; track time in minutes when appropriate.
- **Format:** Always include the full date (day, month, year) and time, e.g., "March 3, 1927, 09:00". Keep this format consistent in every update.

**Cartography Rules:**
1.  **Manage the Grid:** You are in charge of a 100x100 grid (0-99 for x and y). (0,0) is the top-left corner.
2.  **Track Player Position:** The player's location is stored in 'mapData.playerX' and 'mapData.playerY'. You MUST update these coordinates when the player moves. "North" is y-1, "South" is y+1, "West" is x-1, "East" is x+1.
3.  **Update Map Features:** When the player discovers a new location (a building, a cave, a landmark), you MUST add it as a new feature to the 'mapData.features' array. Set its 'visitState' to 'current' if the player is at the location, otherwise 'unvisited'.
4.  **Track Visit State:** When the player moves, update the 'visitState' of the location they are leaving to 'visited' and the new location to 'current'. Mark story-critical locations as 'important'.
5.  **Spatial Consistency:** Ensure new features do not overlap existing ones unless logical (e.g., a sign on a building). Be mindful of relative positions mentioned in the text. A new feature "across the street" should have a different y-coordinate separated by a road feature.
6.  **Unique IDs:** Every map feature must have a unique ID. A simple convention is fine (e.g., 'bldg_1', 'road_1').

**Core Responsibilities:**
- **Narrate with Subtlety:** Write in the direct, factual, and subtle style described above.
- **Maintain State & Map:** You will be given the complete current game state. After the player's action, you must return the *entire*, updated game state, including the updated mapData.
- **Categorize Information:** As new information is revealed, add it to the correct category in the game state (lore, people, quests, etc.).
- **Database Management:** Update character and location descriptions as they evolve in the story. Mark quests as completed or remove finished quests. Consolidate duplicate or related entries into single, comprehensive entries. Maintain historical information in the lore array even if current status changes.
- **Ensure Continuity:** Maintain logical consistency. You can remove information that is no longer relevant (completed quests, resolved conflicts) but should retain important historical information in the lore array.

**Output Format:**
You MUST respond with a JSON object containing only the changes needed.
- 'narrative': Your descriptive, in-character response to the player.
- 'changes': Only the specific changes to the game state. Think carefully about what MUST change based on the player's action. If something doesn't need to change, don't include it. Be minimal and efficient.`;

let ai: GoogleGenAI | null = null;
const getAI = () => {
  if (!ai) {
    const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY as string | undefined;
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
};

const mapFeatureSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.STRING, description: "A unique identifier for the map feature (e.g., bldg_1)." },
        type: { type: Type.STRING, enum: ['building', 'road', 'terrain', 'player', 'water', 'forest', 'mountain', 'landmark'], description: "The type of map feature." },
        name: { type: Type.STRING, description: "The name of the feature (e.g., 'The Rusty Flagon Inn')." },
        x: { type: Type.INTEGER, description: "The top-left x-coordinate on the 100x100 grid." },
        y: { type: Type.INTEGER, description: "The top-left y-coordinate on the 100x100 grid." },
        width: { type: Type.INTEGER, description: "The width of the feature in grid units." },
        height: { type: Type.INTEGER, description: "The height of the feature in grid units." },
        visitState: { type: Type.STRING, enum: ['unvisited', 'visited', 'current', 'important'], description: "The visit state of the location. Default to 'unvisited' for new locations." },
    },
    required: ["id", "type", "name", "x", "y", "width", "height"]
};

const mapDataSchema = {
    type: Type.OBJECT,
    properties: {
        playerX: { type: Type.INTEGER, description: "The player's current x-coordinate." },
        playerY: { type: Type.INTEGER, description: "The player's current y-coordinate." },
        gridSize: { type: Type.INTEGER, description: "The size of the map grid (always 100)." },
        features: { type: Type.ARRAY, items: mapFeatureSchema, description: "The list of all discovered map features." },
    },
    required: ["playerX", "playerY", "gridSize", "features"]
};

const gameStateSchema = {
    type: Type.OBJECT,
    properties: {
        worldTime: { type: Type.STRING, description: "The current in-game date and time, always including day, month, year, and time (e.g., 'March 3, 1927, 09:15'). This must be updated realistically with each action." },
        worldState: { type: Type.STRING, description: "A brief, updated summary of the current situation." },
        regions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All known regions." },
        locations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All known locations." },
        people: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All known people." },
        quests: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All active quests and plot hooks." },
        motives: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All known motives of characters/factions." },
        lore: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All known lore and historical facts." },
        mapData: mapDataSchema,
    },
    required: ["worldTime", "worldState", "regions", "locations", "people", "quests", "motives", "lore", "mapData"]
};

const changesSchema = {
    type: Type.OBJECT,
    properties: {
        worldTime: { type: Type.STRING, description: "Updated world time if it changed." },
        worldState: { type: Type.STRING, description: "Updated world state if it changed." },
        regions: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New regions to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Regions to remove." }
            }
        },
        locations: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New locations to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Locations to remove." }
            }
        },
        people: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New people to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "People to remove." }
            }
        },
        quests: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New quests to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Quests to remove." }
            }
        },
        motives: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New motives to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Motives to remove." }
            }
        },
        lore: { 
            type: Type.OBJECT, 
            properties: {
                add: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New lore to add." },
                remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lore to remove." }
            }
        },
        mapData: {
            type: Type.OBJECT,
            properties: {
                playerX: { type: Type.INTEGER, description: "Updated player X coordinate if moved." },
                playerY: { type: Type.INTEGER, description: "Updated player Y coordinate if moved." },
                features: {
                    type: Type.OBJECT,
                    properties: {
                        add: { type: Type.ARRAY, items: mapFeatureSchema, description: "New map features to add." },
                        remove: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Feature IDs to remove." },
                        update: { type: Type.ARRAY, items: mapFeatureSchema, description: "Features to update (e.g., visit state changes)." }
                    }
                }
            }
        }
    }
};

export const sendMessageToAI = async (
  gameState: GameState,
  playerInput: string,
  weatherState?: WeatherState | null,
  onStream?: (chunk: string) => void
): Promise<AIResponse> => {
  const geminiAI = getAI();
  
  // Create weather context only if weather state exists
  const weatherContext = weatherState ? `
    --- WEATHER CONTEXT (USE ONLY IF RELEVANT) ---
    Current weather: ${weatherState.type}, ${weatherState.intensity}/5 intensity, ${weatherState.temperature}°C, ${weatherState.windSpeed} km/h wind
    
    WEATHER EFFECTS CALCULATIONS:
    - Travel speed multiplier: ${Math.round(getWeatherTravelMultiplier(weatherState) * 100)}% of normal
    - Outdoor activities: ${getWeatherActivityEffects(weatherState).outdoorActivities}
    - Visibility: ${getWeatherActivityEffects(weatherState).visibility}
    - Comfort level: ${getWeatherActivityEffects(weatherState).comfort}
    - General effect: ${getWeatherActivityEffects(weatherState).description}
    
    IMPORTANT: Only mention weather effects if they directly impact the player's action or the environment they're observing. 
    Examples of when to mention weather effects:
    - Player is traveling or moving outdoors
    - Player is performing outdoor activities (exploration, combat, farming, fishing)
    - Weather would realistically affect what they can see or do
    - Player explicitly asks about or reacts to weather
    - Weather makes an activity more difficult, dangerous, or impossible
    Do NOT mention weather randomly or in indoor scenes unless it's specifically relevant.
    --- END WEATHER CONTEXT ---
  ` : '';

  const prompt = `
    --- FULL GAME CONTEXT (DO NOT REPEAT TO PLAYER) ---
    ${JSON.stringify(gameState, null, 2)}
    --- END OF CONTEXT ---
    ${weatherContext}

    The player's action is: "${playerInput}"

    Now, generate the next part of the story.
    Return JSON with:
    - "narrative": the prose to show the player
    - "changes": ONLY the minimal fields that actually changed. If nothing changed in a category, omit that category.
    Never include unchanged data.
  `;
  
  let fullResponse = '';
  try {
    const response = await geminiAI.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    narrative: { type: Type.STRING, description: "The descriptive story text to show the player." },
                    changes: changesSchema
                },
                required: ["narrative", "changes"]
            }
        }
    });
    
    for await (const chunk of response) {
      const chunkText = chunk.text;
      fullResponse += chunkText;
      if (onStream) {
        onStream(chunkText);
      }
    }
    
    const parsedResponse = JSON.parse(fullResponse.trim());
    console.log("AI Response:", parsedResponse);
    return parsedResponse;
    
  } catch (error) {
    console.error("Error generating content:", error);
    console.error("Full response was:", fullResponse);
    return {
      narrative: "The records flicker for a moment, and the timeline holds its breath. (An error occurred. Please try again or rephrase your action.)",
      changes: {}
    };
  }
};

export const mergeChangesWithState = (currentState: GameState, changes: AIChanges): GameState => {
  const newState = { ...currentState };

  // Update simple fields
  if (changes.worldTime) newState.worldTime = changes.worldTime;
  if (changes.worldState) newState.worldState = changes.worldState;

  // Update player position
  if (changes.mapData?.playerX !== undefined) newState.mapData.playerX = changes.mapData.playerX;
  if (changes.mapData?.playerY !== undefined) newState.mapData.playerY = changes.mapData.playerY;

  // Update arrays with add/remove operations
  const updateArray = (current: string[], changes?: { add?: string[], remove?: string[] }) => {
    if (!changes) return current;
    let result = [...current];
    if (changes.remove) {
      result = result.filter(item => !changes.remove!.includes(item));
    }
    if (changes.add) {
      result = [...result, ...changes.add];
    }
    return result;
  };

  if (changes.regions) newState.regions = updateArray(newState.regions, changes.regions);
  if (changes.locations) newState.locations = updateArray(newState.locations, changes.locations);
  if (changes.people) newState.people = updateArray(newState.people, changes.people);
  if (changes.quests) newState.quests = updateArray(newState.quests, changes.quests);
  if (changes.motives) newState.motives = updateArray(newState.motives, changes.motives);
  if (changes.lore) newState.lore = updateArray(newState.lore, changes.lore);

  // Update map features
  if (changes.mapData?.features) {
    let features = [...newState.mapData.features];
    
    // Remove features
    if (changes.mapData.features.remove) {
      features = features.filter(f => !changes.mapData!.features!.remove!.includes(f.id));
    }
    
    // Add new features
    if (changes.mapData.features.add) {
      features = [...features, ...changes.mapData.features.add];
    }
    
    // Update existing features
    if (changes.mapData.features.update) {
      features = features.map(f => {
        const update = changes.mapData!.features!.update!.find(u => u.id === f.id);
        return update || f;
      });
    }
    
    newState.mapData.features = features;
  }

  return newState;
};