import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionStore, TurnRecord } from './types';
import type { WorldState } from '../../sim/state';
import { syncWorldSpine } from '../../sim/spine';
import { IncompatibleSessionError } from '../errors';

const SNAPSHOT_FILE = 'snapshot.json';
const INITIAL_FILE = 'initial.json';
const EVENTS_FILE = 'events.jsonl';
const VNEXT_VERSION_PREFIX = 'vnext-';

export class JsonlSessionStore implements SessionStore {
  constructor(private rootDir: string) {}

  async ensureSession(
    sessionId: string | undefined,
    options: {
      worldId?: string;
      createWorld: (worldId?: string) => WorldState;
    },
  ) {
    const id = sessionId || `session-${randomUUID()}`;
    const dir = this.sessionDir(id);
    const exists = await this.exists(dir);
    if (!exists) {
      await fs.mkdir(dir, { recursive: true });
      const state = options.createWorld(options.worldId);
      this.assertCompatibleState(id, state);
      await this.writeState(path.join(dir, INITIAL_FILE), state);
      await this.writeState(path.join(dir, SNAPSHOT_FILE), state);
      return { sessionId: id, created: true, state };
    }

    const state = await this.loadSession(id);
    if (!state) {
      const fresh = options.createWorld(options.worldId);
      this.assertCompatibleState(id, fresh);
      await fs.rm(path.join(dir, EVENTS_FILE), { force: true });
      await this.writeState(path.join(dir, INITIAL_FILE), fresh);
      await this.writeState(path.join(dir, SNAPSHOT_FILE), fresh);
      return { sessionId: id, created: true, state: fresh };
    }
    return { sessionId: id, created: false, state };
  }

  async loadSession(sessionId: string): Promise<WorldState | null> {
    const dir = this.sessionDir(sessionId);
    if (!(await this.exists(dir))) return null;
    const snapshotPath = path.join(dir, SNAPSHOT_FILE);
    const state = await this.readState(snapshotPath);
    if (!state) return null;
    this.assertCompatibleState(sessionId, state);
    return state;
  }

  async saveSnapshot(sessionId: string, state: WorldState): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    this.assertCompatibleState(sessionId, state);
    const snapshotPath = path.join(dir, SNAPSHOT_FILE);
    await this.writeState(snapshotPath, state);
  }

  async saveInitialState(sessionId: string, state: WorldState): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    this.assertCompatibleState(sessionId, state);
    const initialPath = path.join(dir, INITIAL_FILE);
    await this.writeState(initialPath, state);
  }

  async appendTurn(sessionId: string, record: TurnRecord): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const eventsPath = path.join(dir, EVENTS_FILE);
    await fs.appendFile(eventsPath, JSON.stringify(record) + '\n');
  }

  async loadInitialState(sessionId: string): Promise<WorldState | null> {
    const p = path.join(this.sessionDir(sessionId), INITIAL_FILE);
    const state = await this.readState(p);
    if (!state) return null;
    this.assertCompatibleState(sessionId, state);
    return state;
  }

  async loadTurnLog(sessionId: string): Promise<TurnRecord[]> {
    const p = path.join(this.sessionDir(sessionId), EVENTS_FILE);
    if (!(await this.exists(p))) return [];
    const raw = await fs.readFile(p, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as TurnRecord);
  }

  private sessionDir(sessionId: string) {
    return path.join(this.rootDir, sessionId);
  }

  private async readState(p: string): Promise<WorldState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(p, 'utf-8');
    } catch {
      return null;
    }
    try {
      return normalizeLoadedState(JSON.parse(raw) as WorldState);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  private async writeState(p: string, state: WorldState) {
    await fs.writeFile(p, JSON.stringify(normalizeLoadedState(state), null, 2));
  }

  private assertCompatibleState(sessionId: string, state: WorldState) {
    const version = state?.meta?.version;
    if (typeof version !== 'string' || !version.startsWith(VNEXT_VERSION_PREFIX)) {
      throw new IncompatibleSessionError(sessionId, version);
    }
  }

  private async exists(p: string) {
    try {
      await fs.stat(p);
      return true;
    } catch {
      return false;
    }
  }
}

function normalizeLoadedState(state: WorldState): WorldState {
  // Migrate legacy 'agendas' field to 'directorState'
  const raw = state as unknown as Record<string, unknown>;
  if (!state.directorState && raw.agendas) {
    state.directorState = raw.agendas as WorldState['directorState'];
    delete raw.agendas;
  }

  if (!state.directorState) {
    state.directorState = {
      scene: {
        pressures: [],
        unresolvedBeats: [],
        immediateTensions: [],
      },
      world: {
        activeThreads: [],
        introductionOpportunities: [],
        escalationHooks: [],
      },
      activeThreads: [],
      heldBeats: [],
      pendingWorldEvents: [],
      playerBehaviorPatterns: {},
      capabilityCandidates: [],
    };
  }

  state.directorState.scene = {
    currentFocus: state.directorState.scene?.currentFocus,
    pressures: Array.isArray(state.directorState.scene?.pressures) ? state.directorState.scene.pressures : [],
    unresolvedBeats: Array.isArray(state.directorState.scene?.unresolvedBeats) ? state.directorState.scene.unresolvedBeats : [],
    immediateTensions: Array.isArray(state.directorState.scene?.immediateTensions) ? state.directorState.scene.immediateTensions : [],
  };
  state.directorState.world = {
    activeThreads: Array.isArray(state.directorState.world?.activeThreads) ? state.directorState.world.activeThreads : [],
    introductionOpportunities: Array.isArray(state.directorState.world?.introductionOpportunities) ? state.directorState.world.introductionOpportunities : [],
    escalationHooks: Array.isArray(state.directorState.world?.escalationHooks) ? state.directorState.world.escalationHooks : [],
  };

  if (!Array.isArray(state.directorState.activeThreads)) state.directorState.activeThreads = [];
  if (!Array.isArray(state.directorState.heldBeats)) state.directorState.heldBeats = [];
  if (!Array.isArray(state.directorState.pendingWorldEvents)) state.directorState.pendingWorldEvents = [];
  if (!state.directorState.playerBehaviorPatterns || typeof state.directorState.playerBehaviorPatterns !== 'object') {
    state.directorState.playerBehaviorPatterns = {};
  }
  if (!Array.isArray(state.directorState.capabilityCandidates)) state.directorState.capabilityCandidates = [];

  return syncWorldSpine(state);
}

export { normalizeLoadedState };
