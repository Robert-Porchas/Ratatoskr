import { expect, it } from 'vitest';
import { BrowserPlanSchema } from '../src/protocol.js';
import { normalizeWirePlan } from '../src/mcp/wire-plan.js';
import { interpolateStep } from '../src/workflow-variables.js';

it('validates data flow, namespaces and bounded templates before execution', () => {
  const plan = normalizeWirePlan({
    url: 'http://localhost',
    steps: [
      { do: 'extractText', testId: 'id', save: 'id' },
      { do: 'fill', label: 'Project', value: '${id}' },
      { do: 'navigate', url: 'http://localhost/projects/${id}' },
    ],
  });
  expect(
    interpolateStep(plan.steps[2]!, new Map([['id', '42']])),
  ).toMatchObject({ url: 'http://localhost/projects/42' });
  expect(() => interpolateStep(plan.steps[1]!, new Map())).toThrow(
    'UNDEFINED_VARIABLE',
  );
  for (const steps of [
    [{ do: 'url', contains: '${missing}' }],
    [{ do: 'url', contains: '${invalid-name}' }],
    [
      { do: 'extractText', testId: 'id', save: 'id' },
      { do: 'click', css: '#${id}' },
    ],
    [
      { do: 'extractText', testId: 'id', save: 'TEST_PASSWORD' },
      { do: 'fill', label: 'Password', valueRef: 'TEST_PASSWORD' },
    ],
    [
      {
        do: 'fill',
        label: 'Password',
        value: '${id}',
        valueRef: 'TEST_PASSWORD',
      },
    ],
  ])
    expect(() =>
      normalizeWirePlan({ url: 'http://localhost', steps }),
    ).toThrow();
  expect(
    BrowserPlanSchema.safeParse({ ...plan, parameters: { id: '42' } }).success,
  ).toBe(false);
});

it('does not recursively interpret extracted data and forbids path/action interpolation', () => {
  expect(
    interpolateStep(
      {
        action: 'assert_text',
        target: { kind: 'text', text: '${id}' },
        contains: '${id}',
      },
      new Map([['id', '${other}']]),
    ),
  ).toMatchObject({ contains: '${other}' });
  expect(() =>
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [
        { do: 'extractAttribute', testId: 'x', save: 'id', attribute: '${id}' },
      ],
    }),
  ).toThrow();
});
