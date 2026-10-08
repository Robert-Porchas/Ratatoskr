import type { BrowserStep } from './protocol.js';

export const MAX_BRANCH_DEPTH = 2;

/** Iterative preflight runs before recursive schema parsing, including hostile CLI input. */
export function structureError(input: unknown): string | undefined {
  if (
    !input ||
    typeof input !== 'object' ||
    !('steps' in input) ||
    !Array.isArray(input.steps)
  )
    return;
  if (input.steps.length > 300)
    return 'Maximum 300 steps including both branches';
  const pending = input.steps.map((step: unknown) => ({ step, depth: 0 }));
  let count = 0;
  while (pending.length) {
    if (++count > 300) return 'Maximum 300 steps including both branches';
    const { step, depth } = pending.pop()!;
    if (!step || typeof step !== 'object') continue;
    const node = step as Record<string, unknown>;
    if (node.action === 'branch') {
      if (depth >= MAX_BRANCH_DEPTH) return 'Maximum branch nesting depth is 2';
      for (const key of ['then', 'else'] as const) {
        if (key in node && Array.isArray(node[key])) {
          if (node[key].length > 300)
            return 'Maximum 300 steps including both branches';
          pending.push(
            ...node[key].map((child: unknown) => ({
              step: child,
              depth: depth + 1,
            })),
          );
        }
      }
    }
  }
}

/** Stable preorder indexes include unselected branches, making failure indexes reproducible. */
export function flattenSteps(steps: BrowserStep[]): BrowserStep[] {
  return steps.flatMap((step) =>
    step.action === 'branch'
      ? [step, ...flattenSteps(step.then), ...flattenSteps(step.else ?? [])]
      : [step],
  );
}
