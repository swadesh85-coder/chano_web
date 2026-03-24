import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const scopedUiFiles = [
  'src/app/explorer/explorer.ts',
  'src/app/explorer.layout.container.ts',
  'src/app/content_pane.component.ts',
  'src/app/folder_tree.component.ts',
  'src/app/split_pane.component.ts',
  'src/app/toolbar.component.ts',
  'src/app/virtual_list.component.ts',
  'src/app/explorer/content_pane.ts',
  'src/app/explorer/folder_tree.ts',
  'src/app/explorer/thread_list.ts',
  'src/app/explorer/record_list.ts',
  'src/app/explorer/thread_view.ts',
  'src/app/explorer/media_viewer.ts',
] as const;

const scopedExternalTemplateFiles = [
  'src/app/explorer/explorer.html',
  'src/app/explorer/thread_view.html',
  'src/app/explorer/media_viewer.html',
  'src/app/explorer.layout.html',
] as const;

const scopedInlineTemplateHosts = [
  'src/app/content_pane.component.ts',
  'src/app/explorer/content_pane.ts',
] as const;

type ViolationCode =
  | 'object-from-entries-map'
  | 'object-group-by'
  | 'map-over-collection'
  | 'flatmap-in-ui'
  | 'reduce-aggregation'
  | 'sort-in-ui'
  | 'map-reconstruction'
  | 'set-reconstruction'
  | 'spread-aggregation'
  | 'recursive-traversal'
  | 'manual-grouping-logic'
  | 'template-excessive-pipes'
  | 'template-function-call'
  | 'template-inline-collection-transform';

interface Violation {
  readonly filePath: string;
  readonly code: ViolationCode;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
}

interface WhitelistEntry {
  readonly code: ViolationCode;
  readonly snippetIncludes?: string;
  readonly justification: string;
  readonly renderPathImpact: 'none';
}

interface TemplateSource {
  readonly reportPath: string;
  readonly sourceText: string;
  readonly absoluteOffset: number;
  readonly hostText: string;
}

const whitelist: Partial<Record<string, readonly WhitelistEntry[]>> = {
  __synthetic__: [
    {
      code: 'manual-grouping-logic',
      snippetIncludes: 'grouped[key] = []',
      justification: 'Synthetic fixture proves documented whitelist behavior for non-render-path exceptions.',
      renderPathImpact: 'none',
    },
  ],
  '__synthetic_template__': [
    {
      code: 'template-function-call',
      snippetIncludes: 'formatSize(state.size)',
      justification: 'Synthetic fixture proves template exception handling for a scalar-only formatter outside collection traversal.',
      renderPathImpact: 'none',
    },
  ],
  'src/app/explorer/media_viewer.html': [
    {
      code: 'template-function-call',
      snippetIncludes: 'formatSize(state.size)',
      justification: 'Formats a scalar media size for display without traversing collections or rebuilding render-path data.',
      renderPathImpact: 'none',
    },
  ],
};

const violationLabels: Record<ViolationCode, string> = {
  'object-from-entries-map': 'Object.fromEntries(...map(...)) in UI',
  'object-group-by': 'Object.groupBy(...) in UI',
  'map-over-collection': 'Array.prototype.map over a full collection in UI',
  'flatmap-in-ui': 'Array.prototype.flatMap over a full collection in UI',
  'reduce-aggregation': 'Array.prototype.reduce used for aggregation in UI',
  'sort-in-ui': 'Array.prototype.sort inside UI layer',
  'map-reconstruction': 'new Map([...]) collection reconstruction in UI',
  'set-reconstruction': 'new Set([...]) derived collection construction in UI',
  'spread-aggregation': 'Spread-based aggregation from an array clone in UI',
  'recursive-traversal': 'Recursive traversal function inside UI layer',
  'manual-grouping-logic': 'Manual grouping or indexed aggregation logic inside UI layer',
  'template-excessive-pipes': 'Template pipe chain exceeds two stages',
  'template-function-call': 'Template function call in interpolation or loop expression',
  'template-inline-collection-transform': 'Inline collection transform inside template loop expression',
};

