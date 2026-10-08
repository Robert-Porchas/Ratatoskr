import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executePlan } from '../src/executor.js';
import { PlaywrightBrowserAdapter } from '../src/playwright-adapter.js';
import { FilesystemArtifactStore, FilesystemRunStore } from '../src/storage.js';
import { EnvironmentValueResolver } from '../src/values.js';

let submissions = 0;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (request.method === 'POST') {
    submissions++;
    response.end('<h1>Submitted</h1>');
  } else
    response.end(
      '<form method="post" action="/submitted"><button>Submit</button></form><button onclick="navigator.sendBeacon(\'/effect\');alert(\'Saved\')">Save with alert</button>',
    );
});
const root = await mkdtemp(join(tmpdir(), 'ratatoskr-idempotency-'));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const startUrl = `http://127.0.0.1:${address.port}/`;
const deps = () => ({
  browser: new PlaywrightBrowserAdapter(),
  runs: new FilesystemRunStore(root),
  artifacts: new FilesystemArtifactStore(root),
  values: new EnvironmentValueResolver({}),
});
try {
  const unavailable = await executePlan(
    {
      startUrl,
      steps: [
        {
          action: 'click',
          target: { kind: 'text', text: 'Missing' },
          timeoutMs: 50,
          retry: 3,
        },
      ],
    },
    deps(),
  );
  assert(!unavailable.success);
  assert.equal(unavailable.attempts, 3);
  assert.equal(submissions, 0);

  const postDocument = await executePlan(
    {
      startUrl,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Submit' },
        },
        {
          action: 'wait_for',
          target: { kind: 'testId', testId: 'missing' },
          timeoutMs: 50,
          retry: 2,
          recover: 'reloadOnce',
        },
      ],
    },
    deps(),
  );
  assert(!postDocument.success);
  assert.equal(postDocument.code, 'side_effect_state_unknown');
  assert.equal(submissions, 1, 'Recovery must not resubmit a POST document');

  const uncertain = await executePlan(
    {
      startUrl,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Save with alert' },
          retry: 3,
        },
      ],
    },
    deps(),
  );
  assert(!uncertain.success);
  assert.equal(uncertain.code, 'side_effect_state_unknown');
  assert.equal(submissions, 2, 'A dispatched click must not be replayed');
  process.stdout.write(
    'Real browser retry bounds, POST reload refusal and uncertain click non-replay passed.\n',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
