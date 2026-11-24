import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PlaywrightBrowserAdapter } from '../src/playwright-adapter.js';
import { DiscoveryOptionsSchema } from '../src/discovery.js';
import type { EvidenceInput } from '../src/evidence.js';

let requests = 0;
const server = createServer((request, response) => {
  requests++;
  response.setHeader('content-type', 'text/html');
  response.setHeader('x-request-id', 'req-123');
  response.setHeader('x-correlation-id', 'invalid secret value');
  response.setHeader(
    'traceparent',
    '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  );
  if (request.url === '/large') {
    response.end(
      `${'<span>item</span>'.repeat(1200)}<button>Late button</button>`,
    );
    return;
  }
  response.end(`<html><body>
    <button>Save profile</button><button>Save profile</button>
    <button disabled>Save disabled</button><button style="display:none">Hidden save</button>
    <a href="/next">Save details</a>
    <label>Email<input type="email" value="PRIVATE_EMAIL"></label>
    <label>Password<input type="password" value="PRIVATE_PASSWORD"></label>
    <input type="hidden" aria-label="Private token" value="PRIVATE_TOKEN">
    <label>Notes<textarea>PRIVATE_TEXTAREA</textarea></label>
    <input aria-label="Echo"><button id="echo">Echo waiting</button>
    <script>document.querySelector('[aria-label="Echo"]').addEventListener('input', event => { document.getElementById('echo').textContent = event.target.value; });</script>
    <button aria-labelledby="custom-name">Other</button><span id="custom-name">Save labelled</span>
    <button aria-label="${'UNOBSERVED_CREDENTIAL_'.repeat(20)}">long name</button>
    <div role="${'X'.repeat(10000)}">oversized role</div>
  </body></html>`);
});
const browser = new PlaywrightBrowserAdapter({
  correlationHeaders: ['x-request-id', 'x-correlation-id', 'traceparent'],
});
const events: EvidenceInput[] = [];
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  await browser.start((event) => events.push(event), false);
  await browser.navigate(`${base}/?token=PRIVATE_QUERY`, 5000);
  const before = requests;
  const result = await browser.discover(
    DiscoveryOptionsSchema.parse({ query: 'save' }),
  );
  assert.equal(result.matches[0]?.name, 'Save profile');
  assert.equal(result.matches[0]?.matchCount, 2);
  assert.deepEqual(result.matches[0]?.locator, {
    kind: 'role',
    role: 'button',
    name: 'Save profile',
  });
  assert(
    result.matches.some(
      (match) => match.name === 'Save disabled' && !match.enabled,
    ),
  );
  assert(
    result.matches.some(
      (match) => match.name === 'Save labelled' && match.matchCount === 1,
    ),
  );
  assert(!result.matches.some((match) => match.name === 'Hidden save'));
  assert.deepEqual(
    result,
    await browser.discover(DiscoveryOptionsSchema.parse({ query: 'save' })),
  );
  assert.equal(requests, before);
  const hidden = await browser.discover(
    DiscoveryOptionsSchema.parse({ query: 'hidden', visibleOnly: false }),
  );
  assert.equal(hidden.matches[0]?.visible, false);
  assert(!hidden.matches[0]?.locator);
  const all = await browser.discover(
    DiscoveryOptionsSchema.parse({ maxResults: 20 }),
  );
  const serialized = JSON.stringify(all);
  assert(!serialized.includes('PRIVATE_'));
  assert(!serialized.includes('UNOBSERVED_CREDENTIAL_'));
  assert(!serialized.includes('X'.repeat(100)));
  assert(
    !all.matches.some(
      (match) => match.name === 'Password' || match.name === 'Private token',
    ),
  );
  assert(Buffer.byteLength(serialized) <= 8000);
  const response = events.find(
    (event) => event.type === 'http' && event.status === 200,
  );
  assert(response && response.type === 'http');
  assert.equal(response.url, `${base}/`);
  assert.equal(response.urlQueryOmitted, true);
  assert.deepEqual(response.correlationIds, {
    'x-request-id': 'req-123',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  });
  assert(!JSON.stringify(events).includes('PRIVATE_QUERY'));
  const longCredential = 'SENSITIVE_'.repeat(30);
  await browser.fill({ kind: 'label', label: 'Echo' }, longCredential, 1000);
  const protectedResult = await browser.discover(
    DiscoveryOptionsSchema.parse({ roles: ['button'], maxResults: 20 }),
  );
  assert(
    !JSON.stringify(protectedResult).includes(longCredential.slice(0, 32)),
  );
  assert(
    protectedResult.matches.some(
      (match) =>
        match.name === '[omitted: incomplete accessible name]' &&
        !match.locator,
    ),
  );
  await browser.navigate(`${base}/large`, 5000);
  const large = await browser.discover(
    DiscoveryOptionsSchema.parse({ query: 'late' }),
  );
  assert(large.truncated);
  assert(large.scanned <= 1000);
  assert.equal(large.matches.length, 0);
  process.stdout.write(
    `${JSON.stringify({ discovery: 'passed', bytes: Buffer.byteLength(serialized), scanned: large.scanned })}\n`,
  );
} finally {
  await browser.stop();
  server.close();
}
