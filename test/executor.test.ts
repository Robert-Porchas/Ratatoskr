import { describe, expect, it, vi } from 'vitest';
import { executePlan } from '../src/executor.js';
import { RatatoskrError } from '../src/errors.js';
import type { BrowserAdapter } from '../src/browser.js';
import type { EvidenceInput } from '../src/evidence.js';
import type {
  ArtifactReference,
  BrowserPlan,
  WorkflowCondition,
  Evidence,
  RunRecord,
  RunResult,
  StepResult,
} from '../src/protocol.js';
import type { ArtifactStore, RunStore } from '../src/storage.js';
import { EnvironmentValueResolver } from '../src/values.js';
import type { SessionSnapshot, SessionStamp } from '../src/session.js';

class FakeBrowser implements BrowserAdapter {
  private emit: ((event: EvidenceInput) => void) | undefined;
  url = '';
  async start(emit: (event: EvidenceInput) => void): Promise<void> {
    this.emit = emit;
  }
  async stop(): Promise<void> {}
  async navigate(url: string): Promise<void> {
    this.url = url;
    this.emit?.({ type: 'navigation', url });
  }
  async click(): Promise<void> {
    this.emit?.({
      type: 'http',
      method: 'POST',
      path: '/api/login',
      status: 500,
    });
  }
  async fill(): Promise<void> {}
  async press(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async setChecked(): Promise<void> {}
  async hover(): Promise<void> {}
  async upload(): Promise<void> {}
  async download(): Promise<{ fileName: string; mimeType: string }> {
    return { fileName: 'file.txt', mimeType: 'text/plain' };
  }
  async waitFor(): Promise<void> {}
  async text(): Promise<string> {
    return 'Welcome';
  }
  async attribute(): Promise<string | null> {
    return '/receipt';
  }
  async waitForUrlContains(contains: string): Promise<void> {
    if (!this.url.includes(contains)) {
      const error = new Error('Timeout');
      error.name = 'TimeoutError';
      throw error;
    }
  }
  async waitForTextContains(): Promise<void> {}
  async isVisible(): Promise<boolean> {
    return true;
  }
  async currentUrl(): Promise<string> {
    return this.url;
  }
  async screenshot(): Promise<Buffer> {
    return Buffer.from('image');
  }
}

class MissingTargetBrowser extends FakeBrowser {
  override async waitFor(): Promise<void> {
    const error = new Error('Playwright call log');
    error.name = 'TimeoutError';
    throw error;
  }
}

it('recovers a transient wait locally, without adding retry history to success', async () => {
  const browser = new FakeBrowser();
  const wait = vi
    .spyOn(browser, 'waitFor')
    .mockRejectedValueOnce(
      Object.assign(new Error('timing'), { name: 'TimeoutError' }),
    );
  const storage = stores();
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [
        {
          action: 'wait_for',
          target: { kind: 'testId', testId: 'ready' },
          retry: 2,
        },
      ],
    },
    { browser, ...storage, values: new EnvironmentValueResolver({}) },
  );
  expect(result.success).toBe(true);
  expect(wait).toHaveBeenCalledTimes(2);
  expect(storage.saved.steps?.[0]).toMatchObject({
    attempts: 2,
    trace: expect.arrayContaining([
      expect.objectContaining({ event: 'retry' }),
    ]),
  });
  expect(Object.keys(result).sort()).toEqual(['runId', 'success']);
});

it('reloads once and caps retries while refusing HTTP failure and uncertain click replay', async () => {
  const browser = new FakeBrowser();
  const reload = vi.fn(async () => {});
  const wait = vi
    .spyOn(browser, 'waitFor')
    .mockRejectedValueOnce(
      Object.assign(new Error('timing'), { name: 'TimeoutError' }),
    );
  const storage = stores();
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [
        {
          action: 'wait_for',
          target: { kind: 'testId', testId: 'ready' },
          retry: 2,
          recover: 'reloadOnce',
        },
      ],
    },
    {
      browser: Object.assign(browser, { reload }),
      ...storage,
      values: new EnvironmentValueResolver({}),
    },
  );
  expect(result.success).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledTimes(2);
  const failure = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [
        { action: 'click', target: { kind: 'text', text: 'Save' } },
        {
          action: 'wait_for',
          target: { kind: 'testId', testId: 'ready' },
          retry: 3,
        },
      ],
    },
    {
      browser: new MissingTargetBrowser(),
      ...stores(),
      values: new EnvironmentValueResolver({}),
    },
  );
  expect(failure).toMatchObject({ success: false });
  expect(failure).not.toHaveProperty('attempts');
});

