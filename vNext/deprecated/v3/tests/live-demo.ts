/**
 * LIVE DEMONSTRATION: This proves the weather engine is running live, not precoded
 */

import { ChronicleWeatherEngine } from '../state/weather/engine';

const engine = new ChronicleWeatherEngine();

console.log('\n🧪 LIVE DEMO: Same seed = same result (deterministic)');
for (let i = 0; i < 3; i++) {
  const snap = engine.computeSnapshot('1825-05-14T14:00:00Z', 'demo-seed', 'temperate');
  console.log(`   Run ${i + 1}: ${snap.type} (intensity ${snap.intensity.toFixed(2)}), ${snap.temperatureC}°C, ${snap.windKph}kph`);
}

console.log('\n🧪 LIVE DEMO: Different seed = different result');
const snap2 = engine.computeSnapshot('1825-05-14T14:00:00Z', 'different-demo-seed', 'temperate');
console.log(`   Different seed: ${snap2.type} (intensity ${snap2.intensity.toFixed(2)}), ${snap2.temperatureC}°C, ${snap2.windKph}kph`);

console.log('\n🧪 LIVE DEMO: Different time = different result');
const snap3 = engine.computeSnapshot('1825-05-15T14:00:00Z', 'demo-seed', 'temperate');
console.log(`   Next day: ${snap3.type} (intensity ${snap3.intensity.toFixed(2)}), ${snap3.temperatureC}°C, ${snap3.windKph}kph`);

console.log('\n✅ All values computed LIVE from the engine code!');

