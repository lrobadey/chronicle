import { WeatherState, WeatherType, ClimateZone, PressureSystem, PressureState } from '../types';



// Weather transition based on pressure systems
const PRESSURE_WEATHER_PATTERNS: Record<PressureSystem, Record<WeatherType, number>> = {
  high: {
    clear: 0.8,    // High pressure = clear skies
    rain: 0.1,
    storm: 0.0,
    fog: 0.1,
    snow: 0.0
  },
  low: {
    clear: 0.1,    // Low pressure = stormy weather
    rain: 0.4,
    storm: 0.4,
    fog: 0.1,
    snow: 0.0
  },
  front: {
    clear: 0.0,    // Fronts bring precipitation
    rain: 0.5,
    storm: 0.4,
    fog: 0.1,
    snow: 0.0
  },
  stable: {
    clear: 0.6,    // Stable conditions
    rain: 0.2,
    storm: 0.1,
    fog: 0.1,
    snow: 0.0
  }
};

// Seasonal pressure patterns
const SEASONAL_PRESSURE_PATTERNS: Record<'summer' | 'winter', Record<PressureSystem, number>> = {
  summer: {
    high: 0.4,     // More high pressure in summer
    low: 0.2,
    front: 0.2,
    stable: 0.2
  },
  winter: {
    high: 0.2,     // More low pressure and fronts in winter
    low: 0.3,
    front: 0.3,
    stable: 0.2
  }
};

// Temperature ranges for each weather type (Celsius)
const TEMPERATURE_RANGES: Record<WeatherType, { min: number; max: number }> = {
  clear: { min: 15, max: 25 },
  rain: { min: 8, max: 18 },
  storm: { min: 5, max: 15 },
  fog: { min: 10, max: 20 },
  snow: { min: -5, max: 5 }
};

// Wind speed ranges for each weather type (km/h)
const WIND_SPEED_RANGES: Record<WeatherType, { min: number; max: number }> = {
  clear: { min: 0, max: 15 },
  rain: { min: 5, max: 25 },
  storm: { min: 20, max: 50 },
  fog: { min: 0, max: 10 },
  snow: { min: 0, max: 20 }
};

// Climate-based temperature ranges (Celsius)
const CLIMATE_TEMPERATURES: Record<ClimateZone, {
  summer: { day: number; night: number };
  winter: { day: number; night: number };
}> = {
  tropical: {
    summer: { day: 32, night: 23 },
    winter: { day: 28, night: 20 }
  },
  desert: {
    summer: { day: 40, night: 20 },
    winter: { day: 25, night: 10 }
  },
  temperate: {
    summer: { day: 25, night: 15 },
    winter: { day: 5, night: -5 }
  },
  cold: {
    summer: { day: 15, night: 5 },
    winter: { day: -10, night: -20 }
  },
  arctic: {
    summer: { day: 10, night: 0 },
    winter: { day: -25, night: -35 }
  },
  mediterranean: {
    summer: { day: 30, night: 20 },
    winter: { day: 15, night: 5 }
  },
  high_altitude: {
    summer: { day: 15, night: 5 },
    winter: { day: -5, night: -15 }
  }
};

/**
 * Parses world time to extract season and time of day
 */
function parseWorldTime(worldTime: string): { season: 'summer' | 'winter'; timeOfDay: 'day' | 'night' } {
  try {
    const date = new Date(worldTime);
    const month = date.getMonth(); // 0-11
    const hour = date.getHours(); // 0-23
    
    // Determine season (simplified: Dec-Feb = winter, Jun-Aug = summer, others = summer for simplicity)
    const season = (month >= 11 || month <= 1) ? 'winter' : 'summer';
    
    // Determine time of day (6-18 = day, others = night)
    const timeOfDay = (hour >= 6 && hour <= 18) ? 'day' : 'night';
    
    return { season, timeOfDay };
  } catch (error) {
    // Fallback to temperate defaults if parsing fails
    return { season: 'summer', timeOfDay: 'day' };
  }
}

