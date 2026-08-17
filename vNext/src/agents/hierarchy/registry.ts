/**
 * CouncilRegistry — typed registry for Council-tier agents.
 *
 * This is the extensibility point from the North Star's "Registry Rule" (§5.2.4):
 * "No additional council domain should be introduced unless it has a clear
 * authority boundary and a clear packet interface."
 */

import type { CouncilDomain, CouncilAgent } from './types';

export class CouncilRegistry {
  private agents = new Map<CouncilDomain, CouncilAgent>();

  register<D extends CouncilDomain>(domain: D, agent: CouncilAgent<D>): void {
    this.agents.set(domain, agent);
  }

  get<D extends CouncilDomain>(domain: D): CouncilAgent<D> | undefined {
    return this.agents.get(domain) as CouncilAgent<D> | undefined;
  }

  has(domain: CouncilDomain): boolean {
    return this.agents.has(domain);
  }

  domains(): CouncilDomain[] {
    return [...this.agents.keys()];
  }
}