it('does not retry uncertain side effects, or assertions', async () => {
  const browser = new FakeBrowser();
  const click = vi
    .spyOn(browser, 'click')
    .mockRejectedValue(
      new RatatoskrError(
        'side_effect_state_unknown',
        'SIDE_EFFECT_STATE_UNKNOWN',
      ),
    );
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [
        {
          action: 'click',
          target: { kind: 'text', text: 'Place order' },
          retry: 3,
        },
      ],
    },
    { browser, ...stores(), values: new EnvironmentValueResolver({}) },
  );
  expect(result).toMatchObject({
    success: false,
    code: 'side_effect_state_unknown',
  });
  expect(click).toHaveBeenCalledTimes(1);
});

it('enforces the overall deadline even for a browser operation that never resolves', async () => {
  const browser = new FakeBrowser();
  vi.spyOn(browser, 'waitFor').mockImplementation(() => new Promise(() => {}));
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      timeoutMs: 1000,
      steps: [
        {
          action: 'wait_for',
          target: { kind: 'text', text: 'Ready' },
          retry: 3,
        },
      ],
    },
    { browser, ...stores(), values: new EnvironmentValueResolver({}) },
  );
  expect(result).toMatchObject({ success: false, code: 'budget_exhausted' });
});

it('retries an interrupted GET navigation once by default', async () => {
  const browser = new FakeBrowser();
  const navigate = vi
    .spyOn(browser, 'navigate')
    .mockRejectedValueOnce(
      new RatatoskrError('navigation_transient', 'Interrupted navigation'),
    );
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [{ action: 'assert_url', contains: 'localhost' }],
    },
    { browser, ...stores(), values: new EnvironmentValueResolver({}) },
  );
  expect(result.success).toBe(true);
  expect(navigate).toHaveBeenCalledTimes(2);
});

it('counts recovery reloads toward the executed-step budget', async () => {
  const browser = new FakeBrowser();
  let calls = 0;
  vi.spyOn(browser, 'waitFor').mockImplementation(async () => {
    if (++calls <= 60 && calls % 2 === 1)
      throw Object.assign(new Error('timing'), { name: 'TimeoutError' });
  });
  const reload = vi.fn(async () => {});
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: Array.from({ length: 300 }, () => ({
        action: 'wait_for' as const,
        target: { kind: 'testId' as const, testId: 'ready' },
        retry: 2,
        recover: 'reloadOnce' as const,
      })),
    },
    {
      browser: Object.assign(browser, { reload }),
      ...stores(),
      values: new EnvironmentValueResolver({}),
    },
  );
  expect(result).toMatchObject({ success: false, code: 'budget_exhausted' });
  expect(reload).toHaveBeenCalledTimes(30);
  expect(calls).toBe(329);
});

it('enforces the global retry cap across otherwise bounded steps', async () => {
  const browser = new FakeBrowser();
  let calls = 0;
  vi.spyOn(browser, 'waitFor').mockImplementation(async () => {
    if (++calls % 2 === 1)
      throw Object.assign(new Error('timing'), { name: 'TimeoutError' });
  });
  const reload = vi.fn(async () => {});
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: Array.from({ length: 100 }, () => ({
        action: 'wait_for' as const,
        target: { kind: 'testId' as const, testId: 'ready' },
        retry: 2,
        recover: 'reloadOnce' as const,
      })),
    },
    {
      browser: Object.assign(browser, { reload }),
      ...stores(),
      values: new EnvironmentValueResolver({}),
    },
  );
  expect(result).toMatchObject({ success: false, code: 'budget_exhausted' });
  expect(reload).toHaveBeenCalledTimes(60);
  expect(calls).toBe(121);
});