/**
 * Calculates base temperature based on climate, season, and time of day
 */
function getClimateBaseTemperature(climateZone: ClimateZone, worldTime: string): number {
  const { season, timeOfDay } = parseWorldTime(worldTime);
  const climateData = CLIMATE_TEMPERATURES[climateZone];
  
  if (!climateData) {
    // Fallback to temperate if climate zone is invalid
    return CLIMATE_TEMPERATURES.temperate[season][timeOfDay];
  }
  
  return climateData[season][timeOfDay];
}

/**
 * Gets weather temperature modifier
 */
function getWeatherTemperatureModifier(weatherType: WeatherType): number {
  switch (weatherType) {
    case 'clear': return 0; // No modifier
    case 'rain': return -2; // Cooling effect
    case 'storm': return -5; // Significant cooling
    case 'fog': return -1; // Slight cooling
    case 'snow': return -10; // Major cooling
    default: return 0;
  }
}

/**
 * Simple deterministic random number generator
 * Uses a seed to ensure reproducible results
 */
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  let state = Math.abs(hash);
  
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

/**
 * Generates pressure system based on world time and seed
 */
function generatePressureSystem(worldTime: string, seed: string): PressureState {
  const random = seededRandom(seed);
  const { season } = parseWorldTime(worldTime);
  
  // Get seasonal pressure patterns
  const seasonalPatterns = SEASONAL_PRESSURE_PATTERNS[season];
  const rand = random();
  
  // Select pressure system based on seasonal probabilities
  let cumulative = 0;
  let selectedSystem: PressureSystem = 'stable';
  
  for (const [system, probability] of Object.entries(seasonalPatterns)) {
    cumulative += probability;
    if (rand <= cumulative) {
      selectedSystem = system as PressureSystem;
      break;
    }
  }
  
  // Generate pressure value based on system type
  let pressure: number;
  let intensity: number;
  
  switch (selectedSystem) {
    case 'high':
      pressure = 1013 + (random() * 20) + 10; // 1023-1043 hPa
      intensity = Math.floor(random() * 3) + 2; // 2-4
      break;
    case 'low':
      pressure = 1013 - (random() * 30) - 10; // 973-1003 hPa
      intensity = Math.floor(random() * 3) + 3; // 3-5
      break;
    case 'front':
      pressure = 1013 + (random() * 10) - 5; // 1008-1018 hPa
      intensity = Math.floor(random() * 3) + 2; // 2-4
      break;
    default: // stable
      pressure = 1013 + (random() * 10) - 5; // 1008-1018 hPa
      intensity = Math.floor(random() * 2) + 1; // 1-2
      break;
  }
  
  return {
    system: selectedSystem,
    pressure: Math.round(pressure),
    intensity: intensity
  };
}

/**
 * Selects the next weather type based on pressure system and season
 */
function getNextWeatherType(currentType: WeatherType, worldTime: string, seed: string): WeatherType {
  const random = seededRandom(seed);
  const { season } = parseWorldTime(worldTime);
  
  // Generate pressure system
  const pressureSystem = generatePressureSystem(worldTime, seed);
  const weatherPatterns = PRESSURE_WEATHER_PATTERNS[pressureSystem.system];
  
  const rand = random();
  let cumulative = 0;
  
  for (const [weatherType, probability] of Object.entries(weatherPatterns)) {
    cumulative += probability;
    if (rand <= cumulative) {
      return weatherType as WeatherType;
    }
  }
  
  return currentType; // Fallback
}

/**
 * Generates season-appropriate initial weather based on world time and climate
 */
