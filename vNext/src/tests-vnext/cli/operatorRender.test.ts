import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  renderCurrentThoughts,
  renderTraceTimeline,
  type RenderOptions,
} from '../../cli/operatorRender';
import type { TraceTimelineEvent } from '../../cli/operatorEngine';

const summaryView: RenderOptions = { view: 'summary' };

describe('operator renderer reasoning summaries', () => {
  it('groups current thought headings by agent in turn order', () => {
    const rendered = renderCurrentThoughts([
      {
        agent: 'steward',
        reasoningHeadings: ['Reading the scene', 'Choosing the route'],
      },
      {
        agent: 'systems_designer',
        reasoningHeadings: ['Checking local mechanics'],
      },
      {
        agent: 'steward',
        reasoningHeadings: ['Closing the turn'],
      },
    ]);

    assert.equal(rendered, [
      '## Current Thoughts',
      'steward: Reading the scene; Choosing the route; Closing the turn',
      'systems_designer: Checking local mechanics',
    ].join('\n'));
  });

  it('omits current thoughts when no reasoning headings exist', () => {
    assert.equal(renderCurrentThoughts([
      { agent: 'steward', reasoningHeadings: [] },
      { agent: 'narrator' },
    ]), null);
  });

  it('renders reasoning headings on non-raw trace timeline entries', () => {
    const timeline: TraceTimelineEvent[] = [
      {
        index: 0,
        phase: 'llm',
        kind: 'llm_call',
        label: 'steward',
        summary: 'steward response status=completed toolCalls=1',
        reasoningHeadings: ['Reading the scene', 'Choosing the route'],
        data: { agent: 'steward' },
      },
    ];

    const rendered = renderTraceTimeline(timeline, summaryView);

    assert.ok(rendered.includes('## Trace'));
    assert.ok(rendered.includes('01. [llm] llm_call :: steward response status=completed toolCalls=1'));
    assert.ok(rendered.includes('  reasoning: Reading the scene; Choosing the route'));
    assert.ok(!rendered.includes('"agent": "steward"'));
  });

  it('keeps raw trace data as the source of raw reasoning detail', () => {
    const timeline: TraceTimelineEvent[] = [
      {
        index: 0,
        phase: 'llm',
        kind: 'llm_call',
        label: 'steward',
        summary: 'steward response status=completed toolCalls=1',
        reasoningHeadings: ['Reading the scene'],
        data: { agent: 'steward', reasoningHeadings: ['Reading the scene'] },
      },
    ];

    const rendered = renderTraceTimeline(timeline, { view: 'raw', raw: true });

    assert.ok(rendered.includes('"reasoningHeadings": ['));
    assert.ok(!rendered.includes('  reasoning: Reading the scene'));
  });
});
