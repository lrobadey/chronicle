import type {
  MechanicsPendingPromptDraft,
  MechanicsResolutionDraft,
  MechanicsTravelCandidate,
  MechanicsWorkerRequest,
} from './types';

export function resolveDeterministicMechanics(request: MechanicsWorkerRequest): MechanicsResolutionDraft | null {
  const travel = resolveDeterministicTravel(request);
  if (travel) return travel;
  const wait = resolveDeterministicWait(request);
  if (wait) return wait;
  return null;
}

function resolveDeterministicTravel(request: MechanicsWorkerRequest): MechanicsResolutionDraft | null {
  const target = extractTravelTarget(request.playerText);
  if (!target || !request.travelCandidates.length) return null;

  const ranked = rankTravelCandidates(target, request.travelCandidates);
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;

  if (best.score < 0.72) return null;

  if (second && second.score >= 0.72 && best.score - second.score < 0.08) {
    return {
      status: 'ok',
      interpretation: 'clarify',
      summary: 'clarify which destination the player means',
      actions: [],
      pendingPromptDraft: buildClarifyTravelPrompt(best.candidate, second.candidate),
      touchedEntities: [best.candidate.id, second.candidate.id],
      confidence: Math.min(0.7, best.score),
      warnings: ['deterministic_travel_ambiguous'],
    };
  }

  if (best.candidate.requiresConfirm) {
    return {
      status: 'ok',
      interpretation: 'clarify',
      summary: `confirm travel to ${best.candidate.name}`,
      actions: [],
      pendingPromptDraft: {
        kind: 'confirm_travel',
        question: `Travel to ${best.candidate.name}?`,
        options: [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ],
        data: {
          locationId: best.candidate.id,
          estimatedMinutes: best.candidate.estimatedWalkMinutes,
        },
      },
      touchedEntities: [best.candidate.id],
      confidence: best.score,
      warnings: ['deterministic_travel_requires_confirmation'],
    };
  }

  return {
    status: 'ok',
    interpretation: 'travel',
    summary: `travel to ${best.candidate.name}`,
    actions: [{
      type: 'travel',
      actorId: String((request.telemetry as { player?: { id?: string } })?.player?.id || 'player-1'),
      locationId: best.candidate.id,
      pace: 'walk',
      note: `Travel to ${best.candidate.name}.`,
    }],
    pendingPromptDraft: null,
    touchedEntities: [String((request.telemetry as { player?: { id?: string } })?.player?.id || 'player-1'), best.candidate.id],
    confidence: Math.max(0.82, Math.min(0.98, best.score)),
    warnings: [`deterministic_travel_match:${best.alias}`],
  };
}

