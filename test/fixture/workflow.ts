import { createServer } from 'node:http';
import { once } from 'node:events';

export type WorkflowScenario =
  | 'variables'
  | 'login-required'
  | 'login-existing'
  | 'transient'
  | 'server-failure'
  | 'generated'
  | 'complex';

export async function startWorkflowFixture(scenario: WorkflowScenario) {
  const requests: Array<{
    method: string;
    path: string;
    status: number;
    body: string;
  }> = [];
  const projects = new Map<string, { name: string; description: string }>();
  let sequence = 0,
    gateVisits = 0,
    loginCount = 0;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const audit = { method: request.method ?? 'GET', path, status: 200, body };
    requests.push(audit);
    response.setHeader('Content-Type', 'text/html');
    const send = (html: string, status = 200) => {
      audit.status = status;
      response.statusCode = status;
      response.end(html);
    };
    const authenticated =
      request.headers.cookie?.includes('workflow_session=fixture-auth-token') ||
      scenario === 'login-existing';
    if (path === '/api/login' && request.method === 'POST') {
      loginCount++;
      response.setHeader(
        'Set-Cookie',
        'workflow_session=fixture-auth-token; Path=/; HttpOnly; SameSite=Lax',
      );
      send('OK');
      return;
    }
    if (path === '/api/projects' && request.method === 'POST') {
      if (scenario === 'server-failure') {
        send('INTERNAL_ERROR', 500);
        return;
      }
      const data = JSON.parse(body) as { name: string };
      const id = `P-${++sequence}`;
      projects.set(id, { name: data.name, description: '' });
      response.setHeader('Content-Type', 'application/json');
      send(JSON.stringify({ id }));
      return;
    }
    if (path.startsWith('/api/projects/') && request.method === 'POST') {
      const project = projects.get(path.split('/').at(-1)!);
      if (!project) {
        send('missing', 404);
        return;
      }
      project.description = (
        JSON.parse(body) as { description: string }
      ).description;
      send('OK');
      return;
    }
    const form = `<h1 data-testid="dashboard">Projects</h1><label>Project name<input id="name"></label><button id="create">Create project</button><p data-testid="project-id"></p><p role="alert" hidden></p><script>
      document.querySelector('#create').onclick = async () => {
        const response = await fetch('/api/projects',{method:'POST',body:JSON.stringify({name:document.querySelector('#name').value})});
        if (!response.ok) { const alert=document.querySelector('[role=alert]');alert.textContent='INTERNAL_ERROR';alert.hidden=false;console.error('INTERNAL_ERROR');return; }
        document.querySelector('[data-testid=project-id]').textContent=(await response.json()).id;
      };</script>`;
    if (path === '/entry') {
      if (
        scenario === 'login-required' ||
        scenario === 'login-existing' ||
        scenario === 'complex'
      ) {
        if (!authenticated) {
          send(
            `<h1>Log in</h1><label>Email<input id="email"></label><label>Password<input id="password" type="password"></label><button onclick="fetch('/api/login',{method:'POST'}).then(() => location.href='/entry')">Sign in</button>`,
          );
          return;
        }
      }
      send(form);
      return;
    }
    if (path === '/gate') {
      gateVisits++;
      send(
        gateVisits > 1
          ? '<h1 data-testid="ready">Ready</h1>'
          : '<h1>Temporarily unavailable</h1>',
      );
      return;
    }
    if (path.startsWith('/projects/')) {
      const id = path.split('/').at(-1)!,
        project = projects.get(id);
      if (!project) {
        send('Project missing', 404);
        return;
      }
      gateVisits++;
      const ready = scenario !== 'complex' || gateVisits > 1;
      send(
        `<h1 data-testid="project-name">${project.name.replace(/[<&"]/g, '')}</h1><p data-testid="project-id">${id}</p>${ready ? '<p data-testid="ready">Ready</p>' : ''}<label>Description<input id="description"></label><button onclick="fetch('/api/projects/${id}',{method:'POST',body:JSON.stringify({description:document.querySelector('#description').value})}).then(() => location.reload())">Save details</button><p data-testid="description">${project.description.replace(/[<&"]/g, '')}</p>`,
      );
      return;
    }
    send('Missing', 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture did not bind');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    url: `${base}/entry`,
    requests,
    projects,
    loginCount: () => loginCount,
    gateVisits: () => gateVisits,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export function workflowPlan(
  scenario: WorkflowScenario,
  base: string,
): { url: string; steps: Record<string, unknown>[] } {
  const create = [
    { do: 'fill', label: 'Project name', valueRef: 'BENCHMARK_NAME' },
    { do: 'click', role: 'button', name: 'Create project' },
    { do: 'has', testId: 'project-id', contains: 'P-' },
    { do: 'extractText', testId: 'project-id', save: 'projectId' },
    { do: 'navigate', url: `${base}/projects/\${projectId}` },
    { do: 'has', testId: 'project-name', contains: 'Ratatoskr Test' },
  ];
  if (scenario === 'transient')
    return {
      url: `${base}/entry`,
      steps: [
        { do: 'navigate', url: `${base}/gate` },
        { do: 'wait', testId: 'ready', retry: 2, recover: 'reloadOnce' },
      ],
    };
  if (scenario === 'server-failure')
    return {
      url: `${base}/entry`,
      steps: [
        ...create.slice(0, 2),
        { do: 'has', testId: 'project-id', contains: 'P-' },
      ],
    };
  const login = {
    if: 'visible',
    testId: 'dashboard',
    then: [],
    else: [
      { do: 'fill', label: 'Email', valueRef: 'BENCHMARK_FIELD_1' },
      { do: 'fill', label: 'Password', valueRef: 'BENCHMARK_FIELD_2' },
      { do: 'click', role: 'button', name: 'Sign in' },
      { do: 'visible', testId: 'dashboard' },
    ],
  };
  if (scenario.startsWith('login-'))
    return {
      url: `${base}/entry`,
      steps: [login, { do: 'visible', testId: 'dashboard' }],
    };
  if (scenario === 'complex')
    return {
      url: `${base}/entry`,
      steps: [
        login,
        ...create,
        { do: 'wait', testId: 'ready', retry: 2, recover: 'reloadOnce' },
        { do: 'fill', label: 'Description', value: 'Project ${projectId}' },
        { do: 'click', role: 'button', name: 'Save details' },
        { do: 'has', testId: 'description', contains: 'Project ${projectId}' },
        { do: 'navigate', url: `${base}/projects/\${projectId}` },
        { do: 'has', testId: 'description', contains: 'Project ${projectId}' },
      ],
    };
  return { url: `${base}/entry`, steps: create };
}
