import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

function html(fail: boolean): string {
  return `<!doctype html><html><head><title>Ratatoskr test login</title></head><body>
    <h1>Sign in</h1>
    <form id="login"><label>Email <input type="email" name="email" /></label>
    <label>Password <input type="password" name="password" /></label>
    <button type="submit">Sign in</button></form><p role="alert" id="error" hidden></p>
    <script>
    document.querySelector('#login').addEventListener('submit', async (event) => {
      event.preventDefault();
      const response = await fetch('/api/login${fail ? '?fail=1' : ''}', { method: 'POST' });
      if (!response.ok) {
        console.error('Login request failed with status ' + response.status);
        const alert = document.querySelector('#error');
        alert.textContent = 'Unable to sign in';
        alert.hidden = false;
        return;
      }
      location.href = '/dashboard';
    });
    </script></body></html>`;
}

function formHtml(): string {
  return `<!doctype html><html><body>
    <label for="state">State</label><select id="state"><option value="ca">California</option><option value="nv">Nevada</option></select>
    <label for="agree">Agree</label><input type="checkbox" id="agree">
    <label for="subscribe">Subscribe</label><input type="checkbox" id="subscribe" checked>
    <button id="menu">Menu</button><a id="menu-link" href="/receipt/42" hidden>Receipt menu</a>
    <button id="save">Save item</button>
    <p data-testid="order-number"></p><a data-testid="receipt" href="/receipt/42">Receipt</a>
    <script>
      document.querySelector('#menu').addEventListener('mouseenter', () => { document.querySelector('#menu-link').hidden = false; });
      document.querySelector('#save').addEventListener('click', () => {
        const valid = document.querySelector('select').value === 'nv' && document.querySelector('#agree').checked && !document.querySelector('#subscribe').checked;
        document.querySelector('[data-testid="order-number"]').textContent = valid ? 'ORD-NV-42' : 'INVALID FORM';
      });
    </script></body></html>`;
}

function respond(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.method === 'POST' && url.pathname === '/api/login') {
    response.statusCode = url.searchParams.has('fail') ? 500 : 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: response.statusCode === 200 }));
    return;
  }
  if (url.pathname === '/download-file') {
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="receipt.txt"',
    );
    response.end('RECEIPT-42');
    return;
  }
  switch (url.pathname) {
    case '/login':
      response.end(html(false));
      return;
    case '/login-failure':
      response.end(html(true));
      return;
    case '/dashboard':
      response.end(
        '<h1>Welcome to the dashboard</h1><p data-testid="ready">Ready</p>',
      );
      return;
    case '/form':
      response.end(formHtml());
      return;
    case '/upload':
      response.end(
        '<label for="file">File</label><input id="file" type="file"><button id="verify">Verify upload</button><p data-testid="upload-result"></p><script>document.querySelector("#verify").onclick = async () => { const file = document.querySelector("#file").files[0]; document.querySelector("[data-testid=upload-result]").textContent = file ? file.name + ":" + await file.text() : "NO FILE"; };</script>',
      );
      return;
    case '/download':
      response.end(
        '<button id="export" onclick="location.href=\'/download-file\'">Export receipt</button>',
      );
      return;
    case '/dialog':
      response.end(
        '<button id="confirm" onclick="document.querySelector(\'#result\').textContent = confirm(\'Proceed?\') ? \'CONFIRMED\' : \'DENIED\'">Confirm</button><button id="prompt" onclick="document.querySelector(\'#result\').textContent = prompt(\'Code?\')">Prompt</button><button id="unexpected" onclick="alert(\'Unexpected\')">Unexpected</button><p id="result"></p>',
      );
      return;
    case '/popup':
      response.end(
        '<button id="open" onclick="window.open(\'/dashboard\', \'_blank\')">Open dashboard</button>',
      );
      return;
    case '/delayed-assert':
      response.end(
        '<h1 id="status">Loading</h1><script>setTimeout(() => { document.querySelector("#status").textContent = "Ready"; }, 300)</script>',
      );
      return;
    case '/delayed-url':
      response.end(
        '<h1>Redirecting</h1><script>setTimeout(() => { location.href = "/dashboard"; }, 300)</script>',
      );
      return;
    case '/delayed':
      response.end(
        '<h1>Loading</h1><script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", "<button>Delayed</button>"), 1500)</script>',
      );
      return;
    case '/console-error':
      response.end(
        '<h1>Console error</h1><script>console.error("Fixture console error")</script>',
      );
      return;
    case '/page-error':
      response.end(
        '<h1>Page error</h1><script>throw new Error("Fixture page error")</script>',
      );
      return;
    case '/unexpected':
      response.end('<h1>Unexpected destination</h1>');
      return;
    default:
      response.statusCode = 404;
      response.end('<h1>Missing</h1>');
  }
}

export function createFixtureServer() {
  return createServer(respond);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const port = Number(process.env.PORT ?? 3000);
  createFixtureServer().listen(port, '127.0.0.1', () =>
    process.stdout.write(`Fixture listening on http://127.0.0.1:${port}\n`),
  );
}
