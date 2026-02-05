import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionStore, TurnRecord } from './types';
import type { WorldState } from '../../sim/state';
import { IncompatibleSessionError } from '../errors';

const SNAPSHOT_FILE = 'snapshot.json';
const INITIAL_FILE = 'initial.json';
const EVENTS_FILE = 'events.jsonl';
const VNEXT_VERSION_PREFIX = 'vnext-';

export class JsonlSessionStore implements SessionStore {
  constructor(private rootDir: string) {}

  async ensureSession(sessionId: string | undefined, worldFactory: () => WorldState) {
    const id = sessionId || `session-${randomUUID()}`;
    const dir = this.sessionDir(id);
    const exists = await this.exists(dir);
    if (!exists) {
      await fs.mkdir(dir, { recursive: true });
      const state = worldFactory();
      this.assertCompatibleState(id, state);
      await this.writeState(path.join(dir, INITIAL_FILE), state);
      await this.writeState(path.join(dir, SNAPSHOT_FILE), state);
      return { sessionId: id, created: true, state };
    }

    const state = await this.loadSession(id);
    if (!state) {
      const fresh = worldFactory();
      this.assertCompatibleState(id, fresh);
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
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw) as WorldState;
    } catch {
      return null;
    }
  }

  private async writeState(p: string, state: WorldState) {
    await fs.writeFile(p, JSON.stringify(state, null, 2));
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
