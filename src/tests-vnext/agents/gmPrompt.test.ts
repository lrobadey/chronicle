import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GM_SYSTEM_PROMPT } from '../../agents/gm/prompts';

describe('GM prompt', () => {
  it('tells the GM to resolve immediate accepted offers without stalling', () => {
    assert.match(
      GM_SYSTEM_PROMPT,
      /Resolve immediate accepted offers in the same turn\./,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /Prefer RecordClue for "you learn\/confirm\/notice" outcomes/,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /Prefer TransferItem for simple handoffs or served items\./,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /Never submit Speak with a missing or made-up actorId\./,
    );
  });

  it('tells the GM to immediately reject unrevisionable mechanics statuses and review before proposing events', () => {
    assert.match(
      GM_SYSTEM_PROMPT,
      /worker_contract_failed/,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /no_safe_action/,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /reject it immediately/,
    );
    assert.match(
      GM_SYSTEM_PROMPT,
      /review_mechanics_resolution before you manually propose/,
    );
  });
});
