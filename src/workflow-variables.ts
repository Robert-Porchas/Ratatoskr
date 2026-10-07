import type { BrowserPlan, BrowserStep } from './protocol.js';
import { RatatoskrError } from './errors.js';

const reference = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;
const allowed = new Set([
  'url',
  'contains',
  'name',
  'label',
  'text',
  'testId',
  'value',
]);

/** Only data-bearing fields can contain templates. Structural strings stay literal. */
export function templateFields(
  value: unknown,
  visit: (value: string, allowed: boolean) => void,
): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string') visit(field, allowed.has(key));
    else templateFields(field, visit);
  }
}

export function references(value: string): string[] {
  const names = [...value.matchAll(reference)].map((match) => match[1]!);
  if (value.replace(reference, '').includes('${'))
    throw new Error('Malformed interpolation');
  return names;
}

export function validateVariables(
  plan: Pick<BrowserPlan, 'steps' | 'parameters' | 'startUrl'>,
): string[] {
  const issues: string[] = [];
  const known = new Set(Object.keys(plan.parameters ?? {}));
  const refs = new Set<string>();
  for (const step of plan.steps) {
    if (step.action === 'fill' && step.valueRef) refs.add(step.valueRef);
    if (step.action === 'click' && step.dialog?.valueRef)
      refs.add(step.dialog.valueRef);
  }
  if (plan.startUrl.includes('${'))
    issues.push('Start URL cannot interpolate variables');
  for (const value of Object.values(plan.parameters ?? {}))
    if (value.includes('${')) issues.push('Parameters must be literal data');
  for (const step of plan.steps) {
    if (
      step.action === 'fill' &&
      (step.value === undefined) === (step.valueRef === undefined)
    )
      issues.push(
        'fill requires exactly one of valueRef or interpolated value',
      );
    templateFields(step, (value, permitted) => {
      try {
        const names = references(value);
        if (names.length && !permitted)
          issues.push('Interpolation is forbidden in this field');
        for (const name of names)
          if (!known.has(name)) issues.push(`UNDEFINED_VARIABLE: ${name}`);
      } catch {
        issues.push('Malformed interpolation');
      }
    });
    if (step.action === 'extract_text' || step.action === 'extract_attribute') {
      if (known.has(step.saveAs)) issues.push('Variable names must be unique');
      known.add(step.saveAs);
    }
  }
  if (known.size > 20) issues.push('Maximum 20 variables');
  if ([...known].some((name) => refs.has(name)))
    issues.push('Workflow variables cannot shadow valueRef names');
  return issues;
}

/** Values are substituted once, never recursively interpreted. No paths, CSS or code. */
export function interpolateStep(
  step: BrowserStep,
  variables: ReadonlyMap<string, string>,
): BrowserStep {
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && allowed.has(key)) {
      const result = value.replace(reference, (_match, name: string) => {
        const saved = variables.get(name);
        if (saved === undefined)
          throw new RatatoskrError(
            'undefined_variable',
            `UNDEFINED_VARIABLE: ${name}`,
          );
        return saved;
      });
      if (result.length > 2048)
        throw new RatatoskrError(
          'invalid_variable',
          'Interpolation exceeds 2048 characters',
        );
      return result;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([field, item]) => [
          field,
          visit(item, field),
        ]),
      );
    return value;
  };
  return visit(step) as BrowserStep;
}