describe('UI render purity audit', () => {
  it('covers the scoped explorer ui source and template surface', () => {
    expect(scopedUiFiles).toEqual([
      'src/app/explorer/explorer.ts',
      'src/app/explorer.layout.container.ts',
      'src/app/content_pane.component.ts',
      'src/app/folder_tree.component.ts',
      'src/app/split_pane.component.ts',
      'src/app/toolbar.component.ts',
      'src/app/virtual_list.component.ts',
      'src/app/explorer/content_pane.ts',
      'src/app/explorer/folder_tree.ts',
      'src/app/explorer/thread_list.ts',
      'src/app/explorer/record_list.ts',
      'src/app/explorer/thread_view.ts',
      'src/app/explorer/media_viewer.ts',
    ]);

    expect(scopedExternalTemplateFiles).toEqual([
      'src/app/explorer/explorer.html',
      'src/app/explorer/thread_view.html',
      'src/app/explorer/media_viewer.html',
      'src/app/explorer.layout.html',
    ]);

    expect(scopedInlineTemplateHosts).toEqual([
      'src/app/content_pane.component.ts',
      'src/app/explorer/content_pane.ts',
    ]);

    for (const relativePath of [...scopedUiFiles, ...scopedExternalTemplateFiles, ...scopedInlineTemplateHosts]) {
      expect(fs.existsSync(path.resolve(process.cwd(), relativePath))).toBe(true);
    }

    expect(loadScopedTemplateSources().map((source) => source.reportPath)).toEqual([
      'src/app/explorer/explorer.html',
      'src/app/explorer/thread_view.html',
      'src/app/explorer/media_viewer.html',
      'src/app/explorer.layout.html',
      'src/app/content_pane.component.ts#template',
      'src/app/explorer/content_pane.ts#template',
    ]);
  });

  it('detects the forbidden ui render patterns in a synthetic TypeScript violation fixture', () => {
    const source = `
      @Component({ selector: 'app-demo', template: '' })
      export class DemoComponent {
        readonly rows = input.required<readonly { id: string; group: string; items: readonly string[] }[]>();

        renderRows(): readonly string[] {
          const mapped = this.rows().map((row) => row.id);
          const grouped = Object.groupBy(this.rows(), (row) => row.group);
          const flatMapped = this.rows().flatMap((row) => row.items);
          const reduced = this.rows().reduce((total, row) => total + row.id.length, 0);
          const sorted = [...this.rows()].sort((left, right) => left.id.localeCompare(right.id));
          const clonedAndMapped = [...this.rows()].map((row) => row.id);
          const groupedLookup: Record<string, string[]> = {};
          for (const row of this.rows()) {
            const key = row.group;
            groupedLookup[key] = [];
            groupedLookup[key].push(row.id);
          }
          const entryLookup = Object.fromEntries(this.rows().map((row) => [row.id, row.group]));
          const derivedMap = new Map([[this.rows()[0]?.id ?? 'missing', this.rows()[0]?.group ?? 'missing']]);
          const derivedSet = new Set([...this.rows()].map((row) => row.id));
          return clonedAndMapped;
        }

        private walk(nodes: readonly string[]): number {
          return nodes.length === 0 ? 0 : this.walk(nodes.slice(1));
        }
      }
    `;

    const violations = collectTypeScriptViolations('__synthetic_violation__', source, {});
    const codes = new Set(violations.map((violation) => violation.code));

    expect(codes.has('map-over-collection')).toBe(true);
    expect(codes.has('object-group-by')).toBe(true);
    expect(codes.has('flatmap-in-ui')).toBe(true);
    expect(codes.has('reduce-aggregation')).toBe(true);
    expect(codes.has('sort-in-ui')).toBe(true);
    expect(codes.has('spread-aggregation')).toBe(true);
    expect(codes.has('manual-grouping-logic')).toBe(true);
    expect(codes.has('object-from-entries-map')).toBe(true);
    expect(codes.has('map-reconstruction')).toBe(true);
    expect(codes.has('set-reconstruction')).toBe(true);
    expect(codes.has('recursive-traversal')).toBe(true);
  });

  it('detects the forbidden template render patterns in a synthetic HTML violation fixture', () => {
    const template = `
      <section>
        {{ value | pipeA | pipeB | pipeC }}
        {{ computeLabel(record) }}
        @for (row of rows().map((item) => item.id); track row) {
          <span>{{ row }}</span>
        }
      </section>
    `;

    const source: TemplateSource = {
      reportPath: '__synthetic_template_violation__',
      sourceText: template,
      absoluteOffset: 0,
      hostText: template,
    };

    const violations = collectTemplateViolations(source, {});
    const codes = new Set(violations.map((violation) => violation.code));

    expect(codes.has('template-excessive-pipes')).toBe(true);
    expect(codes.has('template-function-call')).toBe(true);
    expect(codes.has('template-inline-collection-transform')).toBe(true);
  });

  it('allows only explicitly whitelisted js and template exceptions with documented justification', () => {
    const tsSource = `
      export class DemoComponent {
        logOutsideRender(rows: readonly { id: string; group: string }[]): void {
          const grouped: Record<string, string[]> = {};
          for (const row of rows) {
            const key = row.group;
            grouped[key] = [];
          }
          console.log(grouped);
        }
      }
    `;

    const template = `
      <div>
        {{ formatSize(state.size) }}
      </div>
    `;

    const source: TemplateSource = {
      reportPath: '__synthetic_template__',
      sourceText: template,
      absoluteOffset: 0,
      hostText: template,
    };

    const tsWithoutWhitelist = collectTypeScriptViolations('__synthetic__', tsSource, {});
    expect(tsWithoutWhitelist.map((violation) => violation.code)).toContain('manual-grouping-logic');

    const tsWithWhitelist = collectTypeScriptViolations('__synthetic__', tsSource, whitelist);
    expect(tsWithWhitelist).toEqual([]);

    const templateWithoutWhitelist = collectTemplateViolations(source, {});
    expect(templateWithoutWhitelist.map((violation) => violation.code)).toContain('template-function-call');

    const templateWithWhitelist = collectTemplateViolations(source, whitelist);
    expect(templateWithWhitelist).toEqual([]);
  });

  it('avoids false positives on lightweight template expressions', () => {
    const template = `
      @if (state !== null) {
        <span>{{ state.title }}</span>
        @for (node of nodes; track node.id) {
          <button type="button" (click)="open(node.id)" [disabled]="!enabled">Open</button>
        }
      }
    `;

    const source: TemplateSource = {
      reportPath: '__synthetic_template_clean__',
      sourceText: template,
      absoluteOffset: 0,
      hostText: template,
    };

    expect(collectTemplateViolations(source, {})).toEqual([]);
  });

  it('fails when forbidden render patterns are introduced into scoped ui source and template files', () => {
    const typeScriptViolations = scopedUiFiles.flatMap((relativePath) => {
      const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
      return collectTypeScriptViolations(relativePath, source, whitelist);
    });

    const templateViolations = loadScopedTemplateSources().flatMap((templateSource) => {
      return collectTemplateViolations(templateSource, whitelist);
    });

    const violations = [...typeScriptViolations, ...templateViolations];
    if (violations.length > 0) {
      throw new Error(formatViolationReport(violations));
    }

    expect(violations).toEqual([]);
  });
});