it.each([
  { kind: 'visible', target: { kind: 'testId', testId: 'ready' } },
  { kind: 'url_contains', contains: 'localhost' },
  { kind: 'variable_exists', variable: 'id' },
  { kind: 'variable_equals', variable: 'id', equals: '42' },
] satisfies WorkflowCondition[])(
  'evaluates $kind and its negation locally',
  async (condition) => {
    for (const not of [false, true]) {
      const browser = new FakeBrowser();
      const result = await executePlan(
        {
          startUrl: 'http://localhost',
          parameters: { id: '42' },
          steps: [
            {
              action: 'branch',
              condition: { ...condition, not },
              then: [{ action: 'navigate', url: 'http://localhost/yes' }],
              else: [{ action: 'navigate', url: 'http://localhost/no' }],
            },
          ],
        },
        { browser, ...stores(), values: new EnvironmentValueResolver({}) },
      );
      expect(result.success).toBe(true);
      expect(browser.url).toBe(`http://localhost/${not ? 'no' : 'yes'}`);
    }
  },
);

it.each([true, false])(
  'chooses one local branch and retains decisions only in steps (%s)',
  async (visible) => {
    const browser = new FakeBrowser();
    vi.spyOn(browser, 'isVisible').mockResolvedValue(visible);
    const fill = vi.spyOn(browser, 'fill');
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://localhost',
        steps: [
          {
            action: 'branch',
            condition: {
              kind: 'visible',
              target: { kind: 'testId', testId: 'dashboard' },
            },
            then: [],
            else: [
              {
                action: 'fill',
                target: { kind: 'label', label: 'Password' },
                valueRef: 'TEST_PASSWORD',
              },
            ],
          },
          { action: 'assert_url', contains: 'localhost' },
        ],
      },
      {
        browser,
        ...storage,
        values: new EnvironmentValueResolver({ TEST_PASSWORD: 'secret' }),
      },
    );
    expect(result.success).toBe(true);
    expect(fill).toHaveBeenCalledTimes(visible ? 0 : 1);
    expect(storage.saved.steps?.[0]?.branch).toBe(visible);
    expect(JSON.stringify(result)).not.toContain('branch');
    expect(browser.isVisible).toHaveBeenCalledWith(
      { kind: 'testId', testId: 'dashboard' },
      250,
    );
  },
);

it('propagates extracted data locally through fill, locator and navigation fields', async () => {
  const browser = new FakeBrowser();
  const fill = vi.spyOn(browser, 'fill');
  const storage = stores();
  const result = await executePlan(
    {
      startUrl: 'http://localhost',
      steps: [
        {
          action: 'extract_text',
          target: { kind: 'testId', testId: 'id' },
          saveAs: 'id',
        },
        {
          action: 'fill',
          target: { kind: 'label', label: '${id}' },
          value: '${id}',
        },
        { action: 'navigate', url: 'http://localhost/projects/${id}' },
        { action: 'assert_url', contains: '/projects/${id}' },
      ],
      outputs: ['id'],
    },
    { browser, ...storage, values: new EnvironmentValueResolver({}) },
  );
  expect(result).toMatchObject({ success: true, outputs: { id: 'Welcome' } });
  expect(fill).toHaveBeenCalledWith(
    { kind: 'label', label: 'Welcome' },
    'Welcome',
    5000,
  );
  expect(browser.url).toBe('http://localhost/projects/Welcome');
});