function resolveDeterministicWait(request: MechanicsWorkerRequest): MechanicsResolutionDraft | null {
  const minutes = extractWaitMinutes(request.playerText);
  if (minutes === null || minutes <= 0 || minutes > 480) return null;

  return {
    status: 'ok',
    interpretation: 'wait',
    summary: `wait ${minutes} minute${minutes === 1 ? '' : 's'}`,
    actions: [{
      type: 'wait',
      minutes,
      note: `Wait ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    }],
    pendingPromptDraft: null,
    touchedEntities: [],
    confidence: 0.95,
    warnings: ['deterministic_wait'],
  };
}

function extractWaitMinutes(text: string): number | null {
  const normalized = normalizeInput(text);
  if (!normalized) return null;

  const patterns = [
    /^(?:i\s+)?(?:wait|rest|stay|stay here|sit|sit here|pause)\s+(?:for\s+)?(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h)\b/,
    /^(?:i\s+)?(?:wait|rest|stay|stay here|sit|sit here|pause)\s+(?:for\s+)?an?\s+hour\b/,
    /^(?:i\s+)?(?:wait|rest|stay|stay here|sit|sit here|pause)\s+(?:for\s+)?half\s+an?\s+hour\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    if (pattern === patterns[2]) return 30;
    if (pattern === patterns[1]) return 60;

    const value = parseInt(match[1]!, 10);
    if (Number.isNaN(value) || value <= 0) return null;
    const unit = match[2]!.toLowerCase();
    if (unit.startsWith('h')) return value * 60;
    return value;
  }

  return null;
}

function buildClarifyTravelPrompt(first: MechanicsTravelCandidate, second: MechanicsTravelCandidate): MechanicsPendingPromptDraft {
  return {
    kind: 'clarify_target',
    question: 'Which destination do you mean?',
    options: [
      { key: first.id, label: first.name },
      { key: second.id, label: second.name },
    ],
    data: {
      subject: 'destination',
    },
  };
}

function extractTravelTarget(text: string): string | null {
  const normalized = normalizeInput(text);
  if (!normalized) return null;

  const rewrites = [
    [/^i got to\s+/, 'i go to '],
    [/^i got\s+/, 'i go to '],
    [/^got to\s+/, 'go to '],
    [/^got\s+/, 'go to '],
  ] as const;

  let working = normalized;
  for (const [pattern, replacement] of rewrites) {
    working = working.replace(pattern, replacement);
  }

  const patterns = [
    /^(?:i\s+)?(?:go|head|walk|move|travel|return)\s+(?:to\s+)?(.+)$/,
    /^(?:i\s+)?make\s+for\s+(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = working.match(pattern);
    if (match?.[1]) {
      const target = match[1].replace(/^(the|a|an)\s+/, '$1 ').trim();
      return target || null;
    }
  }

  return null;
}

function rankTravelCandidates(target: string, candidates: MechanicsTravelCandidate[]) {
  return candidates
    .map(candidate => {
      const aliases = [candidate.name, ...(candidate.aliases || [])]
        .map(normalizeCandidate)
        .filter(Boolean);
      let bestAlias = normalizeCandidate(candidate.name);
      let bestScore = 0;
      for (const alias of aliases) {
        const score = scoreCandidate(target, alias, candidate.distanceMeters);
        if (score > bestScore) {
          bestScore = score;
          bestAlias = alias;
        }
      }
      return { candidate, score: bestScore, alias: bestAlias };
    })
    .sort((left, right) => right.score - left.score || left.candidate.distanceMeters - right.candidate.distanceMeters);
}

function scoreCandidate(targetRaw: string, aliasRaw: string, distanceMeters: number): number {
  const target = normalizeCandidate(targetRaw);
  const alias = normalizeCandidate(aliasRaw);
  if (!target || !alias) return 0;
  if (target === alias) return applyDistanceBonus(1, distanceMeters);
  if (target.includes(alias) || alias.includes(target)) {
    return applyDistanceBonus(0.93, distanceMeters);
  }

  const targetTokens = tokenize(target);
  const aliasTokens = tokenize(alias);
  const tokenScore = tokenOverlap(targetTokens, aliasTokens);
  const editScore = similarity(target, alias);
  const blended = Math.max(editScore, (editScore * 0.55) + (tokenScore * 0.45));
  return applyDistanceBonus(blended, distanceMeters);
}

function normalizeInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCandidate(value: string): string {
  return normalizeInput(value).replace(/^(the|a|an)\s+/, '').trim();
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function tokenOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of left) {
    if (rightSet.has(token)) shared += 1;
  }
  return shared / Math.max(left.length, right.length);
}

function similarity(left: string, right: string): number {
  const distance = levenshtein(left, right);
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return 1 - (distance / maxLength);
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row++) matrix[row]![0] = row;
  for (let col = 0; col < cols; col++) matrix[0]![col] = col;

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost,
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function applyDistanceBonus(score: number, distanceMeters: number): number {
  const bonus = distanceMeters <= 250 ? 0.02 : distanceMeters <= 800 ? 0.01 : 0;
  return Math.min(1, score + bonus);
}
