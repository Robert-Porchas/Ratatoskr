import { describe, expect, it } from 'vitest';
import { BrowserPlanSchema, BrowserTargetSchema } from '../src/protocol.js';
import { EnvironmentValueResolver } from '../src/values.js';

describe('browser plan', () => {
  it('accepts a typed workflow with references', () => {
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://localhost:3000',
        steps: [
          {
            action: 'fill',
            target: { kind: 'label', label: 'Password' },
            valueRef: 'TEST_PASSWORD',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects executable or plaintext fill instructions', () => {
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://localhost:3000',
        steps: [
          {
            action: 'fill',
            target: { kind: 'css', selector: '#pw' },
            value: 'secret',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://localhost:3000',
        steps: [{ action: 'evaluate', script: 'alert(1)' }],
      }).success,
    ).toBe(false);
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'file:///tmp/index.html',
        steps: [{ action: 'assert_url', contains: 'index' }],
      }).success,
    ).toBe(false);
  });

  it('validates every target strategy', () => {
    for (const target of [
      { kind: 'role', role: 'button', name: 'Go' },
      { kind: 'label', label: 'Email' },
      { kind: 'text', text: 'Hello' },
      { kind: 'testId', testId: 'submit' },
      { kind: 'css', selector: '#submit' },
    ]) {
      expect(BrowserTargetSchema.safeParse(target).success).toBe(true);
    }
    expect(
      BrowserTargetSchema.safeParse({ kind: 'role', name: 'Go' }).success,
    ).toBe(false);
  });

  it('requires unique bounded extraction names and explicit outputs', () => {
    const steps = [
      {
        action: 'extract_text',
        target: { kind: 'testId', testId: 'order' },
        saveAs: 'orderNumber',
        maxChars: 20,
      },
    ];
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://local/',
        steps,
        outputs: ['orderNumber'],
      }).success,
    ).toBe(true);
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://local/',
        steps: [...steps, ...steps],
      }).success,
    ).toBe(false);
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://local/',
        steps,
        outputs: ['missing'],
      }).success,
    ).toBe(false);
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://local/',
        steps: [{ ...steps[0], maxChars: 2001 }],
      }).success,
    ).toBe(false);
  });
});

describe('environment resolver', () => {
  it('resolves locally and rejects missing values', () => {
    const resolver = new EnvironmentValueResolver({ TEST_PASSWORD: 'private' });
    expect(resolver.resolve('TEST_PASSWORD')).toBe('private');
    expect(() => resolver.resolve('MISSING')).toThrow(
      'Value reference MISSING is not set',
    );
  });
});
