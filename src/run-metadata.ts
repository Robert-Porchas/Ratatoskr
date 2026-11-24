import { createHash } from 'node:crypto';
import type { BrowserPlan } from './protocol.js';

/** Key order is irrelevant; array/step order and all workflow values matter. */
export function workflowFingerprint(plan: BrowserPlan): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(plan)))
    .digest('hex');
}
