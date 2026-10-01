import { expect, it } from 'vitest';
import {
  observedFailure,
  runModel,
  type ModelTurn,
} from '../benchmarks/browser-evidence/agent.js';
import { cumulativeUsage } from '../benchmarks/browser-evidence/metrics.js';

it('preserves growing history and sums provider usage from every model turn', async () => {
  const turns: ModelTurn[] = [];
  let calls = 0;
  const report = await runModel(
    {
      model: 'test-model',
      prompt: 'identical task',
      instructions: 'identical instructions',
      tools: [
        {
          name: 'observe',
          description: 'Observe',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      maxTurns: 3,
      maxToolCalls: 3,
      maxOutputTokens: 100,
      signal: new AbortController().signal,
      call: async () => ({ text: '{"status":500}' }),
      beforeTurn: () => {
        calls++;
      },
      recordTurn: async (turn) => {
        turns.push(turn);
      },
    },
    async (request) => {
      const input = request.input as unknown[];
      if (calls === 1) {
        expect(input).toHaveLength(1);
        return {
          model: 'test-model-snapshot',
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          output: [
            { type: 'reasoning', encrypted_content: 'opaque-test-reasoning' },
            {
              type: 'function_call',
              name: 'observe',
              arguments: '{}',
              call_id: 'call1',
            },
          ],
        };
      }
      expect(input).toHaveLength(4);
      expect(JSON.stringify(input)).toContain('opaque-test-reasoning');
      expect(JSON.stringify(input)).toContain('status');
      return {
        model: 'test-model-snapshot',
        usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 },
        output: [
          {
            type: 'function_call',
            name: 'report_diagnosis',
            call_id: 'call2',
            arguments: JSON.stringify({
              persisted: false,
              method: 'POST',
              path: '/api/profile',
              status: 500,
              errorCode: 'INTERNAL_ERROR',
              evidence: ['observed failure'],
            }),
          },
        ],
      };
    },
  );
  expect(report.persisted).toBe(false);
  expect(calls).toBe(2);
  expect(cumulativeUsage(turns.map((turn) => turn.usage)).totalTokens).toBe(
    330,
  );
  expect(turns[1]?.request.instructions).toBe(turns[0]?.request.instructions);
});

it('does not infer diagnosis from a generic UI failure alone', () => {
  const evidence = observedFailure([
    JSON.stringify({ status: 'Unable to save profile.' }),
  ]);
  expect(evidence.persistenceFailure).toBe(true);
  expect(evidence.http).toBeUndefined();
  expect(evidence.code).toBeUndefined();
});
