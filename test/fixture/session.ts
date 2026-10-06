import { createServer } from 'node:http';

export const FAKE_SESSION_SECRET = 'SUPER_SECRET_SESSION_VALUE_123';
export const FAKE_STORAGE_SECRET = 'SUPER_SECRET_STORAGE_VALUE_456';
export type AuthScenario =
  'success' | 'missing' | 'loss' | 'scope' | 'unrelated';
export const authScenarios: AuthScenario[] = [
  'success',
  'missing',
  'loss',
  'scope',
  'unrelated',
];

/** Deliberately fake auth. Every context starts clean; no shared server session. */
export function createSessionFixture() {
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const scenario = url.searchParams.get('scenario') ?? 'success';
    response.setHeader('Content-Type', 'application/json');
    if (
      url.pathname === '/api/auth/account' ||
      url.pathname === '/api/auth/settings'
    ) {
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        status: 200,
      });
      response.end(
        JSON.stringify({
          message: url.pathname.endsWith('account')
            ? 'Account active'
            : 'Settings ready',
        }),
      );
      return;
    }
    if (url.pathname === '/api/auth/login') {
      const suffix =
        scenario === 'missing'
          ? '; Domain=not-this-host.invalid'
          : scenario === 'scope'
            ? '; Path=/restricted'
            : '; Path=/';
      response.setHeader(
        'Set-Cookie',
        `session=${FAKE_SESSION_SECRET}${suffix}; HttpOnly; SameSite=Lax`,
      );
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        status: 200,
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/auth/logout') {
      response.setHeader(
        'Set-Cookie',
        'session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
      );
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        status: 200,
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/auth/protected') {
      const authorized =
        request.headers.cookie?.includes(`session=${FAKE_SESSION_SECRET}`) ===
        true;
      response.statusCode = authorized ? 200 : 401;
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        status: response.statusCode,
      });
      response.end(
        JSON.stringify(
          authorized
            ? { message: 'Dashboard ready' }
            : { error: 'UNAUTHENTICATED' },
        ),
      );
      return;
    }
    if (url.pathname === '/auth') {
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        status: 200,
      });
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Session test</title></head><body>
        <h1>Account</h1><button id="login">Sign in</button><button id="logout">Sign out</button><button id="open">Open dashboard</button>
        <button id="details">Account details</button><button id="settings">Settings</button>
        <p role="status">Signed out</p><p data-testid="dashboard">Dashboard closed</p>
        <p data-testid="detail"></p><p data-testid="settings"></p><p data-testid="echo"></p>
        <script>
          const scenario = ${JSON.stringify(scenario)};
          document.querySelector('#login').onclick = async () => {
            const reply = await fetch('/api/auth/login?scenario=' + scenario, { method: 'POST' });
            if (reply.ok) {
              localStorage.setItem('auth_state', '${FAKE_STORAGE_SECRET}');
              sessionStorage.setItem('tab_state', '${FAKE_STORAGE_SECRET}');
              document.querySelector('[role=status]').textContent = 'Sign-in accepted';
            }
          };
          document.querySelector('#logout').onclick = async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            localStorage.removeItem('auth_state'); sessionStorage.removeItem('tab_state');
            document.querySelector('[role=status]').textContent = 'Signed out';
          };
          document.querySelector('#open').onclick = async () => {
            const reply = await fetch('/api/auth/protected');
            const body = await reply.json();
            if (!reply.ok) console.error('Dashboard request failed: ' + body.error);
            document.querySelector('[data-testid=dashboard]').textContent = reply.ok ? body.message : 'Unable to open dashboard';
          };
          document.querySelector('#details').onclick = async () => document.querySelector('[data-testid=detail]').textContent = (await (await fetch('/api/auth/account')).json()).message;
          document.querySelector('#settings').onclick = async () => document.querySelector('[data-testid=settings]').textContent = (await (await fetch('/api/auth/settings')).json()).message;
          // Exercise late discovery / credential echoes; not part of benchmark flows.
          if (${JSON.stringify(url.searchParams.has('echo'))}) {
            localStorage.setItem('echo_secret', '${FAKE_SESSION_SECRET}');
            console.error('storage echo: ${FAKE_SESSION_SECRET}');
            document.querySelector('[data-testid=echo]').textContent = '${FAKE_SESSION_SECRET}';
          }
        </script></body></html>`);
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  return { server, requests };
}
