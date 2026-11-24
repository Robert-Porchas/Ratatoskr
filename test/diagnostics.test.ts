import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  diagnoseEvidence,
  loadApplicationDiagnostics,
  resolveSourceLocation,
} from '../src/diagnostics.js';
import type { Evidence } from '../src/protocol.js';

describe('explicit application diagnostics', () => {
  let root: string;
  const url = 'http://localhost:3000/assets/app.js';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ratatoskr-diagnostics-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'src', 'main.ts'), 'PRIVATE_SOURCE_CONTENT');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const event = (path = '/api/users'): Extract<Evidence, { type: 'http' }> => ({
    type: 'http',
    at: 1,
    stepIndex: 2,
    method: 'POST',
    path,
    status: 500,
  });
  async function config(extra: Record<string, unknown> = {}) {
    const path = join(root, 'application.json');
    await writeFile(path, JSON.stringify({ workspaceRoot: '.', ...extra }));
    return loadApplicationDiagnostics(path);
  }
  async function sourceMap(extra: Record<string, unknown> = {}) {
    await writeFile(
      join(root, 'assets', 'app.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['main.ts'],
        sourceRoot: '../src/',
        names: [],
        mappings: 'AAAA',
        sourcesContent: ['SECRET_SOURCES_CONTENT'],
        ...extra,
      }),
    );
    return config({
      sourceMaps: [{ generatedUrl: url, mapPath: 'assets/app.js.map' }],
    });
  }

  it('resolves exact method/path routes without reading source or claiming causality', async () => {
    const settings = await config({
      routes: [
        {
          method: 'POST',
          path: '/api/users',
          source: 'src/main.ts',
          symbol: 'createUser',
        },
      ],
    });
    const result = await diagnoseEvidence(
      [event(), { ...event(), method: 'GET' }, { ...event(), status: 200 }],
      settings,
    );
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({
      evidenceIndex: 0,
      stepIndex: 2,
      sourceReferences: [
        {
          path: 'src/main.ts',
          symbol: 'createUser',
          relationship: 'explicit_route_mapping',
        },
      ],
    });
    expect(result.observations[1]!.sourceReferences).toEqual([]);
    expect(result.limitations.join(' ')).toContain(
      'do not establish root cause',
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_CONTENT');
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('rejects traversal and symlinks outside workspace as source references', async () => {
    const outside = join(root, '..', `${root.split('/').pop()}-outside.ts`);
    await writeFile(outside, 'OUTSIDE');
    try {
      await symlink(outside, join(root, 'src', 'linked.ts'));
      const settings = await config({
        routes: [
          { method: 'POST', path: '/api/users', source: '../outside.ts' },
          { method: 'POST', path: '/api/users', source: 'src/linked.ts' },
          { method: 'POST', path: '/api/users', source: 'src' },
        ],
      });
      const result = await diagnoseEvidence([event()], settings);
      expect(result.observations[0]!.sourceReferences).toEqual([]);
      expect(result.observations[0]!.limitations.join(' ')).toContain(
        'outside',
      );
    } finally {
      await rm(outside);
    }
  });

  it('allows only selected bounded request identifiers', async () => {
    const settings = await config({
      correlationHeaders: ['x-request-id', 'traceparent'],
    });
    const input = {
      ...event(),
      correlationIds: {
        'x-request-id': 'req-123',
        authorization: 'PRIVATE_TOKEN',
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        'x-correlation-id': 'not-enabled',
      },
    };
    const result = await diagnoseEvidence([input], settings);
    expect(result.observations[0]!.correlationIds).toEqual({
      'x-request-id': 'req-123',
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
    const invalid = await diagnoseEvidence(
      [
        {
          ...event(),
          correlationIds: {
            'x-request-id': 'bad\nvalue',
            traceparent: 'invalid',
          },
        },
      ],
      settings,
    );
    expect(invalid.observations[0]!.correlationIds).toBeUndefined();
  });

  it('bounds observation count, scanning and serialized output', async () => {
    const settings = await config();
    const result = await diagnoseEvidence(
      Array.from({ length: 6000 }, () => event('/'.repeat(10000))),
      settings,
    );
    expect(result.observations.length).toBeLessThanOrEqual(20);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(12500);
  });

  it('rejects oversized, executable and unsupported configuration', async () => {
    const path = join(root, 'bad.json');
    await writeFile(path, ' '.repeat(65537));
    await expect(loadApplicationDiagnostics(path)).rejects.toThrow();
    await expect(
      config({ correlationHeaders: ['authorization'] }),
    ).rejects.toThrow('Invalid application');
    await expect(config({ run: 'unsafe command' })).rejects.toThrow(
      'Invalid application',
    );
    await expect(config({ workspaceRoot: 'src/main.ts' })).rejects.toThrow(
      'directory',
    );
  });

  it('maps supported local source locations and preserves generated coordinates', async () => {
    const settings = await sourceMap();
    const result = await resolveSourceLocation(settings, url, 1, 1);
    expect(result.generated).toEqual({ url, line: 1, column: 1 });
    expect(result.sourceReference).toEqual({
      path: 'src/main.ts',
      line: 1,
      column: 1,
      relationship: 'source_map',
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_SOURCES_CONTENT');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_CONTENT');
    expect(
      (await resolveSourceLocation(settings, url, 2, 1)).sourceReference,
    ).toBeUndefined();
  });

  it('reports missing, malformed and oversized source maps without invented pointers', async () => {
    const settings = await config({
      sourceMaps: [{ generatedUrl: url, mapPath: 'missing.map' }],
    });
    expect(
      (await resolveSourceLocation(settings, url, 1, 1)).sourceReference,
    ).toBeUndefined();
    await writeFile(join(root, 'missing.map'), 'malformed JSON');
    expect(
      (await resolveSourceLocation(settings, url, 1, 1)).sourceReference,
    ).toBeUndefined();
    await writeFile(join(root, 'missing.map'), ' '.repeat(1024 * 1024 + 1));
    expect(
      (await resolveSourceLocation(settings, url, 1, 1)).sourceReference,
    ).toBeUndefined();
  });

  it('rejects source-map paths and sources escaping the workspace', async () => {
    const settings = await sourceMap({
      sources: ['../../escape.ts'],
      sourceRoot: '',
    });
    expect(
      (await resolveSourceLocation(settings, url, 1, 1)).sourceReference,
    ).toBeUndefined();
    const remote = await sourceMap({
      sources: ['https://evil.test/private.ts'],
    });
    expect(
      (await resolveSourceLocation(remote, url, 1, 1)).sourceReference,
    ).toBeUndefined();
    const absolute = await sourceMap({ sourceRoot: '/tmp/' });
    expect(
      (await resolveSourceLocation(absolute, url, 1, 1)).sourceReference,
    ).toBeUndefined();
    expect(
      (
        await resolveSourceLocation(
          settings,
          'http://localhost:3000/other.js',
          1,
          1,
        )
      ).limitations.join(' '),
    ).toContain('No explicit');
    await expect(
      resolveSourceLocation(
        settings,
        'http://user:password@example.test/app.js',
        1,
        1,
      ),
    ).rejects.toThrow();
    await expect(resolveSourceLocation(settings, url, 0, 1)).rejects.toThrow();
  });
});
