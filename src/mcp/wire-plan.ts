import { z } from 'zod';
import type {
  StandardSchemaWithJSON,
  JsonSchemaType,
} from '@modelcontextprotocol/server';
import {
  BrowserPlanSchema,
  MAX_WORKFLOW_STEPS,
  type BrowserPlan,
  type BrowserTarget,
} from '../protocol.js';

const actions = {
  navigate: 'navigate',
  click: 'click',
  fill: 'fill',
  press: 'press',
  wait: 'wait_for',
  url: 'assert_url',
  has: 'assert_text',
  visible: 'assert_visible',
  select: 'select_option',
  check: 'check',
  uncheck: 'uncheck',
  hover: 'hover',
  extractText: 'extract_text',
  extractAttribute: 'extract_attribute',
  upload: 'upload_file',
  download: 'expect_download',
} as const;
const string = { type: 'string' } as const;
export const wirePlanJsonSchema = {
  type: 'object',
  required: ['url', 'steps'],
  additionalProperties: false,
  properties: {
    url: string,
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_WORKFLOW_STEPS,
      items: {
        type: 'object',
        required: ['do'],
        additionalProperties: false,
        properties: {
          do: { type: 'string', enum: Object.keys(actions) },
          role: string,
          name: string,
          label: string,
          text: string,
          testId: string,
          css: string,
          url: string,
          valueRef: string,
          key: string,
          contains: string,
          save: {
            type: 'string',
            description:
              'Unique identifier (letters/digits/underscores). Max 5 saved outputs, 200 chars each; returned on failure.',
          },
          attribute: string,
          option: string,
          optionLabel: string,
          optionIndex: { type: 'integer', minimum: 0 },
          fileName: string,
          popup: { type: 'boolean' },
          dialog: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['alert', 'confirm', 'prompt'] },
              action: { type: 'string', enum: ['accept', 'dismiss'] },
              valueRef: string,
            },
            required: ['type', 'action'],
            additionalProperties: false,
          },
        },
      },
    },
  },
} satisfies JsonSchemaType;

/** SDK advertises the guiding schema; application validation owns bounded repair errors.
 * No unvalidated value can reach the executor. This avoids SDK union-error explosions. */
export function applicationValidatedSchema(
  schema: Record<string, unknown>,
): StandardSchemaWithJSON<unknown, unknown> {
  return {
    '~standard': {
      version: 1,
      vendor: 'ratatoskr',
      validate: (value) => ({ value }),
      // Zod and SDK differ in vocabulary typings, not the emitted JSON format.
      jsonSchema: {
        input: () => schema as JsonSchemaType,
        output: () => schema as JsonSchemaType,
      },
    },
  };
}

export class InvalidWirePlan extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
const record = z.record(z.string(), z.unknown());
const locatorKeys = ['role', 'label', 'text', 'testId', 'css'] as const;
const common = [...locatorKeys, 'name'];
const fields: Record<keyof typeof actions, string[]> = {
  navigate: ['url'],
  click: [...common, 'popup', 'dialog'],
  fill: [...common, 'valueRef'],
  press: [...common, 'key'],
  wait: common,
  url: ['contains'],
  has: [...common, 'contains'],
  visible: common,
  select: [...common, 'option', 'optionLabel', 'optionIndex'],
  check: common,
  uncheck: common,
  hover: common,
  extractText: [...common, 'save'],
  extractAttribute: [...common, 'save', 'attribute'],
  upload: [...common, 'fileName'],
  download: common,
};

function object(value: unknown, path: string): Record<string, unknown> {
  const parsed = record.safeParse(value);
  if (!parsed.success) throw new InvalidWirePlan(path, 'Expected an object');
  return parsed.data;
}
function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    throw new InvalidWirePlan(
      path,
      'Expected non-empty text (maximum 2048 characters)',
    );
  return value;
}
function target(step: Record<string, unknown>, path: string): BrowserTarget {
  const present = locatorKeys.filter((key) => step[key] !== undefined);
  if (
    present.length !== 1 ||
    (step.name !== undefined && present[0] !== 'role')
  )
    throw new InvalidWirePlan(
      path,
      'Use exactly one locator: label, text, testId, css, or role (+name)',
    );
  const kind = present[0]!;
  const value = requiredString(step[kind], `${path}.${kind}`);
  switch (kind) {
    case 'role':
      return {
        kind,
        role: value,
        ...(step.name !== undefined
          ? { name: requiredString(step.name, `${path}.name`) }
          : {}),
      };
    case 'label':
      return { kind, label: value };
    case 'text':
      return { kind, text: value };
    case 'testId':
      return { kind, testId: value };
    case 'css':
      return { kind, selector: value };
  }
}