export function generateInitialWeather(worldTime: string, climateZone: ClimateZone = 'temperate'): WeatherState {
  const { season, timeOfDay } = parseWorldTime(worldTime);
  const baseTemperature = getClimateBaseTemperature(climateZone, worldTime);
  
  // Create a seed based on world time for deterministic initial weather
  const timeSeed = `initial-${worldTime}`;
  const random = seededRandom(timeSeed);
  
  // Season-appropriate weather type probabilities
  const seasonWeatherProbabilities: Record<'summer' | 'winter', Record<WeatherType, number>> = {
    summer: {
      clear: 0.6,
      rain: 0.3,
      storm: 0.1,
      fog: 0.0,
      snow: 0.0
    },
    winter: {
      clear: 0.4,
      rain: 0.2,
      storm: 0.1,
      fog: 0.2,
      snow: 0.1
    }
  };
  
  // Select weather type based on season
  const weatherProbs = seasonWeatherProbabilities[season];
  const rand = random();
  let cumulative = 0;
  let selectedType: WeatherType = 'clear';
  
  for (const [weatherType, probability] of Object.entries(weatherProbs)) {
    cumulative += probability;
    if (rand <= cumulative) {
      selectedType = weatherType as WeatherType;
      break;
    }
  }
  
  // Set appropriate intensity for the weather type
  let intensity = 2; // Default moderate
  if (selectedType === 'storm') {
    intensity = Math.floor(random() * 2) + 3; // 3-4 intensity for storms
  } else if (selectedType === 'snow') {
    intensity = Math.floor(random() * 2) + 2; // 2-3 intensity for snow
  } else {
    intensity = Math.floor(random() * 3) + 1; // 1-3 intensity for others
  }
  
  // Calculate temperature with weather modifier
  const weatherModifier = getWeatherTemperatureModifier(selectedType);
  const temperature = baseTemperature + weatherModifier;
  
  // Set wind speed based on weather type
  const windRange = WIND_SPEED_RANGES[selectedType];
  const windSpeed = windRange.min + (random() * (windRange.max - windRange.min));
  
  const pressure = generatePressureSystem(worldTime, timeSeed);
  return {
    type: selectedType,
    intensity: Math.round(intensity),
    temperature: Math.round(temperature * 10) / 10,
    windSpeed: Math.round(windSpeed),
    lastUpdate: new Date().toISOString(),
    climateZone: climateZone,
    pressure: pressure
  };
}

/**
 * Validates and corrects initial weather to be season-appropriate
 */
export function validateInitialWeather(weather: WeatherState, worldTime: string): WeatherState {
  const { season } = parseWorldTime(worldTime);
  
  // Check for season-inappropriate weather
  const isInappropriate = (
    (season === 'winter' && weather.type === 'clear' && weather.temperature > 15) ||
    (season === 'summer' && weather.type === 'snow') ||
    (season === 'winter' && weather.type === 'clear' && weather.temperature < -20) ||
    (season === 'summer' && weather.type === 'clear' && weather.temperature < 10)
  );
  
  if (isInappropriate) {
    console.log(`Correcting season-inappropriate weather: ${weather.type} at ${weather.temperature}°C in ${season}`);
    return generateInitialWeather(worldTime, weather.climateZone);
  }
  
  return weather;
}

/**
 * Gradually updates pressure over time instead of generating new pressure systems
 * This is the core of Phase 6A - pressure persistence
 */
