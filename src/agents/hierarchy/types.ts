/**
 * Core type contracts for Chronicle's three-tier agent hierarchy.
 *
 * Tier 1 — Steward: routes, decomposes, synthesizes (cross-session awareness)
 * Tier 2 — Council: domain specialists with bounded deep context
 * Tier 3 — Workers: stateless, disposable, parallelizable units
 *
 * See docs/CHRONICLE_NORTH_STAR.md §5 for the full specification.
 */

import type { WorldEvent } from '../../sim/events';

// ---------------------------------------------------------------------------
// Council domains
// ---------------------------------------------------------------------------

/**
 * Named domains owned by Council-tier agents. Extensible via the Registry Rule
 * (North Star §5.2.4) — add new domains only when they have clear authority
 * boundaries and packet interfaces.
 */
export type CouncilDomain = 'world' | 'character' | 'systems';

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

/**
 * How the Steward classifies an incoming player action before dispatching.
 *
 * - deterministic:     A system can resolve this without any LLM (e.g. pure travel)
 * - simple_council:    One council domain owns the action entirely
 * - multi_council:     Multiple council domains are needed
 * - steward_judgment:  Requires Steward-level reasoning (cross-domain, ambiguous)
 */
export type ActionClassification =
  | 'deterministic'
  | 'simple_council'
  | 'multi_council'
  | 'steward_judgment';

// ---------------------------------------------------------------------------
// Council task / result — the Steward ↔ Council contract
// ---------------------------------------------------------------------------

/**
 * A task dispatched from the Steward to a Council agent.
 *
 * The `context` field carries a domain-scoped packet — never the full world.
 * Council agents receive only what they need to make a domain conclusion.
 */
export interface CouncilTask<D extends CouncilDomain = CouncilDomain> {
  taskId: string;
  domain: D;
  /** What the Steward wants from this council agent, in plain language. */
  directive: string;
  /** Bounded context packet scoped to the domain. */
  context: unknown;
  priority: 'required' | 'optional';
}

/**
 * A compressed, decision-ready summary returned from a Council agent
 * to the Steward. Council agents report domain conclusions, not raw world bulk.
 */
export interface CouncilResult<D extends CouncilDomain = CouncilDomain> {
  taskId: string;
  domain: D;
  /** Compressed summary of the domain conclusion. */
  summary: string;
  /** Events the council agent proposes for commitment. */
  proposedEvents: WorldEvent[];
  confidence: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Council agent interface
// ---------------------------------------------------------------------------

/**
 * The polymorphic dispatch contract for all Council-tier agents.
 * Implementations can be objects, classes, or wrapper functions — the codebase
 * favors functions (runGMAgent, runSpecialistAgent, etc.) so implementations
 * will typically be simple objects with an `execute` method.
 */
export interface CouncilAgent<D extends CouncilDomain = CouncilDomain> {
  execute(task: CouncilTask<D>): Promise<CouncilResult<D>>;
}

// ---------------------------------------------------------------------------
// Worker query / packet — the Council ↔ Worker contract
// ---------------------------------------------------------------------------

/**
 * Base input for a worker invocation. Workers are stateless and disposable.
 * Many workers are not LLM agents — they may be database queries, view builders,
 * reducers, validators, or deterministic packet assemblers.
 */
export interface WorkerQuery {
  queryId: string;
  /** Discriminator identifying the worker type (e.g. 'npc_dialogue', 'spine_lookup'). */
  kind: string;
  input: unknown;
}

/**
 * Base output from a worker. Council agents own their workers entirely;
 * the Steward never sees what workers ran.
 */
export interface WorkerPacket {
  queryId: string;
  kind: string;
  output: unknown;
  ok: boolean;
}