function stores(): {
  runs: RunStore;
  artifacts: ArtifactStore;
  saved: {
    record?: RunRecord;
    plan?: BrowserPlan;
    steps?: StepResult[];
    evidence?: Evidence[];
    result?: RunResult;
  };
} {
  const saved: {
    record?: RunRecord;
    plan?: BrowserPlan;
    steps?: StepResult[];
    evidence?: Evidence[];
    result?: RunResult;
  } = {};
  const runs: RunStore = {
    async prepare() {},
    async save(record, plan, steps: StepResult[], evidence, result) {
      Object.assign(saved, { record, plan, steps, evidence, result });
    },
    async load() {
      throw new Error('unused');
    },
  };
  const artifacts: ArtifactStore = {
    async save(runId) {
      return {
        id: 'artifact_test',
        runId,
        type: 'screenshot',
        path: '/tmp/test.png',
        mimeType: 'image/png',
        sizeBytes: 5,
        createdAt: '',
      };
    },
    async reservePath() {
      throw new Error('trace disabled');
    },
    async register(): Promise<ArtifactReference> {
      throw new Error('trace disabled');
    },
    async get(): Promise<ArtifactReference> {
      throw new Error('unused');
    },
    async find(): Promise<ArtifactReference> {
      throw new Error('unused');
    },
    async read(): Promise<Buffer> {
      throw new Error('unused');
    },
    async discard() {},
    async copyTo(): Promise<ArtifactReference> {
      throw new Error('unused');
    },
  };
  return { runs, artifacts, saved };
}

