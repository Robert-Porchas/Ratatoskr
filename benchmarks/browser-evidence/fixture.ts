import { createServer } from 'node:http';
import { once } from 'node:events';

export const initialProfile = {
  name: 'Jane Developer',
  email: 'jane@example.test',
};
export const profileError = {
  error: 'INTERNAL_ERROR',
  message: 'Unable to persist profile',
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Profile Settings</title><link rel="icon" href="data:,"></head><body>
<h1>Profile Settings</h1>
<form id="profile">
<label for="name">Name</label><input id="name" name="name" value="Jane Developer">
<label for="email">Email</label><input id="email" name="email" type="email" value="jane@example.test">
<button type="submit">Save</button>
</form>
<p role="status" id="status">No changes saved.</p>
<p>Persisted name: <span data-testid="persisted-name">Jane Developer</span></p>
<script>
document.querySelector('#profile').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#status');
  status.textContent = 'Saving…';
  try {
    const response = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: document.querySelector('#name').value, email: document.querySelector('#email').value })
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('Failed to save profile: ' + result.error);
      status.textContent = 'Unable to save profile.';
      return;
    }
    document.querySelector('[data-testid="persisted-name"]').textContent = result.name;
    status.textContent = 'Profile saved.';
  } catch {
    console.error('Profile request could not complete');
    status.textContent = 'Unable to save profile.';
  }
});
</script></body></html>`;

export interface FixtureRequest {
  method: string;
  path: string;
  body: string;
  status: number;
}

/** Every fixture instance has an independent audit log and immutable persisted state. */
export async function startProfileFixture() {
  const requests: FixtureRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'POST' && path === '/api/profile') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      requests.push({ method: 'POST', path, body, status: 500 });
      response.end(JSON.stringify(profileError));
    } else if (request.method === 'GET' && path === '/profile') {
      requests.push({ method: 'GET', path, body, status: 200 });
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    } else {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/profile`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
