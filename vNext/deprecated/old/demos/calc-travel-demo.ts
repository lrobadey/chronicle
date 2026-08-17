// calc-travel-demo.ts - Minimal demo: distance + ETA between two locations
import { createPagusClanisGTWG } from '../data/PagusClanis.js';
import { calculateDistanceAndEta } from '../travel/Distance.js';

async function main() {
  const gtwg = createPagusClanisGTWG();

  const from = 'villa-aelia';
  const to = 'mansio-vallis';

  const result = calculateDistanceAndEta(gtwg as any, from, to);
  if (!result.ok) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  console.log('Distance/ETA calculation');
  console.log('From:', from);
  console.log('To:', to);
  console.log('Scale (m/unit):', result.scaleMetersPerUnit);
  console.log('Distance (units):', result.distanceUnits.toFixed(2));
  console.log('Distance (meters):', result.distanceMeters);
  console.log('ETA (minutes @ ~5 km/h):', result.etaMinutes);
}

main().catch((e) => { console.error(e); process.exit(1); });


