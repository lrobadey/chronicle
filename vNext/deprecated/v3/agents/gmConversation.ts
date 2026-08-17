export interface GMConversationTurn {
  playerInput: string;
  gmOutput: string;
}

function sanitize(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '(empty)';
  const limit = 280;
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit - 3) + '...';
}

export function formatConversationHistory(history: GMConversationTurn[] | undefined, maxTurns = 5): string {
  if (!history || !history.length || maxTurns <= 0) return '';
  const slice = history.slice(-maxTurns);
  const startIndex = history.length - slice.length;

  const blocks = slice.map((turn, idx) => {
    const turnNumber = startIndex + idx + 1;
    const player = sanitize(turn.playerInput ?? '');
    const gm = sanitize(turn.gmOutput ?? '');
    return `Turn ${turnNumber}:\n- Player: ${player}\n- Narration: ${gm}`;
  });

  return `Recent conversation (most recent last):\n${blocks.join('\n\n')}`;
}
