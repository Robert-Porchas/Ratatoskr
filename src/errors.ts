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

export class BrowserExecutionError extends BridgeError {
  constructor(action: string) {
    super('browser_execution', `Browser operation failed during ${action}`);
  }
}

export class ElementNotFoundError extends BridgeError {
  constructor() {
    super('element_not_found', 'Target did not become visible');
  }
}

export class StepTimeoutError extends BridgeError {
  constructor(action: string) {
    super('timeout', `Timed out during ${action}`);
  }
}

export class BrowserAssertionError extends BridgeError {
  constructor(message: string) {
    super('assertion', message);
  }
}

export class NavigationError extends BridgeError {
  constructor() {
    super('navigation', 'Navigation failed');
  }
}

export class InvalidPlanError extends Error {
  constructor(details: string) {
    super(`Invalid BrowserPlan: ${details}`);
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
