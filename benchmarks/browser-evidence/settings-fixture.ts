import { createServer } from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';

export const sizes = { tiny: 1, small: 2, medium: 4, large: 9 } as const;
export const outcomes = ['success', 'http_failure', 'locator_failure'] as const;
export type SettingsScenario = {
  size: keyof typeof sizes;
  outcome: (typeof outcomes)[number];
};
const labels = [
  'Name',
  'Email',
  'Company',
  'Job title',
  'City',
  'Region',
  'Postal code',
  'Country',
  'Website',
];
const desired = [
  'Ratatoskr Test',
  'ratatoskr@example.test',
  'Acme Labs',
  'Engineer',
  'Reno',
  'Nevada',
  '89501',
  'USA',
  'https://example.test',
];
const initial = [
  'Jane Developer',
  'jane@example.test',
  'Old Company',
  'Developer',
  'Boston',
  'Massachusetts',
  '02101',
  'USA',
  'https://old.example.test',
];

export function settingsContract(scenario: SettingsScenario) {
  return labels.slice(0, sizes[scenario.size]).map((label, index) => ({
    label,
    id: index === 0 ? 'name' : `field-${index}`,
    initial: initial[index]!,
    desired: desired[index]!,
    ref: index === 0 ? 'BENCHMARK_NAME' : `BENCHMARK_FIELD_${index}`,
  }));
}
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** A small realistic profile form, without padding, production dependencies or a database. */
export async function startSettingsFixture(scenario: SettingsScenario) {
  const fields = settingsContract(scenario);
  let stored = Object.fromEntries(
    fields.map((field) => [field.id, field.initial]),
  );
  const requests: Array<{
    method: string;
    path: string;
    body: string;
    status: number;
  }> = [];
  const html =
    () => `<!doctype html><html><head><title>Profile Settings</title><link rel="icon" href="data:,"></head><body><h1>Profile Settings</h1>
<form id="profile">${fields.map((field) => `<label for="${field.id}">${field.label}</label><input id="${field.id}" name="${field.id}" value="${escape(stored[field.id]!)}">`).join('\n')}<button>Save</button></form>
<p role="status" id="status">No changes saved.</p>${fields.map((field) => `<p>${field.label}: <span data-testid="persisted-${field.id}">${escape(stored[field.id]!)}</span></p>`).join('\n')}
<script>document.querySelector('#profile').addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('#status');status.textContent='Saving…';try{const response=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});const data=await response.json();if(!response.ok){console.error('Failed to save profile: '+data.error);status.textContent='Unable to save profile.';return;}for(const [key,value] of Object.entries(data)){document.querySelector('[data-testid="persisted-'+key+'"]').textContent=value;}status.textContent='Profile saved.';}catch{console.error('Profile request could not complete');status.textContent='Unable to save profile.';}});</script></body></html>`;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    response.setHeader('Cache-Control', 'no-store');
    let status = 404,
      content = 'Not found';
    if (request.method === 'GET' && path === '/profile') {
      status = 200;
      content = html();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    if (request.method === 'POST' && path === '/api/profile') {
      response.setHeader('Content-Type', 'application/json');
      if (scenario.outcome === 'http_failure') {
        status = 500;
        content = JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'Unable to persist profile',
        });
      } else {
        let decoded: unknown;
        try {
          decoded = JSON.parse(body);
        } catch {
          decoded = undefined;
        }
        const parsed = z.record(z.string(), z.string()).safeParse(decoded);
        if (
          parsed.success &&
          fields.every((field) => typeof parsed.data[field.id] === 'string')
        ) {
          stored = Object.fromEntries(
            fields.map((field) => [field.id, parsed.data[field.id]!]),
          );
          status = 200;
          content = JSON.stringify(stored);
        } else {
          status = 400;
          content = JSON.stringify({ error: 'INVALID_PROFILE' });
        }
      }
    }
    requests.push({ method: request.method ?? '', path, body, status });
    response.writeHead(status);
    response.end(content);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/profile`,
    requests,
    fields,
    stored: () => ({ ...stored }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

export function settingsTask(scenario: SettingsScenario) {
  const fields = settingsContract(scenario);
  const prompt = `Open the profile page, set ${fields.map((field) => `${field.label} to '${field.desired}'`).join(', ')}, ${scenario.outcome === 'locator_failure' ? "then click the exact button 'Publish'. Do not substitute another button. If it is missing, report the missing control and do not claim persistence." : 'save, reload the page, and verify every changed value persisted. If saving fails, determine the cause and report relevant evidence.'}`;
  const sourceContext = `Shared source/test contract: /profile has these inputs: ${JSON.stringify(fields.map((field) => ({ label: field.label, inputId: field.id, valueRef: field.ref, desired: field.desired, persistedTestId: `persisted-${field.id}` })))}. The form button is named Save. Persisted test IDs contain text, not inputs. Use condition assertions to verify persisted text; only extract values explicitly needed for the report. Known routes/locators need no browser discovery; batch the complete task when supported. After saving, verify the persisted name before reloading, then verify all persisted fields. A failed persisted assertion with actual text and HTTP/console errors suffices to report rejected persistence; do not re-fetch evidence already in the result. For a missing requested control use method NONE, path /profile, status 0, errorCode LOCATOR_NOT_FOUND.`;
  return {
    prompt,
    sourceContext,
    values: Object.fromEntries(
      fields.map((field) => [field.ref, field.desired]),
    ),
    plannedSteps: fields.length * 2 + 2,
  };
}
