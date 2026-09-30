import { SecretResolutionError } from './errors.js';

export interface ValueResolver {
  resolve(ref: string): string;
}

export class EnvironmentValueResolver implements ValueResolver {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  resolve(ref: string): string {
    const value = this.environment[ref];
    if (value === undefined) throw new SecretResolutionError(ref);
    return value;
  }
}
