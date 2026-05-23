import { describe, it, expect } from 'vitest';
import { parseSuite } from '../../../src/chat-eval/suite';

describe('parseSuite', () => {
  it('parses a well-formed YAML suite', () => {
    const yaml = `
name: melbourne_bike_train_v1
prompts:
  - id: simple_short
    prompt: From Fitzroy to Hawthorn by bike
    origin: {lat: -37.8, lon: 144.97}
  - id: arriveby
    prompt: "Get me to Box Hill by 7am Sunday"
expect_keywords:
  simple_short: [Fitzroy, Hawthorn]
`;
    const suite = parseSuite(yaml);
    expect(suite.name).toBe('melbourne_bike_train_v1');
    expect(suite.prompts).toHaveLength(2);
    expect(suite.prompts[0].id).toBe('simple_short');
    expect(suite.prompts[0].origin).toEqual({ lat: -37.8, lon: 144.97 });
    expect(suite.expect_keywords?.simple_short).toEqual(['Fitzroy', 'Hawthorn']);
  });

  it('rejects a suite with duplicate prompt ids', () => {
    const yaml = `name: x\nprompts:\n  - id: a\n    prompt: p1\n  - id: a\n    prompt: p2\n`;
    expect(() => parseSuite(yaml)).toThrow(/duplicate prompt id/i);
  });

  it('rejects empty prompts list', () => {
    expect(() => parseSuite('name: x\nprompts: []\n')).toThrow(/at least one prompt/i);
  });
});
