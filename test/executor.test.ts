import { describe, expect, it } from 'vitest';
import { executePlan } from '../src/executor.js';
import type { BrowserAdapter } from '../src/browser.js';
import type { EvidenceInput } from '../src/evidence.js';
import type {
  ArtifactReference,
  BrowserPlan,
  Evidence,
  RunRecord,
  RunResult,
  StepResult,
} from '../src/protocol.js';
import type { ArtifactStore, RunStore } from '../src/storage.js';
import { EnvironmentValueResolver } from '../src/values.js';

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
  async waitFor(): Promise<void> {}
  async text(): Promise<string> {
    return 'Welcome';
  }
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

function stores(): {
  runs: RunStore;
  artifacts: ArtifactStore;
  saved: {
    record?: RunRecord;
    plan?: BrowserPlan;
    evidence?: Evidence[];
    result?: RunResult;
  };
} {
  const saved: {
    record?: RunRecord;
    plan?: BrowserPlan;
    evidence?: Evidence[];
    result?: RunResult;
  } = {};
  const runs: RunStore = {
    async prepare() {},
    async save(record, plan, _steps: StepResult[], evidence, result) {
      Object.assign(saved, { record, plan, evidence, result });
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
    async copyTo(): Promise<ArtifactReference> {
      throw new Error('unused');
    },
  };
  return { runs, artifacts, saved };
}

describe('workflow executor', () => {
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
});
