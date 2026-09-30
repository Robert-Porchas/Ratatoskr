import type { FailureKind } from './protocol.js';

export class BridgeError extends Error {
  constructor(
    public readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class SecretResolutionError extends BridgeError {
  constructor(ref: string) {
    super('secret_resolution', `Value reference ${ref} is not set`);
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(id: string) {
    super(`Artifact ${id} was not found`);
  }
}
