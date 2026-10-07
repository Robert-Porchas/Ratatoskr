import { expect, it } from 'vitest';
import { normalizeWirePlan } from '../src/mcp/wire-plan.js';
import { BrowserPlanSchema } from '../src/protocol.js';
import { flattenSteps } from '../src/workflow-structure.js';

it('normalizes bounded conditions and counts unselected steps', () => {
  const branch = {
    if: 'visible',
    role: 'button',
    name: 'Log in',
    then: [{ do: 'click', role: 'button', name: 'Log in' }],
    else: [{ do: 'url', contains: '/dashboard' }],
  };
  const plan = normalizeWirePlan({ url: 'http://localhost', steps: [branch] });
  expect(flattenSteps(plan.steps)).toHaveLength(3);
  expect(plan.steps[0]).toMatchObject({
    action: 'branch',
    condition: {
      kind: 'visible',
      target: { kind: 'role', role: 'button', name: 'Log in' },
    },
  });
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [{ ...branch, then: [{ ...branch, then: [branch] }] }],
    }),
  ).toThrow('nesting');
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [
        { ...branch, then: Array(300).fill({ do: 'url', contains: '/' }) },
      ],
    }),
  ).toThrow('300');
});

it('rejects branch-dependent variables outside their guaranteed scope', () => {
  const branch = {
    if: 'url',
    contains: '/login',
    then: [{ do: 'extractText', testId: 'id', save: 'id' }],
  };
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [branch, { do: 'url', contains: '${id}' }],
    }),
  ).toThrow('UNDEFINED_VARIABLE');
  expect(
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [
        branch,
        {
          if: 'exists',
          variable: 'id',
          then: [{ do: 'url', contains: '${id}' }],
        },
      ],
    }).outputs,
  ).toEqual(['id']);
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [{ ...branch, do: 'click' }],
    }),
  ).toThrow();
});

it('bounds recursive canonical input before Zod traverses it', () => {
  let nested: unknown = { action: 'assert_url', contains: '/' };
  for (let i = 0; i < 5000; i++)
    nested = {
      action: 'branch',
      condition: { kind: 'url_contains', contains: '/' },
      then: [nested],
    };
  expect(
    BrowserPlanSchema.safeParse({
      startUrl: 'http://localhost',
      steps: [nested],
    }).success,
  ).toBe(false);
});
