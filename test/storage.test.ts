import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemArtifactStore, FilesystemRunStore } from '../src/storage.js';
import type { BrowserPlan, RunRecord, RunResult } from '../src/protocol.js';

describe('filesystem storage', () => {
  it('protects authentication state, permissions and registry/path boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ratatoskr-auth-store-'));
    try {
      const store = new FilesystemArtifactStore(root);
      const secret = 'SUPER_SECRET_SESSION_VALUE_123';
      const artifact = await store.save(
        'run_auth',
        'browser_storage_state',
        Buffer.from(
          JSON.stringify({ cookies: [{ name: 'session', value: secret }] }),
        ),
      );
      expect(artifact).toMatchObject({
        sensitive: true,
        inlineRetrievalAllowed: false,
        mimeType: 'application/json',
      });
      expect(JSON.stringify(artifact)).not.toContain(secret);
      expect(
        (await store.readProtectedState(artifact.id)).toString(),
      ).toContain(secret);
      await expect(store.read(artifact.id, 10000)).rejects.toThrow(
        'prohibited',
      );
      await expect(
        store.copyTo('run_auth', artifact.id, join(root, 'export')),
      ).rejects.toThrow('prohibited');
      if (process.platform !== 'win32')
        expect((await stat(artifact.path)).mode & 0o777).toBe(0o600);
      // Tampered sensitivity flags cannot downgrade a storage-state artifact.
      await writeFile(
        join(root, 'runs', 'run_auth', 'artifacts', `${artifact.id}.json`),
        JSON.stringify({
          ...artifact,
          sensitive: false,
          inlineRetrievalAllowed: true,
        }),
      );
      await expect(store.read(artifact.id, 10000)).rejects.toThrow(
        'prohibited',
      );
      await expect(store.find('../../secret')).rejects.toThrow();
      const reserved = await store.reservePath(
        'run_auth',
        'browser_storage_state',
      );
      await symlink(artifact.path, reserved.path);
      await expect(
        store.register(
          'run_auth',
          'browser_storage_state',
          reserved.id,
          reserved.path,
        ),
      ).rejects.toThrow('symbolic link');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('round trips run data and artifact metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ratatoskr-test-'));
    try {
      const runId = 'run_test';
      const runs = new FilesystemRunStore(root);
      const artifacts = new FilesystemArtifactStore(root);
      const artifact = await artifacts.save(
        runId,
        'screenshot',
        Buffer.from('png bytes'),
      );
      const plan: BrowserPlan = {
        startUrl: 'http://localhost:3000',
        steps: [{ action: 'assert_url', contains: '/' }],
      };
      const result: RunResult = { success: true, runId };
      const record: RunRecord = {
        id: runId,
        startedAt: '',
        endedAt: '',
        status: 'passed',
        artifacts: [artifact],
        metrics: {
          stepCount: 1,
          durationMs: 1,
          browserActionCount: 1,
          failureCount: 0,
          networkRequestCount: 0,
          failedRequestCount: 0,
          consoleMessageCount: 0,
          consoleErrorCount: 0,
          pageErrorCount: 0,
          rawEvidenceEventCount: 0,
          rawEvidenceBytes: 0,
          reducedResponseBytes: 1,
          artifactCount: 1,
          compressionRatio: 0,
        },
      };
      await runs.save(record, plan, [], [], result, { orderNumber: 'ORD-42' });
      expect((await runs.load(runId)).record.artifacts[0]).toMatchObject({
        type: 'screenshot',
        sizeBytes: 9,
      });
      expect((await runs.load(runId)).extractions).toEqual({
        orderNumber: 'ORD-42',
      });
      expect((await artifacts.get(runId, artifact.id)).mimeType).toBe(
        'image/png',
      );
      expect((await artifacts.find(artifact.id)).runId).toBe(runId);
      expect((await artifacts.read(artifact.id, 100)).toString()).toBe(
        'png bytes',
      );
      await expect(artifacts.read(artifact.id, 2)).rejects.toThrow('too large');
      const destination = join(root, 'retrieved.png');
      await artifacts.copyTo(runId, artifact.id, destination);
      expect(await readFile(destination, 'utf8')).toBe('png bytes');
      await expect(artifacts.get(runId, '../escape')).rejects.toThrow();
      await expect(artifacts.find('../escape')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
