import type { TurnTrace, WebHistorySummary, WebTranscriptHistory, WebTurnCard, WebTurnSummary } from '../engine/session/types';
import type { Telemetry } from '../sim/views/telemetry';

export interface OpeningEntry {
  kind: 'opening';
  id: 'opening';
  text: string;
}

export interface OlderSummaryEntry {
  kind: 'older-summary';
  id: 'older-summary';
  summary: WebHistorySummary;
}

export interface TurnEntry {
  kind: 'turn';
  id: string;
  turn: number;
  atIso: string;
  playerText: string;
  narration: string;
  summary?: WebTurnSummary;
  telemetry?: Telemetry;
  trace?: TurnTrace;
  pending: boolean;
}

export type TranscriptEntry = OpeningEntry | OlderSummaryEntry | TurnEntry;

export function turnEntryId(turn: number): string {
  return `turn-${turn}`;
}

export function buildTurnEntry(card: WebTurnCard): TurnEntry {
  return {
    kind: 'turn',
    id: turnEntryId(card.turn),
    turn: card.turn,
    atIso: card.atIso,
    playerText: card.playerText,
    narration: card.narration,
    summary: card.summary,
    telemetry: card.telemetry,
    trace: card.trace,
    pending: false,
  };
}

export function buildTranscriptEntries(params: {
  initialNarration: string;
  history?: WebTranscriptHistory | null;
}): TranscriptEntry[] {
  const history = params.history;
  if (history?.totalTurns) {
    const entries: TranscriptEntry[] = [];
    if (history.olderSummary) {
      entries.push({
        kind: 'older-summary',
        id: 'older-summary',
        summary: history.olderSummary,
      });
    }
    entries.push(...history.recentTurns.map(buildTurnEntry));
    return entries;
  }

  const opening = params.initialNarration.trim();
  return opening ? [{ kind: 'opening', id: 'opening', text: opening }] : [];
}

export function createPendingTurnEntry(params: {
  turn: number;
  playerText: string;
  atIso: string;
}): TurnEntry {
  return {
    kind: 'turn',
    id: turnEntryId(params.turn),
    turn: params.turn,
    atIso: params.atIso,
    playerText: params.playerText,
    narration: '',
    pending: true,
  };
}

export function replaceTurnEntry(entries: TranscriptEntry[], card: WebTurnCard): TranscriptEntry[] {
  return entries.map(entry => {
    if (entry.kind !== 'turn' || entry.turn !== card.turn) return entry;
    return buildTurnEntry(card);
  });
}

export function updatePendingNarration(entries: TranscriptEntry[], turn: number, narration: string): TranscriptEntry[] {
  return entries.map(entry => {
    if (entry.kind !== 'turn' || entry.turn !== turn) return entry;
    return {
      ...entry,
      narration,
    };
  });
}

export function latestTurnEntry(entries: TranscriptEntry[]): TurnEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === 'turn') return entry;
  }
  return undefined;
}

export function findTurnEntry(entries: TranscriptEntry[], turn: number | null): TurnEntry | undefined {
  if (turn == null) return undefined;
  return entries.find((entry): entry is TurnEntry => entry.kind === 'turn' && entry.turn === turn);
}

export function finalizeTurnCard(payload: {
  turn: number;
  atIso: string;
  playerText: string;
  narration: string;
  summary: WebTurnSummary;
  telemetry?: Telemetry;
  trace?: TurnTrace;
}): WebTurnCard {
  return {
    turn: payload.turn,
    atIso: payload.atIso,
    playerText: payload.playerText,
    narration: payload.narration,
    summary: payload.summary,
    telemetry: payload.telemetry,
    trace: payload.trace,
  };
}
