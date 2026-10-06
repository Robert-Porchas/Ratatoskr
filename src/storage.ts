import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ArtifactNotFoundError } from './errors.js';
import type {
  ArtifactReference,
  ArtifactType,
  BrowserPlan,
  Evidence,
  RunRecord,
  RunResult,
  StepResult,
} from './protocol.js';

const safeId = (id: string): void => {
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('Invalid identifier');
};

export interface RunStore {
  prepare(runId: string): Promise<void>;
  save(
    record: RunRecord,
    plan: BrowserPlan,
    steps: StepResult[],
    evidence: Evidence[],
    result: RunResult,
    extractions?: Record<string, string>,
  ): Promise<void>;
  load(runId: string): Promise<{
    record: RunRecord;
    plan: BrowserPlan;
    steps: StepResult[];
    evidence: Evidence[];
    result: RunResult;
    extractions: Record<string, string>;
  }>;
}

export interface ArtifactStore {
  save(
    runId: string,
    type: ArtifactType,
    content: Buffer,
  ): Promise<ArtifactReference>;
  reservePath(
    runId: string,
    type: ArtifactType,
  ): Promise<{ id: string; path: string }>;
  register(
    runId: string,
    type: ArtifactType,
    id: string,
    path: string,
    details?: { fileName?: string; mimeType?: string },
  ): Promise<ArtifactReference>;
  get(runId: string, artifactId: string): Promise<ArtifactReference>;
  find(artifactId: string): Promise<ArtifactReference>;
  read(artifactId: string, maxBytes: number): Promise<Buffer>;
  discard(runId: string, type: ArtifactType, id: string): Promise<void>;
  copyTo(
    runId: string,
    artifactId: string,
    destination: string,
  ): Promise<ArtifactReference>;
}

export class FilesystemRunStore implements RunStore {
  constructor(private readonly root: string) {}
  private directory(runId: string): string {
    safeId(runId);
    return join(this.root, 'runs', runId);
  }
  async prepare(runId: string): Promise<void> {
    await mkdir(join(this.directory(runId), 'artifacts'), {
      recursive: true,
      mode: 0o700,
    });
  }

  async save(
    record: RunRecord,
    plan: BrowserPlan,
    steps: StepResult[],
    evidence: Evidence[],
    result: RunResult,
    extractions: Record<string, string> = {},
  ): Promise<void> {
    const directory = this.directory(record.id);
    await this.prepare(record.id);
    await Promise.all([
      writeFile(
        join(directory, 'metadata.json'),
        JSON.stringify(record, null, 2),
      ),
      writeFile(
        join(directory, 'workflow.json'),
        JSON.stringify(plan, null, 2),
      ),
      writeFile(join(directory, 'steps.json'), JSON.stringify(steps, null, 2)),
      writeFile(
        join(directory, 'evidence.jsonl'),
        evidence.map((event) => JSON.stringify(event)).join('\n'),
      ),
      writeFile(
        join(directory, 'reduced-result.json'),
        JSON.stringify(result, null, 2),
      ),
      writeFile(
        join(directory, 'extractions.json'),
        JSON.stringify(extractions, null, 2),
      ),
    ]);
  }

