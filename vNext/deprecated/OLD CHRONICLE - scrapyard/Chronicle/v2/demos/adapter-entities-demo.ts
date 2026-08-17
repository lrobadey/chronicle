import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';

async function main() {
  const gtwg = createPagusClanisGTWG();
  const adapter = createPagusClanisQueryAdapter(gtwg);
  const res = await adapter({ entities: ['Villa Aelia', 'Mansio Vallis'] });
  console.log('Resolved:', res?.map((e: any) => ({ id: e.id, name: e.name })));
}

main().catch((e) => { console.error(e); process.exit(1); });


