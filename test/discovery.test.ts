import { describe, expect, it } from 'vitest';
import {
  DiscoveryOptionsSchema,
  rankDiscoveryCandidates,
} from '../src/discovery.js';

const candidate = (name: string, visible = true, role = 'button') => ({
  role,
  name,
  visible,
  enabled: true,
});

describe('bounded semantic discovery', () => {
  it('ranks exact and partial matches deterministically with DOM-order ties', () => {
    const candidates = [
      candidate('Save other'),
      candidate('Save profile'),
      candidate('Save profile'),
      candidate('Profile options'),
      candidate('Cancel'),
    ];
    const options = DiscoveryOptionsSchema.parse({ query: 'save profile' });
    expect(
      rankDiscoveryCandidates(candidates, options).map((item) => item.name),
    ).toEqual([
      'Save profile',
      'Save profile',
      'Save other',
      'Profile options',
    ]);
    expect(rankDiscoveryCandidates(candidates, options)).toEqual(
      rankDiscoveryCandidates(candidates, options),
    );
  });

  it('applies role and visibility filters without returning generic page text', () => {
    const candidates = [
      candidate('Hidden', false),
      candidate('Save'),
      candidate('Save', true, 'link'),
      candidate('Private page text', true, 'generic'),
    ];
    expect(
      rankDiscoveryCandidates(
        candidates,
        DiscoveryOptionsSchema.parse({ roles: ['button'] }),
      ),
    ).toEqual([candidate('Save')]);
    expect(
      rankDiscoveryCandidates(
        candidates,
        DiscoveryOptionsSchema.parse({ visibleOnly: false }),
      ),
    ).toHaveLength(3);
  });

  it('rejects arbitrary code, oversized queries, and excessive result budgets', () => {
    for (const input of [
      { evaluate: 'document.body' },
      { query: 'x'.repeat(121) },
      { maxResults: 21 },
      { roles: ['generic'] },
      { roles: Array(11).fill('button') },
    ])
      expect(DiscoveryOptionsSchema.safeParse(input).success).toBe(false);
    expect(DiscoveryOptionsSchema.parse({})).toEqual({
      visibleOnly: true,
      maxResults: 10,
    });
  });
});