/** Compact MCP input -> strict canonical domain plan. CLI retains the canonical format. */
export function normalizeWirePlan(input: unknown): BrowserPlan {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > 64_000)
    throw new InvalidWirePlan('plan', 'Plan exceeds 64000-byte limit');
  const plan = object(input, 'plan');
  if (Object.keys(plan).some((key) => !['url', 'steps'].includes(key)))
    throw new InvalidWirePlan(
      'plan',
      'Use url and steps; CLI canonical plans are not MCP input',
    );
  const url = requiredString(plan.url, 'url');
  if (
    !Array.isArray(plan.steps) ||
    plan.steps.length < 1 ||
    plan.steps.length > MAX_WORKFLOW_STEPS
  )
    throw new InvalidWirePlan('steps', `Provide 1–${MAX_WORKFLOW_STEPS} steps`);
  const outputs: string[] = [];
  const steps = plan.steps.map((value, index) => {
    const path = `steps[${index}]`;
    const step = object(value, path);
    const op = step.do;
    if (typeof op !== 'string' || !Object.hasOwn(actions, op))
      throw new InvalidWirePlan(
        `${path}.do`,
        'Unsupported action; use a do value from the tool schema',
      );
    const doAction = op as keyof typeof actions;
    // A frequent, unambiguous assertion spelling: another locator + text as expectation.
    // Clicks and other operations still reject ambiguous locator combinations.
    if (
      doAction === 'has' &&
      step.contains === undefined &&
      typeof step.text === 'string' &&
      locatorKeys.some((key) => key !== 'text' && step[key] !== undefined)
    ) {
      step.contains = step.text;
      delete step.text;
    }
    if (
      Object.keys(step).some(
        (key) => key !== 'do' && !fields[doAction].includes(key),
      )
    )
      throw new InvalidWirePlan(
        path,
        `Unsupported field for ${doAction}; use the tool schema`,
      );
    const action = actions[doAction];
    const canonical: Record<string, unknown> = { action };
    if (doAction !== 'url' && doAction !== 'navigate')
      canonical.target = target(step, path);
    for (const field of [
      'url',
      'valueRef',
      'key',
      'contains',
      'attribute',
      'fileName',
    ])
      if (fields[doAction].includes(field))
        canonical[field] = requiredString(step[field], `${path}.${field}`);
    if (doAction === 'extractText' || doAction === 'extractAttribute') {
      const name = requiredString(step.save, `${path}.save`);
      if (name.length > 64 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new InvalidWirePlan(
          `${path}.save`,
          'Use an identifier such as orderNumber (max 64 letters/digits/underscores)',
        );
      if (outputs.includes(name))
        throw new InvalidWirePlan(`${path}.save`, 'Save names must be unique');
      outputs.push(name);
      if (outputs.length > 5)
        throw new InvalidWirePlan(`${path}.save`, 'Maximum five saved outputs');
      canonical.saveAs = name;
      canonical.maxChars = 200;
    }
    if (doAction === 'select') {
      const options = ['option', 'optionLabel', 'optionIndex'].filter(
        (key) => step[key] !== undefined,
      );
      if (options.length !== 1)
        throw new InvalidWirePlan(
          path,
          'select requires exactly one of option, optionLabel, optionIndex',
        );
      const key = options[0]!;
      canonical.option =
        key === 'optionIndex'
          ? { kind: 'index', index: step[key] }
          : {
              kind: key === 'option' ? 'value' : 'label',
              [key === 'option' ? 'value' : 'label']: requiredString(
                step[key],
                `${path}.${key}`,
              ),
            };
    }
    if (step.popup !== undefined) canonical.expectPopup = step.popup;
    if (step.dialog !== undefined) canonical.dialog = step.dialog;
    return canonical;
  });
  const parsed = BrowserPlanSchema.safeParse({
    startUrl: url,
    steps,
    ...(outputs.length ? { outputs } : {}),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.slice(0, 4).join('.') ?? 'plan';
    throw new InvalidWirePlan(
      path.slice(0, 100),
      'Invalid field; use safe HTTP(S) URLs, valid identifiers and the tool schema',
    );
  }
  return parsed.data;
}

export function invalidPlanResult(error: unknown) {
  const details =
    error instanceof InvalidWirePlan
      ? { path: error.path, message: error.message }
      : {
          path: 'arguments',
          message: 'Invalid arguments; use the tool schema',
        };
  const result = {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: 'INVALID_PLAN', ...details }),
      },
    ],
  };
  if (Buffer.byteLength(JSON.stringify(result)) >= 750) {
    result.content[0]!.text = JSON.stringify({
      error: 'INVALID_PLAN',
      path: 'arguments',
      message: 'Invalid arguments; use the tool schema',
    });
  }
  return result;
}