function collectTypeScriptViolations(
  filePath: string,
  sourceText: string,
  whitelistEntries: Partial<Record<string, readonly WhitelistEntry[]>>,
): readonly Violation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];

  visitNode(sourceFile, undefined);

  return dedupeViolations(violations).filter((violation) => !isWhitelisted(violation, whitelistEntries[violation.filePath] ?? []));

  function visitNode(node: ts.Node, activeFunctionName: string | undefined): void {
    const nextFunctionName = getDeclaredFunctionName(node) ?? activeFunctionName;

    if (ts.isCallExpression(node)) {
      collectCallExpressionViolations(node, nextFunctionName);
    }

    if (ts.isNewExpression(node)) {
      collectNewExpressionViolations(node);
    }

    if (ts.isBinaryExpression(node)) {
      collectGroupingViolations(node);
    }

    ts.forEachChild(node, (child) => visitNode(child, nextFunctionName));
  }

  function collectCallExpressionViolations(node: ts.CallExpression, activeFunctionName: string | undefined): void {
    if (isObjectFromEntriesMapCall(node)) {
      addTypeScriptViolation(node, 'object-from-entries-map');
    }

    if (isObjectGroupByCall(node)) {
      addTypeScriptViolation(node, 'object-group-by');
    }

    const expression = node.expression;
    if (ts.isPropertyAccessExpression(expression)) {
      const methodName = expression.name.text;

      if (methodName === 'map') {
        addTypeScriptViolation(node, 'map-over-collection');
      }

      if (methodName === 'flatMap') {
        addTypeScriptViolation(node, 'flatmap-in-ui');
      }

      if (methodName === 'reduce') {
        addTypeScriptViolation(node, 'reduce-aggregation');
      }

      if (methodName === 'sort') {
        addTypeScriptViolation(node, 'sort-in-ui');
      }

      if (isSpreadAggregationCall(node)) {
        addTypeScriptViolation(node, 'spread-aggregation');
      }

      if (methodName === 'push' && ts.isElementAccessExpression(expression.expression)) {
        addTypeScriptViolation(node, 'manual-grouping-logic');
      }
    }

    if (activeFunctionName !== undefined && isRecursiveCall(node, activeFunctionName)) {
      addTypeScriptViolation(node, 'recursive-traversal');
    }
  }

  function collectNewExpressionViolations(node: ts.NewExpression): void {
    if (isMapReconstruction(node)) {
      addTypeScriptViolation(node, 'map-reconstruction');
    }

    if (isSetReconstruction(node)) {
      addTypeScriptViolation(node, 'set-reconstruction');
    }
  }

  function collectGroupingViolations(node: ts.BinaryExpression): void {
    if (!isManualGroupingAssignment(node)) {
      return;
    }

    addTypeScriptViolation(node, 'manual-grouping-logic');
  }

  function addTypeScriptViolation(node: ts.Node, code: ViolationCode): void {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const snippet = node.getText(sourceFile).replace(/\s+/g, ' ').trim();

    violations.push({
      filePath,
      code,
      line: start.line + 1,
      column: start.character + 1,
      snippet,
      message: `${filePath}:${start.line + 1}:${start.character + 1} ${violationLabels[code]} :: ${snippet}`,
    });
  }
}

