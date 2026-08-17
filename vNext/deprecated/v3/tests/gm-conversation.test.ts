import { formatConversationHistory, type GMConversationTurn } from '../agents/gmConversation';

function expect(actual: string, needle: string) {
  if (!actual.includes(needle)) {
    throw new Error(`Expected output to include "${needle}". Got:\n${actual}`);
  }
}

function expectEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function testEmptyHistory() {
  const output = formatConversationHistory(undefined);
  expectEqual(output, '');
  console.log('   ✓ handles empty history');
}

function testLimitsAndSanitization() {
  const history: GMConversationTurn[] = [];
  for (let i = 0; i < 7; i++) {
    history.push({
      playerInput: `player line ${i} ${'x'.repeat(500)}`,
      gmOutput: `gm line ${i} ${'y'.repeat(500)}`,
    });
  }
  const output = formatConversationHistory(history, 5);
  expect(output, 'Turn 3');
  expect(output, 'Turn 7');
  expect(output, '(most recent last)');
  expect(output, '...');
  console.log('   ✓ limits and truncation work');
}

function testCustomLimit() {
  const history: GMConversationTurn[] = [
    { playerInput: 'a', gmOutput: 'b' },
    { playerInput: 'c', gmOutput: 'd' },
  ];
  const output = formatConversationHistory(history, 1);
  expect(output, 'Turn 2');
  if (output.includes('Turn 1')) {
    throw new Error('Expected only last turn in output');
  }
  console.log('   ✓ custom limit respected');
}

function main() {
  console.log('🧪  Testing GM conversation formatting');
  testEmptyHistory();
  testLimitsAndSanitization();
  testCustomLimit();
  console.log('✅  Conversation formatting tests passed');
}

main();
