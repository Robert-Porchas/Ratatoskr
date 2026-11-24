import type { RunResult } from './protocol.js';

const xml = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return (
        [9, 10, 13].includes(point) ||
        (point >= 32 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff) &&
          point !== 0xfffe &&
          point !== 0xffff)
      );
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export function runExitCode(result: RunResult, infrastructure = false): number {
  return result.success ? 0 : infrastructure ? 3 : 1;
}

/** One workflow is one CI testcase; errors distinguish infrastructure from assertions. */
export function junitReport(result: RunResult, infrastructure = false): string {
  const failed = !result.success;
  const tag = infrastructure ? 'error' : 'failure';
  const detail = failed
    ? `<${tag} message="${xml(result.reason)}">${xml(JSON.stringify(result))}</${tag}>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Ratatoskr" tests="1" failures="${Number(failed && !infrastructure)}" errors="${Number(failed && infrastructure)}"><testcase name="${xml(result.runId)}">${detail}<system-out>${xml(JSON.stringify({ runId: result.runId, ...(!result.success ? { artifacts: result.artifacts } : {}) }))}</system-out></testcase></testsuite>\n`;
}
