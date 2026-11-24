import { z } from 'zod';
import type { BrowserTarget } from './protocol.js';

export const DiscoveryRoleSchema = z.enum([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'heading',
  'tab',
  'menuitem',
  'switch',
  'slider',
  'spinbutton',
  'img',
  'region',
  'dialog',
  'alert',
  'status',
  'navigation',
  'main',
  'form',
]);

export const DiscoveryOptionsSchema = z.strictObject({
  query: z.string().trim().max(120).optional(),
  roles: z.array(DiscoveryRoleSchema).min(1).max(10).optional(),
  visibleOnly: z.boolean().default(true),
  maxResults: z.number().int().min(1).max(20).default(10),
});
export type DiscoveryOptions = z.infer<typeof DiscoveryOptionsSchema>;
export interface DiscoveryCandidate {
  role: string;
  name: string;
  visible: boolean;
  enabled: boolean;
}
export interface DiscoveryMatch extends DiscoveryCandidate {
  locator?: BrowserTarget;
  matchCount: number;
}
export interface DiscoveryResult {
  matches: DiscoveryMatch[];
  scanned: number;
  truncated: boolean;
  limitations: string[];
}

/** Exact words rank before partial words; DOM order resolves ties. No language model. */
export function rankDiscoveryCandidates<T extends DiscoveryCandidate>(
  candidates: T[],
  options: DiscoveryOptions,
): T[] {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/\s+/g, ' ').trim();
  const query = normalize(options.query ?? '');
  const terms = query.split(' ').filter(Boolean);
  return candidates
    .map((candidate, order) => {
      const name = normalize(candidate.name);
      const words = new Set(name.split(/\W+/));
      const matched = terms.filter((term) => name.includes(term)).length;
      const exactWords = terms.filter((term) => words.has(term)).length;
      return {
        candidate,
        order,
        matched,
        score:
          Number(name === query && query.length > 0) * 1000 +
          Number(query.length > 0 && name.includes(query)) * 100 +
          exactWords * 10 +
          matched * 5 +
          Number(candidate.visible),
      };
    })
    .filter(
      ({ candidate, matched }) =>
        DiscoveryRoleSchema.options.includes(
          candidate.role as z.infer<typeof DiscoveryRoleSchema>,
        ) &&
        (!options.visibleOnly || candidate.visible) &&
        (!options.roles ||
          options.roles.includes(
            candidate.role as z.infer<typeof DiscoveryRoleSchema>,
          )) &&
        (!terms.length || matched > 0),
    )
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ candidate }) => candidate);
}
