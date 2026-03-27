import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GM_TOOL_DEFS } from '../../agents/gm/tools';

describe('GM tool schemas', () => {
  it('closes every object node in strict tool schemas', () => {
    const issues: string[] = [];

    for (const tool of GM_TOOL_DEFS) {
      if (!tool.strict) continue;
      walkSchema(tool.parameters, `${tool.name}.parameters`, issues);
    }

    assert.deepEqual(issues, []);
  });
});

function walkSchema(schema: unknown, path: string, issues: string[]) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  const typeValue = record.type;
  const types = Array.isArray(typeValue)
    ? typeValue.filter((entry): entry is string => typeof entry === 'string')
    : typeof typeValue === 'string'
      ? [typeValue]
      : [];

  if (types.includes('object')) {
    if (record.additionalProperties !== false) {
      issues.push(`${path} must set additionalProperties: false`);
    }
    const properties = record.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const propertyKeys = Object.keys(properties);
      const required = record.required;
      if (!Array.isArray(required)) {
        issues.push(`${path} must define required[] for all object properties`);
      } else {
        const missing = propertyKeys.filter(key => !required.includes(key));
        const extra = required.filter(entry => typeof entry === 'string' && !propertyKeys.includes(entry));
        if (missing.length || extra.length) {
          issues.push(
            `${path} required mismatch missing=[${missing.join(',')}] extra=[${extra.join(',')}]`,
          );
        }
      }
      for (const [key, value] of Object.entries(properties)) {
        walkSchema(value, `${path}.properties.${key}`, issues);
      }
    }
  }

  if (types.includes('array')) {
    walkSchema(record.items, `${path}.items`, issues);
  }

  if (record.items && !types.includes('array')) {
    walkSchema(record.items, `${path}.items`, issues);
  }
}