function collectTemplateViolations(
  templateSource: TemplateSource,
  whitelistEntries: Partial<Record<string, readonly WhitelistEntry[]>>,
): readonly Violation[] {
  const violations: Violation[] = [];

  for (const match of templateSource.sourceText.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const fullMatch = match[0];
    const expression = match[1] ?? '';
    const matchIndex = match.index ?? 0;

    if (countTemplatePipes(expression) > 2) {
      addTemplateViolation('template-excessive-pipes', fullMatch, matchIndex);
    }

    if (containsTemplateFunctionCall(expression)) {
      addTemplateViolation('template-function-call', fullMatch, matchIndex);
    }
  }

  for (const match of templateSource.sourceText.matchAll(/\[[^\]]+\]\s*=\s*"([^"]+)"/g)) {
    const fullMatch = match[0];
    const expression = match[1] ?? '';
    const matchIndex = match.index ?? 0;

    if (countTemplatePipes(expression) > 2) {
      addTemplateViolation('template-excessive-pipes', fullMatch, matchIndex);
    }
  }

  for (const loop of findTemplateLoopExpressions(templateSource.sourceText)) {
    if (containsInlineCollectionTransform(loop.expression)) {
      addTemplateViolation('template-inline-collection-transform', loop.fullMatch, loop.index);
    }

    if (containsTemplateLoopFunctionCall(loop.expression)) {
      addTemplateViolation('template-function-call', loop.fullMatch, loop.index);
    }
  }

  return dedupeViolations(violations).filter((violation) => !isWhitelisted(violation, whitelistEntries[violation.filePath] ?? []));

  function addTemplateViolation(code: ViolationCode, snippet: string, localIndex: number): void {
    const absoluteIndex = templateSource.absoluteOffset + localIndex;
    const start = getLineAndCharacter(templateSource.hostText, absoluteIndex);
    const normalizedSnippet = snippet.replace(/\s+/g, ' ').trim();

    violations.push({
      filePath: templateSource.reportPath,
      code,
      line: start.line,
      column: start.column,
      snippet: normalizedSnippet,
      message: `${templateSource.reportPath}:${start.line}:${start.column} ${violationLabels[code]} :: ${normalizedSnippet}`,
    });
  }
}

