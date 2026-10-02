import { expect, it } from 'vitest';
import {
  normalizeWirePlan,
  invalidPlanResult,
  wirePlanJsonSchema,
} from '../src/mcp/wire-plan.js';
import { BrowserPlanSchema } from '../src/protocol.js';

it('normalizes flat locators and automatically requests bounded saved outputs', () => {
  const plan = normalizeWirePlan({
    url: 'http://localhost',
    steps: [
      { do: 'fill', label: 'Name', valueRef: 'TEST_NAME' },
      { do: 'click', role: 'button', name: 'Save' },
      { do: 'extractText', testId: 'order', save: 'order' },
      { do: 'url', contains: '/dashboard' },
    ],
  });
  expect(BrowserPlanSchema.safeParse(plan).success).toBe(true);
  expect(plan.outputs).toEqual(['order']);
  expect(plan.steps[0]).toEqual({
    action: 'fill',
    target: { kind: 'label', label: 'Name' },
    valueRef: 'TEST_NAME',
  });
  expect(plan.steps[2]).toMatchObject({ saveAs: 'order', maxChars: 200 });
  expect(Buffer.byteLength(JSON.stringify(wirePlanJsonSchema))).toBeLessThan(
    2400,
  );
});

it('rejects ambiguous locators, secrets, unsafe operations, unknown fields and duplicate saves', () => {
  const bad = [
    { do: 'click' },
    { do: 'click', label: 'Name', text: 'Name' },
    { do: 'fill', label: 'Name', value: 'secret' },
    { do: 'evaluate', code: 'steal()' },
    { do: 'click', role: 'button', timeoutMs: 999999 },
  ];
  for (const step of bad)
    expect(() =>
      normalizeWirePlan({ url: 'http://localhost', steps: [step] }),
    ).toThrow();
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://secret:password@host/',
  ])
    expect(() =>
      normalizeWirePlan({ url, steps: [{ do: 'visible', text: 'hello' }] }),
    ).toThrow();
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: Array(2).fill({ do: 'extractText', css: 'body', save: 'body' }),
    }),
  ).toThrow();
});

it('bounds validation repair including giant hostile inputs without echoing values', () => {
  for (const input of [
    {},
    { url: 'x', steps: [{ do: 'click', label: 'secret', text: 'secret' }] },
    { url: 'x', steps: Array(1000).fill({ do: 'secret' }) },
  ]) {
    try {
      normalizeWirePlan(input);
      throw new Error('Expected rejection');
    } catch (error) {
      const result = invalidPlanResult(error);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(750);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  }
});
