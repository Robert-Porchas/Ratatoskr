import { SecretResolutionError } from './errors.js';

export interface ValueResolver {
  resolve(ref: string): string;
}

export class EnvironmentValueResolver implements ValueResolver {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly allowedRefs?: ReadonlySet<string>,
  ) {}

  resolve(ref: string): string {
    if (this.allowedRefs && !this.allowedRefs.has(ref))
      throw new SecretResolutionError(ref);
    const value = this.environment[ref];
    if (value === undefined) throw new SecretResolutionError(ref);
    return value;
  }
}