describe('workflow executor', () => {
  it('does not retain oversized extraction/probe text before late session redaction', async () => {
    class LargeTextBrowser extends FakeBrowser {
      override async text(): Promise<string> {
        return 'SECRET'.repeat(4000);
      }
      override async waitForTextContains(): Promise<void> {
        throw Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
      }
    }
    for (const action of ['extract_text', 'assert_text'] as const) {
      const state = stores();
      const result = await executePlan(
        {
          startUrl: 'http://localhost',
          steps: [
            action === 'extract_text'
              ? {
                  action,
                  target: { kind: 'text', text: 'target' },
                  saveAs: 'value',
                }
              : {
                  action,
                  target: { kind: 'text', text: 'target' },
                  contains: 'expected',
                },
          ],
          outputs: action === 'extract_text' ? ['value'] : [],
        },
        {
          browser: new LargeTextBrowser(),
          runs: state.runs,
          artifacts: state.artifacts,
          values: new EnvironmentValueResolver({}),
        },
      );
      expect(result.success).toBe(false);
      expect(JSON.stringify(state.saved)).not.toContain('SECRET');
      expect(result).not.toHaveProperty('actualText');
      expect(result).not.toHaveProperty('outputs');
    }
  });

  it('bounds opt-in authentication-state capture and finalizes a hung capture', async () => {
    class HungStateBrowser extends FakeBrowser {
      dispatch: ((event: EvidenceInput) => void) | undefined;
      override async start(
        emit: (event: EvidenceInput) => void,
      ): Promise<void> {
        await super.start(emit);
        this.dispatch = emit;
      }
      override async click(): Promise<void> {
        this.dispatch?.({
          type: 'http',
          method: 'GET',
          path: '/protected',
          status: 401,
        });
      }
      async sessionSnapshot(
        full: boolean,
        stamp: SessionStamp,
      ): Promise<SessionSnapshot> {
        return {
          ...stamp,
          cookies: [],
          storage: [],
          cookiesComplete: true,
          storageComplete: full,
          storageOrigins: [],
        };
      }
      async authenticationState(): Promise<Buffer> {
        return new Promise(() => undefined);
      }
    }
    const state = stores();
    const result = await executePlan(
      {
        startUrl: 'http://localhost',
        steps: [
          { action: 'click', target: { kind: 'text', text: 'Open' } },
          { action: 'assert_url', contains: '/dashboard' },
        ],
      },
      {
        browser: new HungStateBrowser(),
        runs: state.runs,
        artifacts: state.artifacts,
        values: new EnvironmentValueResolver({}),
        captureAuthState: true,
      },
    );
    expect(result.success).toBe(false);
    expect(state.saved.record?.metrics.session?.sensitiveArtifactsCreated).toBe(
      0,
    );
    expect(state.saved.record?.status).toBe('failed');
    expect(
      state.saved.record?.artifacts.every(
        (artifact) => artifact.type !== 'browser_storage_state',
      ),
    ).toBe(true);
  });

  it('defaults to a 180-second deadline while retaining explicit plan timeouts', async () => {
    let clock = 0;
    const timeouts: Array<number | undefined> = [];
    class BudgetBrowser extends FakeBrowser {
      override async fill(): Promise<void> {
        clock += 5000;
      }
      override async navigate(url: string, timeoutMs?: number): Promise<void> {
        timeouts.push(timeoutMs);
        await super.navigate(url);
      }
    }
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      for (const timeoutMs of [undefined, 120_000]) {
        clock = 0;
        timeouts.length = 0;
        const storage = stores();
        const plan: BrowserPlan = {
          startUrl: 'http://local',
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          steps: [
            ...Array.from({ length: 26 }, () => ({
              action: 'fill' as const,
              target: { kind: 'label' as const, label: 'Name' },
              valueRef: 'TEST_NAME',
            })),
            {
              action: 'navigate',
              url: 'http://local/done',
              timeoutMs: 120_000,
            },
          ],
        };
        const result = await executePlan(plan, {
          browser: new BudgetBrowser(),
          runs: storage.runs,
          artifacts: storage.artifacts,
          values: new EnvironmentValueResolver({ TEST_NAME: 'public name' }),
        });
        expect(result.success).toBe(timeoutMs === undefined);
        expect(timeouts).toEqual(
          timeoutMs === undefined ? [5000, 50_000] : [5000],
        );
      }
    } finally {
      now.mockRestore();
    }
  });

  it('distinguishes absent click targets from present but unactionable controls', async () => {
    for (const exists of [false, true]) {
      class TimeoutBrowser extends FakeBrowser {
        override async click(): Promise<void> {
          throw Object.assign(new Error('private call log'), {
            name: 'TimeoutError',
          });
        }
        async targetExists(): Promise<boolean> {
          return exists;
        }
      }
      const storage = stores();
      const result = await executePlan(
        {
          startUrl: 'http://local',
          steps: [
            {
              action: 'click',
              target: { kind: 'role', role: 'button', name: 'Publish' },
            },
          ],
        },
        {
          browser: new TimeoutBrowser(),
          runs: storage.runs,
          artifacts: storage.artifacts,
          values: new EnvironmentValueResolver({}),
        },
      );
      expect(result).toMatchObject({
        success: false,
        reason: exists
          ? 'Timed out during click'
          : 'Click target not found: button Publish',
      });
      expect(JSON.stringify(result)).not.toContain('private call log');
    }
  });
  it('returns bounded redacted actual text for an assertion failure', async () => {
    class FailedTextBrowser extends FakeBrowser {
      override async waitForTextContains(): Promise<void> {
        const error = new Error('call log');
        error.name = 'TimeoutError';
        throw error;
      }
      override async text(): Promise<string> {
        return 's'.repeat(300);
      }
    }
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://local',
        steps: [
          {
            action: 'fill',
            target: { kind: 'label', label: 'Password' },
            valueRef: 'PASSWORD',
          },
          {
            action: 'assert_text',
            target: { kind: 'testId', testId: 'saved' },
            contains: 'Ready',
          },
        ],
      },
      {
        browser: new FailedTextBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({ PASSWORD: 's'.repeat(300) }),
      },
    );
    expect(result).toMatchObject({ success: false, actualText: '[REDACTED]' });
    expect(JSON.stringify(result)).not.toContain('s'.repeat(20));
  });
  it('returns only completed requested extractions when a later step fails', async () => {
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://local/login',
        outputs: ['before', '__proto__', 'after'],
        steps: [
          {
            action: 'extract_text',
            target: { kind: 'text', text: 'Welcome' },
            saveAs: 'before',
          },
          {
            action: 'extract_text',
            target: { kind: 'text', text: 'Welcome' },
            saveAs: '__proto__',
          },
          { action: 'assert_url', contains: '/dashboard' },
          {
            action: 'extract_text',
            target: { kind: 'text', text: 'Welcome' },
            saveAs: 'after',
          },
        ],
      },
      {
        browser: new FakeBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({}),
      },
    );
    expect(result).toMatchObject({
      success: false,
      outputs: { before: 'Welcome' },
    });
    expect(result.outputs).not.toHaveProperty('after');
    expect(Object.hasOwn(result.outputs ?? {}, '__proto__')).toBe(true);
    expect(result.outputs?.['__proto__']).toBe('Welcome');
  });
  it('returns only a run ID on success', async () => {
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://local/login',
        steps: [{ action: 'assert_url', contains: '/login' }],
      },
      {
        browser: new FakeBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({}),
      },
    );
    expect(result).toEqual({
      success: true,
      runId: expect.stringMatching(/^run_/),
    });
    expect(storage.saved.record?.metrics.stepCount).toBe(1);
  });

  it('correlates an HTTP 500 and never persists the resolved value', async () => {
    const storage = stores();
    const plan: BrowserPlan = {
      startUrl: 'http://local/login',
      steps: [
        {
          action: 'fill',
          target: { kind: 'label', label: 'Password' },
          valueRef: 'PASSWORD',
        },
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Sign in' },
        },
        { action: 'assert_url', contains: '/dashboard' },
      ],
    };
    const result = await executePlan(plan, {
      browser: new FakeBrowser(),
      runs: storage.runs,
      artifacts: storage.artifacts,
      values: new EnvironmentValueResolver({ PASSWORD: 'highly private' }),
    });
    expect(result).toMatchObject({
      success: false,
      failedStep: 2,
      action: 'assert_url',
      relevantErrors: [
        { type: 'http', method: 'POST', path: '/api/login', status: 500 },
      ],
      artifacts: { screenshot: 'artifact_test' },
    });
    expect(JSON.stringify(storage.saved)).not.toContain('highly private');
    expect(storage.saved.record?.metrics).toMatchObject({
      failureCount: 1,
      artifactCount: 1,
      stepCount: 3,
    });
  });

  it('continues only when a failing step permits it', async () => {
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://local/login',
        steps: [
          {
            action: 'fill',
            target: { kind: 'label', label: 'Email' },
            valueRef: 'EMAIL',
          },
          {
            action: 'assert_url',
            contains: '/dashboard',
            continueOnFailure: true,
          },
          { action: 'navigate', url: 'http://local/dashboard' },
          { action: 'assert_url', contains: '/dashboard' },
        ],
      },
      {
        browser: new FakeBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({ EMAIL: 'test@example.test' }),
      },
    );
    expect(result).toMatchObject({ success: false, failedStep: 1 });
    expect(storage.saved.steps?.map((step) => step.status)).toEqual([
      'passed',
      'failed',
      'passed',
      'passed',
    ]);
  });

  it('classifies a missing waited-for target without exposing a raw call log', async () => {
    const storage = stores();
    const result = await executePlan(
      {
        startUrl: 'http://local/login',
        steps: [
          {
            action: 'fill',
            target: { kind: 'label', label: 'Email' },
            valueRef: 'EMAIL',
          },
          { action: 'wait_for', target: { kind: 'text', text: 'Missing' } },
        ],
      },
      {
        browser: new MissingTargetBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({ EMAIL: 'test@example.test' }),
      },
    );
    expect(result).toMatchObject({
      success: false,
      failedStep: 1,
      reason: 'Target did not become visible',
    });
    expect(storage.saved.steps?.[1]?.failure?.kind).toBe('element_not_found');
    expect(JSON.stringify(result)).not.toContain('Playwright call log');
  });

  it('persists a pre-cancelled run as aborted without starting a browser', async () => {
    const storage = stores();
    const signal = new AbortController();
    signal.abort();
    const result = await executePlan(
      {
        startUrl: 'http://local/login',
        steps: [{ action: 'assert_url', contains: '/login' }],
      },
      {
        browser: new FakeBrowser(),
        runs: storage.runs,
        artifacts: storage.artifacts,
        values: new EnvironmentValueResolver({}),
        signal: signal.signal,
      },
    );
    expect(result).toMatchObject({
      success: false,
      failedStep: -1,
      reason: 'Browser workflow was cancelled',
    });
    expect(storage.saved.record?.status).toBe('aborted');
  });
});
