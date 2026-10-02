import { describe, expect, it } from 'vitest';
import { BrowserPlanSchema, BrowserTargetSchema } from '../src/protocol.js';
import { EnvironmentValueResolver } from '../src/values.js';

describe('browser plan', () => {
  it('accepts 300 steps and rejects plans beyond that boundary', () => {
    const plan = {
      startUrl: 'http://localhost:3000',
      steps: Array.from({ length: 300 }, () => ({
        action: 'assert_url',
        contains: '/',
      })),
    };
    expect(BrowserPlanSchema.safeParse(plan).success).toBe(true);
    expect(
      BrowserPlanSchema.safeParse({
        ...plan,
        steps: [...plan.steps, plan.steps[0]],
      }).success,
    ).toBe(false);
  });

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
    expect(
      BrowserPlanSchema.safeParse({
        startUrl: 'http://user:password@localhost/',
        steps: [{ action: 'assert_url', contains: '/' }],
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

  it('accepts bounded dialog and popup expectations only on click', () => {
    const base = { startUrl: 'http://local/' };
    const target = { kind: 'role', role: 'button', name: 'Continue' };
    expect(
      BrowserPlanSchema.safeParse({
        ...base,
        steps: [
          {
            action: 'click',
            target,
            expectPopup: true,
            dialog: { type: 'prompt', action: 'accept', valueRef: 'TEST_CODE' },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      BrowserPlanSchema.safeParse({
        ...base,
        steps: [
          {
            action: 'click',
            target,
            dialog: { type: 'prompt', action: 'evaluate', script: 'evil()' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      BrowserPlanSchema.safeParse({
        ...base,
        steps: [{ action: 'navigate', url: 'javascript:alert(1)' }],
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
    const restricted = new EnvironmentValueResolver(
      { TEST_PASSWORD: 'private', PATH: '/sensitive' },
      new Set(['TEST_PASSWORD']),
    );
    expect(restricted.resolve('TEST_PASSWORD')).toBe('private');
    expect(() => restricted.resolve('PATH')).toThrow(
      'Value reference PATH is not set',
    );
  });
});
