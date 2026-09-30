import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
  ): Promise<void>;
  load(runId: string): Promise<{
    record: RunRecord;
    plan: BrowserPlan;
    steps: StepResult[];
    evidence: Evidence[];
    result: RunResult;
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
  ): Promise<ArtifactReference>;
  get(runId: string, artifactId: string): Promise<ArtifactReference>;
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
    await mkdir(join(this.directory(runId), 'artifacts'), { recursive: true });
  }

  async save(
    record: RunRecord,
    plan: BrowserPlan,
    steps: StepResult[],
    evidence: Evidence[],
    result: RunResult,
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
    ]);
  }

  async load(runId: string): Promise<{
    record: RunRecord;
    plan: BrowserPlan;
    steps: StepResult[];
    evidence: Evidence[];
    result: RunResult;
  }> {
    const directory = this.directory(runId);
    const [metadata, workflow, steps, evidence, result] = await Promise.all([
      readFile(join(directory, 'metadata.json'), 'utf8'),
      readFile(join(directory, 'workflow.json'), 'utf8'),
      readFile(join(directory, 'steps.json'), 'utf8'),
      readFile(join(directory, 'evidence.jsonl'), 'utf8'),
      readFile(join(directory, 'reduced-result.json'), 'utf8'),
    ]);
    return {
      record: JSON.parse(metadata) as RunRecord,
      plan: JSON.parse(workflow) as BrowserPlan,
      steps: JSON.parse(steps) as StepResult[],
      evidence: evidence
        ? evidence.split('\n').map((line) => JSON.parse(line) as Evidence)
        : [],
      result: JSON.parse(result) as RunResult,
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
    return type === 'screenshot' ? '.png' : '.zip';
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
    await mkdir(this.directory(runId), { recursive: true });
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
  ): Promise<ArtifactReference> {
    const expected = join(
      this.directory(runId),
      `${id}${this.extension(type)}`,
    );
    if (resolve(path) !== resolve(expected))
      throw new Error('Artifact path is outside its run');
    const info = await stat(path);
    const artifact: ArtifactReference = {
      id,
      runId,
      type,
      path,
      mimeType: type === 'screenshot' ? 'image/png' : 'application/zip',
      sizeBytes: info.size,
      createdAt: new Date().toISOString(),
    };
    await writeFile(
      this.metadataPath(runId, id),
      JSON.stringify(artifact, null, 2),
    );
    return artifact;
  }

  async save(
    runId: string,
    type: ArtifactType,
    content: Buffer,
  ): Promise<ArtifactReference> {
    const reserved = await this.reservePath(runId, type);
    await writeFile(reserved.path, content);
    return this.register(runId, type, reserved.id, reserved.path);
  }

  async get(runId: string, artifactId: string): Promise<ArtifactReference> {
    try {
      return JSON.parse(
        await readFile(this.metadataPath(runId, artifactId), 'utf8'),
      ) as ArtifactReference;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ArtifactNotFoundError(artifactId);
      throw error;
    }
  }

  async copyTo(
    runId: string,
    artifactId: string,
    destination: string,
  ): Promise<ArtifactReference> {
    const artifact = await this.get(runId, artifactId);
    await copyFile(artifact.path, destination, constants.COPYFILE_EXCL);
    return artifact;
  }
}