  async load(runId: string): Promise<{
    record: RunRecord;
    plan: BrowserPlan;
    steps: StepResult[];
    evidence: Evidence[];
    result: RunResult;
    extractions: Record<string, string>;
  }> {
    const directory = this.directory(runId);
    const [metadata, workflow, steps, evidence, result, extractions] =
      await Promise.all([
        readFile(join(directory, 'metadata.json'), 'utf8'),
        readFile(join(directory, 'workflow.json'), 'utf8'),
        readFile(join(directory, 'steps.json'), 'utf8'),
        readFile(join(directory, 'evidence.jsonl'), 'utf8'),
        readFile(join(directory, 'reduced-result.json'), 'utf8'),
        readFile(join(directory, 'extractions.json'), 'utf8').catch(
          (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '{}';
            throw error;
          },
        ),
      ]);
    return {
      record: JSON.parse(metadata) as RunRecord,
      plan: JSON.parse(workflow) as BrowserPlan,
      steps: JSON.parse(steps) as StepResult[],
      evidence: evidence
        ? evidence.split('\n').map((line) => JSON.parse(line) as Evidence)
        : [],
      result: JSON.parse(result) as RunResult,
      extractions: JSON.parse(extractions) as Record<string, string>,
    };
  }
}

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}
  private directory(runId: string): string {
    safeId(runId);
    return join(this.root, 'runs', runId, 'artifacts');
  }
  private extension(type: ArtifactType): string {
    if (type === 'browser_storage_state') return '.storage-state.json';
    return type === 'screenshot' ? '.png' : type === 'trace' ? '.zip' : '.bin';
  }
  private indexPath(id: string): string {
    safeId(id);
    return join(this.root, 'artifacts', `${id}.json`);
  }
  private metadataPath(runId: string, id: string): string {
    safeId(id);
    return join(this.directory(runId), `${id}.json`);
  }

  async reservePath(
    runId: string,
    type: ArtifactType,
  ): Promise<{ id: string; path: string }> {
    const id = `artifact_${randomUUID().replaceAll('-', '')}`;
    await mkdir(this.directory(runId), { recursive: true, mode: 0o700 });
    return {
      id,
      path: join(this.directory(runId), `${id}${this.extension(type)}`),
    };
  }

  async register(
    runId: string,
    type: ArtifactType,
    id: string,
    path: string,
    details: { fileName?: string; mimeType?: string } = {},
  ): Promise<ArtifactReference> {
    safeId(id);
    const expected = join(
      this.directory(runId),
      `${id}${this.extension(type)}`,
    );
    if (resolve(path) !== resolve(expected))
      throw new Error('Artifact path is outside its run');
    if ((await realpath(expected)) !== resolve(expected))
      throw new Error('Artifact path must not be a symbolic link');
    const info = await stat(path);
    const artifact: ArtifactReference = {
      id,
      runId,
      type,
      path,
      mimeType:
        details.mimeType ??
        (type === 'screenshot'
          ? 'image/png'
          : type === 'trace'
            ? 'application/zip'
            : type === 'browser_storage_state'
              ? 'application/json'
              : 'application/octet-stream'),
      sizeBytes: info.size,
      createdAt: new Date().toISOString(),
      ...(details.fileName ? { fileName: details.fileName } : {}),
      ...(type === 'browser_storage_state'
        ? { sensitive: true, inlineRetrievalAllowed: false }
        : {}),
    };
    await writeFile(
      this.metadataPath(runId, id),
      JSON.stringify(artifact, null, 2),
      { mode: 0o600 },
    );
    await mkdir(join(this.root, 'artifacts'), { recursive: true, mode: 0o700 });
    await writeFile(this.indexPath(id), JSON.stringify({ runId }), {
      mode: 0o600,
    });
    return artifact;
  }

  async save(
    runId: string,
    type: ArtifactType,
    content: Buffer,
  ): Promise<ArtifactReference> {
    const reserved = await this.reservePath(runId, type);
    try {
      await writeFile(reserved.path, content, { mode: 0o600, flag: 'wx' });
      return await this.register(runId, type, reserved.id, reserved.path);
    } catch (error) {
      await this.discard(runId, type, reserved.id);
      throw error;
    }
  }

  async get(runId: string, artifactId: string): Promise<ArtifactReference> {
    try {
      const stored = JSON.parse(
        await readFile(this.metadataPath(runId, artifactId), 'utf8'),
      ) as ArtifactReference;
      if (
        stored.id !== artifactId ||
        stored.runId !== runId ||
        !['screenshot', 'trace', 'download', 'browser_storage_state'].includes(
          stored.type,
        )
      )
        throw new ArtifactNotFoundError(artifactId);
      const expected = join(
        this.directory(runId),
        `${artifactId}${this.extension(stored.type)}`,
      );
      if ((await realpath(expected)) !== resolve(expected))
        throw new ArtifactNotFoundError(artifactId);
      return {
        ...stored,
        path: expected,
        ...(stored.type === 'browser_storage_state'
          ? { sensitive: true, inlineRetrievalAllowed: false }
          : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ArtifactNotFoundError(artifactId);
      throw error;
    }
  }

  async find(artifactId: string): Promise<ArtifactReference> {
    try {
      const index = JSON.parse(
        await readFile(this.indexPath(artifactId), 'utf8'),
      ) as { runId: string };
      return this.get(index.runId, artifactId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ArtifactNotFoundError(artifactId);
      throw error;
    }
  }

  async read(artifactId: string, maxBytes: number): Promise<Buffer> {
    const artifact = await this.find(artifactId);
    if (artifact.sensitive || artifact.inlineRetrievalAllowed === false)
      throw new Error('Sensitive artifact inline retrieval is prohibited');
    if (artifact.sizeBytes > maxBytes)
      throw new Error('Artifact is too large for inline delivery');
    return readFile(artifact.path);
  }

  /** Local capability only; never wired to a CLI/MCP inline/export endpoint. */
  async readProtectedState(artifactId: string): Promise<Buffer> {
    const artifact = await this.find(artifactId);
    if (artifact.type !== 'browser_storage_state')
      throw new Error('Not a protected browser storage-state artifact');
    return readFile(artifact.path);
  }

  async discard(runId: string, type: ArtifactType, id: string): Promise<void> {
    safeId(id);
    try {
      await unlink(join(this.directory(runId), `${id}${this.extension(type)}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async copyTo(
    runId: string,
    artifactId: string,
    destination: string,
  ): Promise<ArtifactReference> {
    const artifact = await this.get(runId, artifactId);
    if (artifact.sensitive || artifact.inlineRetrievalAllowed === false)
      throw new Error('Sensitive artifact export is prohibited');
    await copyFile(artifact.path, destination, constants.COPYFILE_EXCL);
    return artifact;
  }
}
