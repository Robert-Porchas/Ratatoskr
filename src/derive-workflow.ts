import ts from 'typescript';
import { normalizeWirePlan } from './mcp/wire-plan.js';

interface Warning {
  location: string;
  reason: string;
}
export interface DerivedWorkflow {
  name: string;
  ready: boolean;
  convertedSteps: number;
  unsupported: Warning[];
  plan?: { url: string; steps: Record<string, unknown>[] };
}

function boundedOutput(workflows: DerivedWorkflow[]): DerivedWorkflow[] {
  if (Buffer.byteLength(JSON.stringify(workflows)) > 64_000)
    throw new Error(
      'Converted output exceeds 64000 bytes; use a smaller test file',
    );
  return workflows;
}

/** Syntax conversion only. Never imports, executes, follows imports or evaluates test code. */
export function deriveWorkflows(
  source: string,
  fileName: string,
  baseUrl?: string,
): DerivedWorkflow[] {
  if (Buffer.byteLength(source) > 256_000)
    throw new Error('Test source exceeds 256000 bytes');
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  // The compiler reports parser recovery; malformed source must never be marked ready.
  // Transpilation stays in memory: no imports are resolved and nothing is executed.
  const syntax = (
    ts.transpileModule(source, {
      fileName,
      compilerOptions: { target: ts.ScriptTarget.Latest },
      reportDiagnostics: true,
    }).diagnostics ?? []
  ).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntax.length)
    return boundedOutput([
      {
        name: 'invalid test source',
        ready: false,
        convertedSteps: 0,
        unsupported: syntax.slice(0, 25).map((diagnostic) => {
          const position = file.getLineAndCharacterOfPosition(
            diagnostic.start ?? 0,
          );
          return {
            location: `${fileName}:${position.line + 1}:${position.character + 1}`,
            reason: 'Invalid TypeScript syntax requires manual review',
          };
        }),
      },
    ]);
  const workflows: DerivedWorkflow[] = [];
  const literal = (node: ts.Node | undefined): string | undefined =>
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : undefined;
  const property = (
    node: ts.Node,
  ): { receiver: ts.Expression; method: string } | undefined =>
    ts.isPropertyAccessExpression(node)
      ? { receiver: node.expression, method: node.name.text }
      : undefined;
  const ref = (node: ts.Node | undefined): string | undefined => {
    if (node && ts.isNonNullExpression(node)) return ref(node.expression);
    if (
      !node ||
      !ts.isPropertyAccessExpression(node) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(node.name.text)
    )
      return;
    return node.expression.getText(file) === 'process.env'
      ? node.name.text
      : undefined;
  };
  const locator = (node: ts.Node): Record<string, string> | undefined => {
    if (!ts.isCallExpression(node)) return;
    const call = property(node.expression),
      value = literal(node.arguments[0]);
    if (!call || call.receiver.getText(file) !== 'page' || value === undefined)
      return;
    const keys: Record<string, string> = {
      getByLabel: 'label',
      getByText: 'text',
      getByTestId: 'testId',
      getByRole: 'role',
    };
    const key = keys[call.method];
    if (!key || node.arguments.length > (key === 'role' ? 2 : 1)) return;
    const result: Record<string, string> = { [key]: value };
    if (node.arguments[1]) {
      const options = node.arguments[1];
      if (
        !ts.isObjectLiteralExpression(options) ||
        options.properties.length !== 1
      )
        return;
      const name = options.properties[0];
      if (
        !name ||
        !ts.isPropertyAssignment(name) ||
        name.name.getText(file) !== 'name'
      )
        return;
      const text = literal(name.initializer);
      if (text === undefined) return;
      result.name = text;
    }
    return result;
  };
  const warn = (workflow: DerivedWorkflow, node: ts.Node, reason: string) => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    if (workflow.unsupported.length < 25)
      workflow.unsupported.push({
        location: `${fileName}:${position.line + 1}:${position.character + 1}`,
        reason,
      });
  };
  for (const statement of file.statements) {
    if (workflows.length >= 10) throw new Error('Maximum ten tests per input');
    if (ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression) ||
      statement.expression.expression.getText(file) !== 'test'
    ) {
      const workflow: DerivedWorkflow = {
        name: 'unsupported top-level construct',
        ready: false,
        convertedSteps: 0,
        unsupported: [],
      };
      warn(
        workflow,
        statement,
        'Only imports and top-level sequential test calls are supported',
      );
      workflows.push(workflow);
      continue;
    }
    if (workflows.length >= 10) throw new Error('Maximum ten tests per input');
    const call = statement.expression,
      callback = call.arguments[1];
    const workflow: DerivedWorkflow = {
      name: (literal(call.arguments[0]) ?? 'unnamed').slice(0, 80),
      ready: false,
      convertedSteps: 0,
      unsupported: [],
    };
    workflows.push(workflow);
    if (
      !callback ||
      !ts.isArrowFunction(callback) ||
      !ts.isBlock(callback.body) ||
      callback.parameters.length !== 1 ||
      callback.parameters[0]?.name.getText(file).replace(/\s/g, '') !== '{page}'
    ) {
      warn(
        workflow,
        statement,
        'Expected test(name, async ({ page }) => { sequential steps })',
      );
      continue;
    }
    let url: string | undefined;
    const steps: Record<string, unknown>[] = [];
    for (const line of callback.body.statements) {
      if (
        !ts.isExpressionStatement(line) ||
        !ts.isAwaitExpression(line.expression) ||
        !ts.isCallExpression(line.expression.expression)
      ) {
        warn(
          workflow,
          line,
          'Dynamic control flow, declarations and non-awaited statements require manual planning',
        );
        break;
      }
      const action = line.expression.expression,
        member = property(action.expression);
      if (!member) {
        warn(workflow, line, 'Unsupported call');
        break;
      }
      if (
        member.receiver.getText(file) === 'page' &&
        member.method === 'goto' &&
        action.arguments.length === 1
      ) {
        const route = literal(action.arguments[0]);
        try {
          if (route === undefined) throw new Error();
          const destination = new URL(route, baseUrl).href;
          if (!url) url = destination;
          else steps.push({ do: 'navigate', url: destination });
          continue;
        } catch {
          warn(
            workflow,
            line,
            'goto needs a literal HTTP(S) URL or --base-url for a relative route',
          );
          break;
        }
      }
      const target = locator(member.receiver);
      if (!url) {
        warn(workflow, line, 'The first action must be a literal page.goto');
        break;
      }
      if (
        target &&
        member.method === 'click' &&
        action.arguments.length === 0
      ) {
        steps.push({ do: 'click', ...target });
        continue;
      }
      if (target && member.method === 'fill' && action.arguments.length === 1) {
        const valueRef = ref(action.arguments[0]);
        if (valueRef) {
          steps.push({ do: 'fill', ...target, valueRef });
          continue;
        }
        warn(
          workflow,
          line,
          'fill needs process.env.VALUE_REF; literal or computed values are not emitted',
        );
        break;
      }
      if (
        ts.isCallExpression(member.receiver) &&
        member.receiver.expression.getText(file) === 'expect' &&
        member.receiver.arguments.length === 1
      ) {
        const expectedTarget = member.receiver.arguments[0]!;
        const expectedLocator = locator(expectedTarget);
        if (
          member.method === 'toBeVisible' &&
          expectedLocator &&
          action.arguments.length === 0
        ) {
          steps.push({ do: 'visible', ...expectedLocator });
          continue;
        }
        if (
          member.method === 'toContainText' &&
          expectedLocator &&
          action.arguments.length === 1 &&
          literal(action.arguments[0]) !== undefined
        ) {
          steps.push({
            do: 'has',
            ...expectedLocator,
            contains: literal(action.arguments[0]),
          });
          continue;
        }
        if (
          member.method === 'toHaveURL' &&
          expectedTarget.getText(file) === 'page' &&
          action.arguments.length === 1 &&
          literal(action.arguments[0]) !== undefined
        ) {
          steps.push({ do: 'url', contains: literal(action.arguments[0]) });
          warn(
            workflow,
            line,
            'toHaveURL becomes URL contains; review the weaker assertion',
          );
          continue;
        }
      }
      warn(
        workflow,
        line,
        'Unsupported locator, action, assertion or dynamic argument',
      );
      break;
    }
    workflow.convertedSteps = steps.length;
    if (url && steps.length) {
      try {
        const plan = { url, steps };
        normalizeWirePlan(plan);
        workflow.plan = plan;
      } catch {
        warn(
          workflow,
          statement,
          'Converted prefix failed BrowserPlan validation',
        );
      }
    } else
      warn(
        workflow,
        statement,
        'A literal initial goto and at least one supported step are required',
      );
    workflow.ready = Boolean(
      workflow.plan && workflow.unsupported.length === 0,
    );
  }
  if (
    workflows.some(
      (workflow) => workflow.name === 'unsupported top-level construct',
    )
  )
    for (const workflow of workflows) {
      workflow.ready = false;
      if (workflow.plan)
        warn(
          workflow,
          file,
          'Unsupported top-level setup may affect this test; review the converted prefix',
        );
    }
  return boundedOutput(workflows);
}
