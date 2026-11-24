import { describe, expect, it } from 'vitest';
import { junitReport, runExitCode } from '../src/reporting.js';
import type { RunResult } from '../src/protocol.js';

describe('CI reporting', () => {
  it('escapes untrusted XML and distinguishes assertions from infrastructure', () => {
    const result: RunResult = {
      success: false,
      runId: 'run_test',
      action: 'assert_text',
      failedStep: 0,
      reason: '<script a="x">&\'\u0001',
      relevantErrors: [],
    };
    const xml = junitReport(result);
    expect(xml).toContain('failures="1" errors="0"');
    expect(xml).toContain('&lt;script a=&quot;x&quot;&gt;&amp;&apos;');
    expect(xml).not.toContain('\u0001');
    expect(junitReport(result, true)).toContain('failures="0" errors="1"');
    expect(junitReport(result, true)).toContain('<error ');
    expect(runExitCode(result)).toBe(1);
    expect(runExitCode(result, true)).toBe(3);
    expect(runExitCode({ success: true, runId: 'run_ok' })).toBe(0);
  });
});
