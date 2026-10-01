import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureServer } from './fixture/server.js';
import { executePlan } from '../src/executor.js';
import { PlaywrightBrowserAdapter } from '../src/playwright-adapter.js';
import { FilesystemArtifactStore, FilesystemRunStore } from '../src/storage.js';
import { EnvironmentValueResolver } from '../src/values.js';
import type { BrowserPlan } from '../src/protocol.js';
import { DirectoryUploadResolver } from '../src/uploads.js';

const server = createFixtureServer();
const root = await mkdtemp(join(tmpdir(), 'ratatoskr-e2e-'));
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const runs = new FilesystemRunStore(root);
  const artifacts = new FilesystemArtifactStore(root);
  const values = new EnvironmentValueResolver({
    TEST_EMAIL: 'demo@example.test',
    TEST_PASSWORD: 'password123',
  });
  const fields: BrowserPlan['steps'] = [
    {
      action: 'fill',
      target: { kind: 'label', label: 'Email' },
      valueRef: 'TEST_EMAIL',
    },
    {
      action: 'fill',
      target: { kind: 'label', label: 'Password' },
      valueRef: 'TEST_PASSWORD',
    },
    {
      action: 'click',
      target: { kind: 'role', role: 'button', name: 'Sign in' },
    },
  ];
  const success = await executePlan(
    {
      startUrl: `${base}/login`,
      steps: [
        ...fields,
        {
          action: 'wait_for',
          target: {
            kind: 'role',
            role: 'heading',
            name: 'Welcome to the dashboard',
          },
        },
        { action: 'assert_url', contains: '/dashboard' },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(success.success, true, JSON.stringify(success));
  const failure = await executePlan(
    {
      startUrl: `${base}/login-failure`,
      steps: [
        ...fields,
        { action: 'wait_for', target: { kind: 'role', role: 'alert' } },
        { action: 'assert_url', contains: '/dashboard' },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(failure.success, false);
  if (!failure.success) {
    assert.equal(failure.failedStep, 4);
    assert(
      failure.relevantErrors.some(
        (error) => error.type === 'http' && error.status === 500,
      ),
    );
    assert(failure.artifacts?.screenshot);
    const artifact = await artifacts.get(
      failure.runId,
      failure.artifacts.screenshot,
    );
    assert(artifact.sizeBytes > 0);
  }
  const stored = await runs.load(failure.runId);
  assert(
    stored.evidence.some(
      (event) => event.type === 'http' && event.status === 500,
    ),
  );
  assert(!JSON.stringify(stored).includes('password123'));
  const form = await executePlan(
    {
      startUrl: `${base}/form`,
      timeoutMs: 15_000,
      steps: [
        {
          action: 'select_option',
          target: { kind: 'label', label: 'State' },
          option: { kind: 'label', label: 'Nevada' },
        },
        { action: 'check', target: { kind: 'label', label: 'Agree' } },
        { action: 'uncheck', target: { kind: 'label', label: 'Subscribe' } },
        {
          action: 'hover',
          target: { kind: 'role', role: 'button', name: 'Menu' },
        },
        {
          action: 'assert_visible',
          target: { kind: 'role', role: 'link', name: 'Receipt menu' },
        },
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Save item' },
        },
        {
          action: 'extract_text',
          target: { kind: 'testId', testId: 'order-number' },
          saveAs: 'orderNumber',
          maxChars: 20,
        },
        {
          action: 'extract_attribute',
          target: { kind: 'testId', testId: 'receipt' },
          attribute: 'href',
          saveAs: 'receiptUrl',
        },
        { action: 'navigate', url: `${base}/delayed-assert` },
        {
          action: 'assert_text',
          target: { kind: 'css', selector: '#status' },
          contains: 'Ready',
          timeoutMs: 2000,
        },
        { action: 'navigate', url: `${base}/delayed-url` },
        { action: 'assert_url', contains: '/dashboard', timeoutMs: 2000 },
      ],
      outputs: ['orderNumber'],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.deepEqual(
    form.success && form.outputs,
    { orderNumber: 'ORD-NV-42' },
    JSON.stringify(form),
  );
  assert.deepEqual((await runs.load(form.runId)).extractions, {
    orderNumber: 'ORD-NV-42',
    receiptUrl: '/receipt/42',
  });
  const uploadDirectory = join(root, 'uploads');
  await mkdir(uploadDirectory);
  await writeFile(join(uploadDirectory, 'fixture.txt'), 'UPLOAD_OK');
  const upload = await executePlan(
    {
      startUrl: `${base}/upload`,
      steps: [
        {
          action: 'upload_file',
          target: { kind: 'label', label: 'File' },
          fileName: 'fixture.txt',
        },
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Verify upload' },
        },
        {
          action: 'assert_text',
          target: { kind: 'testId', testId: 'upload-result' },
          contains: 'fixture.txt:UPLOAD_OK',
        },
      ],
    },
    {
      browser: new PlaywrightBrowserAdapter(),
      runs,
      artifacts,
      values,
      uploads: new DirectoryUploadResolver(uploadDirectory),
    },
  );
  assert.equal(upload.success, true, JSON.stringify(upload));
  const download = await executePlan(
    {
      startUrl: `${base}/download`,
      steps: [
        {
          action: 'expect_download',
          target: { kind: 'role', role: 'button', name: 'Export receipt' },
        },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(download.success, true, JSON.stringify(download));
  if (download.success) {
    assert.equal(download.downloads?.length, 1);
    const artifact = await artifacts.find(download.downloads[0]!);
    assert.equal(artifact.fileName, 'receipt.txt');
    assert.equal(artifact.mimeType, 'text/plain');
    assert.equal(
      (await artifacts.read(artifact.id, 1024)).toString(),
      'RECEIPT-42',
    );
  }
  const dialog = await executePlan(
    {
      startUrl: `${base}/dialog`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Confirm' },
          dialog: { type: 'confirm', action: 'accept' },
        },
        {
          action: 'assert_text',
          target: { kind: 'css', selector: '#result' },
          contains: 'CONFIRMED',
        },
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Prompt' },
          dialog: { type: 'prompt', action: 'accept', valueRef: 'TEST_CODE' },
        },
        {
          action: 'assert_text',
          target: { kind: 'css', selector: '#result' },
          contains: 'CODE_',
        },
      ],
    },
    {
      browser: new PlaywrightBrowserAdapter(),
      runs,
      artifacts,
      values: new EnvironmentValueResolver({ TEST_CODE: 'CODE_OK' }),
    },
  );
  assert.equal(dialog.success, true, JSON.stringify(dialog));
  assert(!JSON.stringify(await runs.load(dialog.runId)).includes('CODE_OK'));
  const unexpectedDialog = await executePlan(
    {
      startUrl: `${base}/dialog`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Unexpected' },
        },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(unexpectedDialog.success, false);
  if (!unexpectedDialog.success)
    assert.match(unexpectedDialog.reason, /Unexpected alert dialog/);
  const popup = await executePlan(
    {
      startUrl: `${base}/popup`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Open dashboard' },
          expectPopup: true,
        },
        { action: 'assert_url', contains: '/dashboard' },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(popup.success, true, JSON.stringify(popup));
  const unexpectedPopup = await executePlan(
    {
      startUrl: `${base}/popup`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Open dashboard' },
        },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(unexpectedPopup.success, false);
  if (!unexpectedPopup.success)
    assert.match(unexpectedPopup.reason, /Unexpected popup/);
  const missing = await executePlan(
    {
      startUrl: `${base}/missing`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Never here' },
          timeoutMs: 250,
        },
      ],
    },
    { browser: new PlaywrightBrowserAdapter(), runs, artifacts, values },
  );
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert(missing.artifacts?.trace);
    assert(
      (await artifacts.get(missing.runId, missing.artifacts.trace)).sizeBytes >
        0,
    );
  }
  process.stdout.write(`${JSON.stringify({ success, failure })}\n`);
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
