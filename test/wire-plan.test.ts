import { expect, it } from 'vitest';
import {
  normalizeWirePlan,
  invalidPlanResult,
  wirePlanJsonSchema,
  InvalidWirePlan,
} from '../src/mcp/wire-plan.js';
import { BrowserPlanSchema } from '../src/protocol.js';

it('advertises and enforces the 300-step MCP limit', () => {
  const input = {
    url: 'http://localhost',
    steps: Array.from({ length: 300 }, () => ({ do: 'url', contains: '/' })),
  };
  expect(wirePlanJsonSchema.properties.steps.maxItems).toBe(300);
  expect(normalizeWirePlan(input).steps).toHaveLength(300);
  expect(() =>
    normalizeWirePlan({
      ...input,
      steps: [...input.steps, input.steps[0]],
    }),
  ).toThrow('Provide 1–300 steps');
});

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

it('repairs the unambiguous has/text spelling locally, without mutating the input', () => {
  const input = {
    url: 'http://localhost',
    steps: [{ do: 'has', testId: 'name', text: 'Jane' }],
  };
  expect(normalizeWirePlan(input).steps[0]).toEqual({
    action: 'assert_text',
    target: { kind: 'testId', testId: 'name' },
    contains: 'Jane',
  });
  expect(input.steps[0]?.text).toBe('Jane');
});

it('bounds validation repair including giant hostile inputs without echoing values', () => {
  expect(
    Buffer.byteLength(
      JSON.stringify(
        invalidPlanResult(
          new InvalidWirePlan('x'.repeat(1000), 'x'.repeat(10000)),
        ),
      ),
    ),
  ).toBeLessThan(750);
  for (const input of [
    {},
    { url: 'x', steps: [{ do: 'click', label: 'secret', text: 'secret' }] },
    { url: 'x', steps: Array(1000).fill({ do: 'secret' }) },
    {
      url: 'http://localhost',
      steps: [{ do: 'extractText', css: 'body', save: 'x'.repeat(65) }],
    },
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
