import { expect, it } from 'vitest';
import { normalizeWirePlan } from '../src/mcp/wire-plan.js';
import { retryable } from '../src/workflow-retry.js';

it('validates retry and recovery compatibility before browser startup', () => {
  for (const step of [
    { do: 'wait', text: 'Ready', retry: 500 },
    { do: 'fill', label: 'Password', valueRef: 'TEST_PASSWORD', retry: 2 },
    { do: 'click', text: 'Delete', retry: 2, recover: 'reloadOnce' },
    { do: 'click', text: 'Delete', retry: 2, popup: true },
    { do: 'wait', text: 'Ready', retry: 3, recover: 'reloadOnce' },
    { do: 'url', contains: '/ready', retry: 3 },
  ])
    expect(() =>
      normalizeWirePlan({ url: 'http://localhost', steps: [step] }),
    ).toThrow();
  expect(
    normalizeWirePlan({
      url: 'http://localhost',
      steps: [{ do: 'wait', text: 'Ready', retry: 2, recover: 'reloadOnce' }],
    }).steps[0],
  ).toMatchObject({ retry: 2, recover: 'reloadOnce' });
});

it('uses a narrow transient whitelist and vetoes all observed HTTP errors', () => {
  const navigate = {
    action: 'navigate' as const,
    url: 'http://localhost',
    retry: 3,
  };
  expect(retryable(navigate, 'navigation_transient', [])).toBe(true);
  expect(retryable(navigate, 'navigation', [])).toBe(false);
  expect(
    retryable({ action: 'navigate', url: 'http://localhost' }, 'timeout', []),
  ).toBe(false);
  expect(retryable(navigate, 'assertion', [])).toBe(false);
  for (const status of [400, 401, 403, 500])
    expect(
      retryable(navigate, 'timeout', [
        { type: 'http', status, method: 'GET', path: '/', at: 0, stepIndex: 0 },
      ]),
    ).toBe(false);
});