function loadScopedTemplateSources(): readonly TemplateSource[] {
  const externalTemplates = scopedExternalTemplateFiles.map((relativePath) => {
    const hostText = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
    return {
      reportPath: relativePath,
      sourceText: hostText,
      absoluteOffset: 0,
      hostText,
    } satisfies TemplateSource;
  });

  const inlineTemplates = scopedInlineTemplateHosts.flatMap((relativePath) => {
    const hostText = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
    return extractInlineTemplateSources(relativePath, hostText);
  });

  return [...externalTemplates, ...inlineTemplates];
}

function extractInlineTemplateSources(filePath: string, sourceText: string): readonly TemplateSource[] {
  const matches = [...sourceText.matchAll(/template\s*:\s*`([\s\S]*?)`/g)];
  return matches.map((match) => {
    const fullMatch = match[0] ?? '';
    const innerTemplate = match[1] ?? '';
    const fullMatchIndex = match.index ?? 0;
    const innerOffset = fullMatch.indexOf(innerTemplate);

    return {
      reportPath: `${filePath}#template`,
      sourceText: innerTemplate,
      absoluteOffset: fullMatchIndex + Math.max(innerOffset, 0),
      hostText: sourceText,
    } satisfies TemplateSource;
  });
}

function findTemplateLoopExpressions(templateSource: string): Array<{ readonly fullMatch: string; readonly expression: string; readonly index: number }> {
  const matches: Array<{ readonly fullMatch: string; readonly expression: string; readonly index: number }> = [];

  let searchIndex = 0;
  while (searchIndex < templateSource.length) {
    const atForIndex = templateSource.indexOf('@for', searchIndex);
    if (atForIndex === -1) {
      break;
    }

    const openParenIndex = templateSource.indexOf('(', atForIndex);
    if (openParenIndex === -1) {
      break;
    }

    const closeParenIndex = findBalancedClosingParen(templateSource, openParenIndex);
    if (closeParenIndex === -1) {
      break;
    }

    const fullMatch = templateSource.slice(atForIndex, closeParenIndex + 1);
    const header = templateSource.slice(openParenIndex + 1, closeParenIndex);
    const expression = extractForOfExpression(header);
    if (expression !== null) {
      matches.push({
        fullMatch,
        expression,
        index: atForIndex,
      });
    }

    searchIndex = closeParenIndex + 1;
  }

  for (const match of templateSource.matchAll(/\*ngFor\s*=\s*"([^"]+)"/g)) {
    const fullExpression = match[1] ?? '';
    const ofMatch = /\bof\s+([^;]+)(?:;|$)/.exec(fullExpression);
    if (ofMatch === null) {
      continue;
    }

    matches.push({
      fullMatch: match[0],
      expression: ofMatch[1].trim(),
      index: match.index ?? 0,
    });
  }

  return matches;
}

function findBalancedClosingParen(sourceText: string, openParenIndex: number): number {
  let depth = 0;
  for (let index = openParenIndex; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character !== ')') {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }

  return -1;
}

function extractForOfExpression(header: string): string | null {
  const ofIndex = header.indexOf(' of ');
  if (ofIndex === -1) {
    return null;
  }

  const expressionStart = ofIndex + 4;
  let depth = 0;
  for (let index = expressionStart; index < header.length; index += 1) {
    const character = header[index];
    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      continue;
    }

    if (character === ';' && depth === 0) {
      return header.slice(expressionStart, index).trim();
    }
  }

  return header.slice(expressionStart).trim();
}

