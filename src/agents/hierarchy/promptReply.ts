/**
 * Shared utility for classifying player text as a yes/no reply to a pending prompt.
 * Used by both the turn classifier (turnPlan.ts) and the systems designer agent.
 */

export function classifyPromptReply(playerText: string): 'yes' | 'no' | null {
  const normalized = playerText
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const affirmative = new Set(['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'confirm']);
  const negative = new Set(['no', 'n', 'nope', 'nah', 'cancel', 'stop', 'never mind', 'dont', "don't"]);
  if (affirmative.has(normalized)) return 'yes';
  if (negative.has(normalized)) return 'no';
  return null;
}
