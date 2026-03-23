import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forbiddenParameterMutation = [
  /\bstate\.(folders|threads|records)\s*=(?!=)/,
  /\b(records|threads|nodes|groupRecords|groupRecordIds)\.(push|pop|splice|shift|unshift|reverse|copyWithin|fill|sort)\(/,
  /\b(record|thread|folder|node)\.[A-Za-z_$][\w$]*\s*=(?!=)/,
];

function listViewModelFiles(): string[] {
  const basePath = path.resolve(process.cwd(), 'src/viewmodels');
  const entries = readdirSync(basePath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(basePath, entry.name);
    if (entry.isDirectory()) {
      const childEntries = readdirSync(absolutePath, { withFileTypes: true });
      for (const childEntry of childEntries) {
        const childPath = path.join(absolutePath, childEntry.name);
        if (childEntry.isFile() && childPath.endsWith('.ts') && !childPath.endsWith('.spec.ts')) {
          filePaths.push(childPath);
        }
      }

      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.ts') && !absolutePath.endsWith('.spec.ts')) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

describe('Explorer viewmodel audit', () => {
  it('introduces_no_state_ownership_or_runtime_caching', () => {
    const source = listViewModelFiles()
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/signal\(|computed\(|inject\(/);
    expect(source).not.toMatch(/ProjectionEngine|ProjectionStore/);
    expect(source).not.toMatch(/new Map\(/);
    expect(source).not.toMatch(/memo|cache/i);
  });

  it('rejects_projection_and_selector_input_mutation_patterns', () => {
    for (const filePath of listViewModelFiles()) {
      const source = readFileSync(filePath, 'utf8');

      for (const pattern of forbiddenParameterMutation) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});