function containsInlineCollectionTransform(expression: string): boolean {
  return /Object\.groupBy\s*\(|\.(map|flatMap|reduce|sort|filter)\s*\(|\[\s*\.\.\./.test(expression);
}

function containsTemplateFunctionCall(expression: string): boolean {
  return /(^|[^\w.])(?:this\.)?[A-Za-z_$][\w$]*\s*\(/.test(expression);
}

function containsTemplateLoopFunctionCall(expression: string): boolean {
  const normalizedExpression = expression.trim();
  if (/^(?:this\.)?[A-Za-z_$][\w$]*\(\)$/.test(normalizedExpression)) {
    return false;
  }

  return containsTemplateFunctionCall(normalizedExpression);
}

function countTemplatePipes(expression: string): number {
  const matches = expression.match(/(?<!\|)\|(?!\|)/g);
  return matches?.length ?? 0;
}

function getDeclaredFunctionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return node.name.text;
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  return undefined;
}

function isRecursiveCall(node: ts.CallExpression, functionName: string): boolean {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text === functionName;
  }

  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === functionName
    && expression.expression.kind === ts.SyntaxKind.ThisKeyword;
}

function isObjectFromEntriesMapCall(node: ts.CallExpression): boolean {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }

  if (expression.name.text !== 'fromEntries' || expression.expression.getText() !== 'Object') {
    return false;
  }

  const [firstArgument] = node.arguments;
  return firstArgument !== undefined
    && ts.isCallExpression(firstArgument)
    && ts.isPropertyAccessExpression(firstArgument.expression)
    && firstArgument.expression.name.text === 'map';
}

function isObjectGroupByCall(node: ts.CallExpression): boolean {
  const expression = node.expression;
  return ts.isPropertyAccessExpression(expression)
    && expression.expression.getText() === 'Object'
    && expression.name.text === 'groupBy';
}

function isSpreadAggregationCall(node: ts.CallExpression): boolean {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }

  if (!ts.isArrayLiteralExpression(expression.expression)) {
    return false;
  }

  if (!expression.expression.elements.some((element) => ts.isSpreadElement(element))) {
    return false;
  }

  return ['map', 'flatMap', 'reduce', 'sort', 'filter'].includes(expression.name.text);
}

function isMapReconstruction(node: ts.NewExpression): boolean {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'Map') {
    return false;
  }

  const [firstArgument] = node.arguments ?? [];
  return firstArgument !== undefined && isCollectionConstructionSource(firstArgument);
}

function isSetReconstruction(node: ts.NewExpression): boolean {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'Set') {
    return false;
  }

  const [firstArgument] = node.arguments ?? [];
  return firstArgument !== undefined && isCollectionConstructionSource(firstArgument);
}

function isCollectionConstructionSource(node: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(node)) {
    return true;
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    return ['map', 'flatMap', 'filter', 'reduce'].includes(node.expression.name.text)
      || (node.expression.name.text === 'from' && node.expression.expression.getText() === 'Array');
  }

  return false;
}

function isManualGroupingAssignment(node: ts.BinaryExpression): boolean {
  const operator = node.operatorToken.kind;
  if (
    operator !== ts.SyntaxKind.EqualsToken
    && operator !== ts.SyntaxKind.BarBarEqualsToken
    && operator !== ts.SyntaxKind.QuestionQuestionEqualsToken
  ) {
    return false;
  }

  if (!ts.isElementAccessExpression(node.left)) {
    return false;
  }

  return isGroupingInitializer(node.right);
}

function isGroupingInitializer(node: ts.Expression): boolean {
  return ts.isArrayLiteralExpression(node)
    || ts.isObjectLiteralExpression(node)
    || (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'Map' || node.expression.text === 'Set'));
}

function isWhitelisted(violation: Violation, entries: readonly WhitelistEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.code !== violation.code) {
      return false;
    }

    if (entry.justification.trim().length === 0 || entry.renderPathImpact !== 'none') {
      return false;
    }

    return entry.snippetIncludes === undefined || violation.snippet.includes(entry.snippetIncludes);
  });
}

function dedupeViolations(violations: readonly Violation[]): readonly Violation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.filePath}:${violation.line}:${violation.column}:${violation.code}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getLineAndCharacter(sourceText: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = sourceText.slice(0, offset);
  const lines = prefix.split('\n');
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function formatViolationReport(violations: readonly Violation[]): string {
  const lines = violations.map((violation) => `- ${violation.message}`);
  return ['UI render purity audit failed. Forbidden patterns detected:', ...lines].join('\n');
}
