import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractReasoningHeadings } from '../../agents/llm/openaiClient';

describe('reasoning summary heading extraction', () => {
  it('extracts the first bold markdown heading from a reasoning summary', () => {
    assert.deepEqual(extractReasoningHeadings([
      {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: '**Choosing the route**\n\nThe body should stay private.' },
        ],
      },
    ]), ['Choosing the route']);
  });

  it('extracts one heading per summary text and ignores the body', () => {
    assert.deepEqual(extractReasoningHeadings([
      {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: '**Reading the room**\n\nPrivate body.' },
          { type: 'summary_text', text: '**Selecting a tool**\n\nPrivate body.' },
        ],
      },
    ]), ['Reading the room', 'Selecting a tool']);
  });

  it('ignores summaries without bold headings', () => {
    assert.deepEqual(extractReasoningHeadings([
      {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: 'No markdown heading here.' },
        ],
      },
    ]), []);
  });

  it('ignores malformed and non-reasoning output', () => {
    assert.deepEqual(extractReasoningHeadings([
      { type: 'message', summary: [{ type: 'summary_text', text: '**Nope**' }] },
      { type: 'reasoning', summary: 'not an array' },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 7 }] },
    ]), []);
  });
});