function updatePressureGradually(
  currentPressure: PressureState | null,
  worldTime: string,
  seed: string
): PressureState {
  const random = seededRandom(seed);
  const { season } = parseWorldTime(worldTime);
  
  // If no current pressure, generate initial pressure
  if (!currentPressure) {
    return generatePressureSystem(worldTime, seed);
  }
  
  // Calculate time elapsed since last update (in hours)
  const lastUpdate = new Date(currentPressure.lastUpdate || worldTime);
  const currentTime = new Date(worldTime);
  const hoursElapsed = (currentTime.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
  
  // If no time has passed, return current pressure unchanged
  if (hoursElapsed <= 0) {
    return currentPressure;
  }
  
  // Determine if pressure system should change (rare events)
  const systemChangeProbability = 0.05; // 5% chance per hour of system change
  const shouldChangeSystem = random() < (systemChangeProbability * hoursElapsed);
  
  let newSystem = currentPressure.system;
  let newChangeRate = currentPressure.changeRate || 0;
  let newTrend = currentPressure.trend || 'stable';
  
  if (shouldChangeSystem) {
    // Generate new pressure system
    const newPressureSystem = generatePressureSystem(worldTime, seed);
    newSystem = newPressureSystem.system;
    
    // Calculate new change rate based on system type
    switch (newSystem) {
      case 'high':
        newChangeRate = 1 + (random() * 2); // 1-3 hPa/hour rising
        newTrend = 'rising';
        break;
      case 'low':
        newChangeRate = -(1 + (random() * 2)); // 1-3 hPa/hour falling
        newTrend = 'falling';
        break;
      case 'front':
        newChangeRate = (random() - 0.5) * 4; // -2 to 2 hPa/hour variable
        newTrend = newChangeRate > 0 ? 'rising' : 'falling';
        break;
      default: // stable
        newChangeRate = (random() - 0.5) * 1; // -0.5 to 0.5 hPa/hour minimal change
        newTrend = Math.abs(newChangeRate) < 0.1 ? 'stable' : (newChangeRate > 0 ? 'rising' : 'falling');
        break;
    }
  } else {
    // Gradually adjust existing change rate (pressure systems evolve)
    const changeRateVariation = (random() - 0.5) * 0.5; // -0.25 to 0.25 hPa/hour
    newChangeRate = (currentPressure.changeRate || 0) + changeRateVariation;
    
    // Update trend based on change rate
    newTrend = Math.abs(newChangeRate) < 0.1 ? 'stable' : (newChangeRate > 0 ? 'rising' : 'falling');
  }
  
  // Apply pressure change over elapsed time
  const pressureChange = newChangeRate * hoursElapsed;
  const newPressure = currentPressure.pressure + pressureChange;
  
  // Ensure pressure stays within realistic bounds
  const clampedPressure = Math.max(950, Math.min(1050, newPressure));
  
  // Update intensity based on pressure system and change rate
  let newIntensity = currentPressure.intensity;
  if (shouldChangeSystem) {
    // Reset intensity when system changes
    newIntensity = Math.floor(random() * 3) + 2; // 2-4
  } else {
    // Gradual intensity changes
    const intensityChange = (random() - 0.5) * 0.5; // -0.25 to 0.25
    newIntensity = Math.max(1, Math.min(5, currentPressure.intensity + intensityChange));
  }
  
  return {
    system: newSystem,
    pressure: Math.round(clampedPressure),
    intensity: Math.round(newIntensity),
    changeRate: Math.round(newChangeRate * 100) / 100, // Round to 2 decimal places
    trend: newTrend,
    lastUpdate: worldTime
  };
}

/**
 * Generates a new weather state based on current weather and time
 */
export function updateWeather(
  currentWeather: WeatherState | null,
  worldTime: string,
  seed: string = 'default'
): WeatherState {
  const now = new Date().toISOString();
  
  // If no current weather, generate season-appropriate initial weather
  if (!currentWeather) {
    return generateInitialWeather(worldTime);
  }
  
  // Create a seed based on world time for deterministic changes
  const timeSeed = `${seed}-${worldTime}`;
  const random = seededRandom(timeSeed);
  
  // Calculate time-based weather change probability
  const { season, timeOfDay } = parseWorldTime(worldTime);
  const date = new Date(worldTime);
  const hour = date.getHours();
  
  // Weather changes more frequently during certain times
  let changeProbability = 0.1; // Base 10% chance per hour
  
  // More changes during transition periods
  if (hour >= 6 && hour <= 8) changeProbability = 0.3; // Morning transitions
  if (hour >= 18 && hour <= 20) changeProbability = 0.3; // Evening transitions
  if (hour >= 12 && hour <= 14) changeProbability = 0.2; // Midday convection
  
  // Seasonal adjustments
  if (season === 'winter') changeProbability *= 1.5; // More variable in winter
  if (timeOfDay === 'night') changeProbability *= 0.7; // Less change at night
  
  // Pressure system influence
  const pressureSystem = generatePressureSystem(worldTime, timeSeed);
  if (pressureSystem.system === 'low') changeProbability *= 1.8; // Low pressure = more change
  if (pressureSystem.system === 'front') changeProbability *= 2.0; // Fronts = rapid change
  if (pressureSystem.system === 'high') changeProbability *= 0.6; // High pressure = stable
  
  const shouldChange = random() < changeProbability;
  
  let newType = currentWeather.type;
  if (shouldChange) {
    newType = getNextWeatherType(currentWeather.type, worldTime, timeSeed);
  }
  
  // Update intensity (gradual changes)
  let newIntensity = currentWeather.intensity;
  if (newType !== currentWeather.type) {
    // Reset intensity when weather type changes
    newIntensity = Math.floor(random() * 3) + 1; // 1-3
  } else {
    // Gradual intensity changes
    const intensityChange = (random() - 0.5) * 2; // -1 to 1
    newIntensity = Math.max(0, Math.min(5, currentWeather.intensity + intensityChange));
  }
  
  // Calculate climate-aware temperature
  const climateZone = currentWeather.climateZone || 'temperate'; // Default to temperate for backward compatibility
  const baseTemperature = getClimateBaseTemperature(climateZone, worldTime);
  const weatherModifier = getWeatherTemperatureModifier(newType);
  const newTemperature = baseTemperature + weatherModifier;
  
  // Update wind speed based on weather type
  const windRange = WIND_SPEED_RANGES[newType];
  const newWindSpeed = windRange.min + (random() * (windRange.max - windRange.min));
  
  return {
    type: newType,
    intensity: Math.round(newIntensity),
    temperature: Math.round(newTemperature * 10) / 10, // Round to 1 decimal
    windSpeed: Math.round(newWindSpeed),
    lastUpdate: now,
    climateZone: climateZone, // Preserve climate zone
    pressure: updatePressureGradually(currentWeather.pressure, worldTime, timeSeed)
  };
}

/**
 * Gets weather description for AI prompts
 */
export function getWeatherDescription(weather: WeatherState): string {
  const intensityDescriptions = {
    0: 'very light',
    1: 'light',
    2: 'moderate',
    3: 'heavy',
    4: 'very heavy',
    5: 'extreme'
  };
  
  const intensityDesc = intensityDescriptions[weather.intensity as keyof typeof intensityDescriptions] || 'moderate';
  
  return `${intensityDesc} ${weather.type} with ${weather.temperature}°C temperature and ${weather.windSpeed} km/h winds`;
}

/**
 * Checks if weather affects travel speed
 */
export function getWeatherTravelMultiplier(weather: WeatherState): number {
  switch (weather.type) {
    case 'clear':
      return 1.0;
    case 'rain':
      return weather.intensity <= 2 ? 0.9 : 0.8;
    case 'storm':
      return weather.intensity <= 3 ? 0.7 : 0.5;
    case 'fog':
      return weather.intensity <= 2 ? 0.8 : 0.6;
    case 'snow':
      return weather.intensity <= 2 ? 0.6 : 0.4;
    default:
      return 1.0;
  }
}

/**
 * Gets weather effects on activities
 */
export function getWeatherActivityEffects(weather: WeatherState): {
  outdoorActivities: 'normal' | 'difficult' | 'dangerous' | 'impossible';
  visibility: 'clear' | 'reduced' | 'poor' | 'very_poor';
  comfort: 'comfortable' | 'uncomfortable' | 'harsh' | 'extreme';
  description: string;
} {
  let outdoorActivities: 'normal' | 'difficult' | 'dangerous' | 'impossible' = 'normal';
  let visibility: 'clear' | 'reduced' | 'poor' | 'very_poor' = 'clear';
  let comfort: 'comfortable' | 'uncomfortable' | 'harsh' | 'extreme' = 'comfortable';
  let description = '';

  switch (weather.type) {
    case 'clear':
      outdoorActivities = 'normal';
      visibility = 'clear';
      comfort = weather.temperature > 30 ? 'uncomfortable' : 'comfortable';
      description = 'Clear conditions allow normal activities.';
      break;
    case 'rain':
      outdoorActivities = weather.intensity <= 2 ? 'normal' : 'difficult';
      visibility = weather.intensity <= 2 ? 'clear' : 'reduced';
      comfort = 'uncomfortable';
      description = `Rain makes outdoor activities ${weather.intensity <= 2 ? 'slightly challenging' : 'more difficult'}.`;
      break;
    case 'storm':
      outdoorActivities = weather.intensity <= 3 ? 'difficult' : 'dangerous';
      visibility = weather.intensity <= 3 ? 'reduced' : 'poor';
      comfort = 'harsh';
      description = `Storm conditions make outdoor activities ${weather.intensity <= 3 ? 'challenging' : 'dangerous'}.`;
      break;
    case 'fog':
      outdoorActivities = weather.intensity <= 2 ? 'normal' : 'difficult';
      visibility = weather.intensity <= 2 ? 'reduced' : 'poor';
      comfort = 'uncomfortable';
      description = `Fog reduces visibility and makes navigation ${weather.intensity <= 2 ? 'challenging' : 'difficult'}.`;
      break;
    case 'snow':
      outdoorActivities = weather.intensity <= 2 ? 'difficult' : 'dangerous';
      visibility = weather.intensity <= 2 ? 'reduced' : 'poor';
      comfort = weather.temperature < -10 ? 'extreme' : 'harsh';
      description = `Snow makes travel ${weather.intensity <= 2 ? 'slow and difficult' : 'dangerous'}.`;
      break;
  }

  return {
    outdoorActivities,
    visibility,
    comfort,
    description
  };
}

/**
 * Gets weather impact on specific activities
 */
export function getWeatherActivityImpact(weather: WeatherState, activity: string): {
  isAffected: boolean;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
} {
  const effects = getWeatherActivityEffects(weather);
  
  // Define activity-specific impacts
  const activityImpacts: Record<string, { affected: boolean; impact: 'positive' | 'negative' | 'neutral'; description: string }> = {
    'travel': {
      affected: weather.type !== 'clear',
      impact: 'negative',
      description: `Travel speed is reduced to ${Math.round(getWeatherTravelMultiplier(weather) * 100)}% of normal.`
    },
    'exploration': {
      affected: effects.visibility !== 'clear',
      impact: 'negative',
      description: `Visibility is ${effects.visibility}, making exploration more challenging.`
    },
    'combat': {
      affected: weather.type === 'storm' || weather.type === 'snow',
      impact: 'negative',
      description: weather.type === 'storm' ? 'Storm conditions make combat more dangerous.' : 'Snow makes combat more difficult.'
    },
    'farming': {
      affected: weather.type === 'rain' || weather.type === 'clear',
      impact: weather.type === 'rain' ? 'positive' : 'neutral',
      description: weather.type === 'rain' ? 'Rain is beneficial for crops.' : 'Clear weather is good for farming.'
    },
    'fishing': {
      affected: weather.type === 'rain' || weather.type === 'storm',
      impact: weather.type === 'rain' ? 'positive' : 'negative',
      description: weather.type === 'rain' ? 'Rain can improve fishing conditions.' : 'Storm makes fishing dangerous.'
    }
  };

  const activityImpact = activityImpacts[activity.toLowerCase()] || {
    affected: false,
    impact: 'neutral' as const,
    description: 'Weather has no significant impact on this activity.'
  };

  return {
    isAffected: activityImpact.affected,
    impact: activityImpact.impact,
    description: activityImpact.description
  };
} 

/**
 * Test function to verify pressure persistence is working
 * This function simulates pressure changes over multiple time steps
 */
// Dev/test helper exports removed from production reducer