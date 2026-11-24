import { expect, it } from 'vitest';
import ts from 'typescript';
import { BrowserPlanSchema, type BrowserPlan } from '../src/protocol.js';
import { exportWorkflow } from '../src/export-workflow.js';

const plan = (steps: BrowserPlan['steps']): BrowserPlan =>
  BrowserPlanSchema.parse({ startUrl: 'http://localhost:3210/profile', steps });

it('exports semantic actions with explicit assertions and matching timeouts', () => {
  const exported = exportWorkflow(
    plan([
      {
        action: 'fill',
        target: { kind: 'label', label: 'Email' },
        valueRef: 'EMAIL',
      },
      {
        action: 'click',
        target: { kind: 'role', role: 'button', name: 'Save' },
      },
      {
        action: 'select_option',
        target: { kind: 'testId', testId: 'kind' },
        option: { kind: 'label', label: 'Work' },
      },
      { action: 'check', target: { kind: 'label', label: 'Agree' } },
      { action: 'uncheck', target: { kind: 'label', label: 'Agree' } },
      {
        action: 'press',
        target: { kind: 'label', label: 'Email' },
        key: 'Tab',
      },
      { action: 'hover', target: { kind: 'text', text: 'Help' } },
      { action: 'wait_for', target: { kind: 'testId', testId: 'ready' } },
      { action: 'assert_visible', target: { kind: 'testId', testId: 'ready' } },
      {
        action: 'assert_text',
        target: { kind: 'testId', testId: 'ready' },
        contains: 'SAVED',
      },
      { action: 'assert_url', contains: '/profile', timeoutMs: 7000 },
      { action: 'navigate', url: 'http://localhost:3210/done' },
    ]),
    { testName: 'profile saved', baseURL: 'http://localhost:4321' },
  );
  expect(exported).toMatchObject({
    ready: true,
    assertionCount: 3,
    requiredEnvironment: ['EMAIL'],
    unsupported: [],
  });
  expect(exported.source).toContain('exact: true');
  expect(exported.source).toContain('timeout: 5000');
  expect(exported.source).toContain('timeout: 7000');
  expect(exported.source).toContain('filter({ hasText: "SAVED" })');
  expect(exported.source).toContain(
    '(url.origin + url.pathname).includes("/profile")',
  );
  expect(exported.source).toContain('http://localhost:4321');
  expect(exported.source).not.toContain('.toContainText(');
  const parsed = ts.transpileModule(exported.source!, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  expect(parsed.diagnostics).toEqual([]);
});

it('escapes code-like text and preserves environment references', () => {
  const hostile = '"); process.exit(9); //';
  const exported = exportWorkflow(
    plan([
      {
        action: 'fill',
        target: { kind: 'css', selector: hostile },
        valueRef: 'PASSWORD',
      },
      { action: 'assert_visible', target: { kind: 'testId', testId: 'done' } },
    ]),
    { testName: hostile },
  );
  expect(exported.source).toContain(JSON.stringify(hostile));
  expect(exported.source).toContain('requiredEnv("PASSWORD")');
  const source = ts.createSourceFile(
    'generated.ts',
    exported.source!,
    ts.ScriptTarget.Latest,
    true,
  );
  expect(source.statements.filter(ts.isExpressionStatement)).toHaveLength(1);
});

it('externalizes parameters instead of embedding their possibly sensitive values', () => {
  const exported = exportWorkflow(
    BrowserPlanSchema.parse({
      startUrl: 'http://localhost/profile',
      parameters: { display: 'private-personal-name' },
      steps: [
        {
          action: 'fill',
          target: { kind: 'label', label: 'Display' },
          value: '$' + '{display}',
        },
        {
          action: 'assert_text',
          target: { kind: 'testId', testId: 'profile' },
          contains: 'Hello $' + '{display}',
        },
      ],
    }),
  );
  expect(exported.ready).toBe(true);
  expect(exported.requiredEnvironment).toEqual(['RATATOSKR_PARAM_display']);
  expect(exported.source).not.toContain('private-personal-name');
  expect(exported.source).toContain('parameter("RATATOSKR_PARAM_display")');
});

it('rejects unsupported operations and policies without partial runnable output', () => {
  const cases: BrowserPlan['steps'][] = [
    [
      {
        action: 'extract_text',
        target: { kind: 'text', text: 'Name' },
        saveAs: 'name',
      },
    ],
    [
      {
        action: 'upload_file',
        target: { kind: 'label', label: 'Upload' },
        fileName: 'x.txt',
      },
    ],
    [{ action: 'expect_download', target: { kind: 'text', text: 'Download' } }],
    [{ action: 'wait_for', target: { kind: 'text', text: 'Ready' }, retry: 2 }],
    [
      {
        action: 'wait_for',
        target: { kind: 'text', text: 'Ready' },
        retry: 2,
        recover: 'reloadOnce',
      },
    ],
    [
      {
        action: 'assert_visible',
        target: { kind: 'text', text: 'Ready' },
        continueOnFailure: true,
      },
    ],
    [
      {
        action: 'click',
        target: { kind: 'text', text: 'Open' },
        expectPopup: true,
      },
    ],
    [
      {
        action: 'click',
        target: { kind: 'text', text: 'Open' },
        dialog: { type: 'confirm', action: 'accept' },
      },
    ],
    [
      {
        action: 'branch',
        condition: { kind: 'visible', target: { kind: 'text', text: 'Ready' } },
        then: [{ action: 'click', target: { kind: 'text', text: 'Ready' } }],
      },
    ],
  ];
  for (const steps of cases) {
    const exported = exportWorkflow(plan(steps));
    expect(exported.ready).toBe(false);
    expect(exported.source).toBeUndefined();
    expect(exported.unsupported.length).toBeGreaterThan(0);
  }
});

it('warns when no assertion is supplied and never invents one', () => {
  const exported = exportWorkflow(
    plan([{ action: 'click', target: { kind: 'text', text: 'Save' } }]),
  );
  expect(exported.ready).toBe(true);
  expect(exported.assertionCount).toBe(0);
  expect(exported.warnings).toEqual([
    'No explicit assertions; limited regression coverage.',
  ]);
  expect(exported.source).not.toContain('await expect(');
});

it('refuses navigation URLs with possibly sensitive queries', () => {
  const input = plan([{ action: 'assert_url', contains: '/profile' }]);
  input.startUrl = 'http://localhost/profile?token=private-token';
  const exported = exportWorkflow(input);
  expect(exported.ready).toBe(false);
  expect(JSON.stringify(exported)).not.toContain('private-token');
  expect(() => exportWorkflow(input, { testName: 'x'.repeat(201) })).toThrow(
    'Test name',
  );
  expect(() =>
    exportWorkflow(input, { baseURL: 'file:///tmp/test' }),
  ).toThrow();
});

it('bounds generated source and unsupported diagnostics', () => {
  const exported = exportWorkflow(
    plan(
      Array.from({ length: 300 }, () => ({
        action: 'assert_text' as const,
        target: { kind: 'testId' as const, testId: 'x'.repeat(400) },
        contains: 'ready',
      })),
    ),
  );
  expect(exported.ready).toBe(false);
  expect(exported.source).toBeUndefined();
  expect(exported.unsupported[0]?.reason).toContain('64000');
  const unsupported = exportWorkflow(
    plan(
      Array.from({ length: 300 }, () => ({
        action: 'expect_download' as const,
        target: { kind: 'text' as const, text: 'Download' },
      })),
    ),
  );
  expect(unsupported.unsupported).toHaveLength(25);
  expect(unsupported.unsupportedCount).toBe(300);
});
