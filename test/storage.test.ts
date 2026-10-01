import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesystemArtifactStore, FilesystemRunStore } from '../src/storage.js';
import type { BrowserPlan, RunRecord, RunResult } from '../src/protocol.js';

describe('filesystem storage', () => {
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
