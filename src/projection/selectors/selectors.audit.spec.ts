import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function listSelectorFiles(): string[] {
  const selectorDir = path.resolve(process.cwd(), 'src/projection/selectors');

  return readdirSync(selectorDir)
    .map((entry) => path.join(selectorDir, entry))
    .filter((filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.spec.ts'));
}

function listRuntimeFiles(dirPath: string): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...listRuntimeFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.ts') && !absolutePath.endsWith('.spec.ts')) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

describe('Strict selector layer audit', () => {
  it('selector_modules_exist', () => {
    expect(statSync(path.resolve(process.cwd(), 'src/projection/selectors/folder.selectors.ts')).isFile()).toBe(true);
    expect(statSync(path.resolve(process.cwd(), 'src/projection/selectors/thread.selectors.ts')).isFile()).toBe(true);
    expect(statSync(path.resolve(process.cwd(), 'src/projection/selectors/record.selectors.ts')).isFile()).toBe(true);
    expect(statSync(path.resolve(process.cwd(), 'src/projection/selectors/index.ts')).isFile()).toBe(true);
  });

  it('selectors_are_pure_and_stateless_by_source_audit', () => {
    const selectorSource = listSelectorFiles()
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(selectorSource).not.toMatch(/ProjectionEngine|ProjectionStore|inject\(|signal\(|computed\(/);
    expect(selectorSource).not.toMatch(/console\.|async\s|await\s|Math\.random|Date\.now|globalThis/);
    expect(selectorSource).not.toMatch(/WeakMap|module\.exports/);
  });

  it('runtime_higher_layers_do_not_bypass_selector_boundary', () => {
    const runtimeSource = [
      ...listRuntimeFiles(path.resolve(process.cwd(), 'src/viewmodels')),
      ...listRuntimeFiles(path.resolve(process.cwd(), 'src/app/explorer')),
      ...listRuntimeFiles(path.resolve(process.cwd(), 'src/transport')),
    ]
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(runtimeSource).not.toMatch(/ProjectionEngine/);
    expect(runtimeSource).not.toMatch(/state\(\)\.(folders|threads|records)/);
    expect(runtimeSource).not.toMatch(/state\.(folders|threads|records)/);
  });

  it('selector_barrel_is_the_only_runtime_selector_entrypoint', () => {
    const runtimeFiles = listRuntimeFiles(path.resolve(process.cwd(), 'src'))
      .filter((filePath) => !filePath.includes(`${path.sep}projection${path.sep}selectors${path.sep}`));
    const runtimeSource = runtimeFiles
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(runtimeSource).not.toMatch(/projection\/selectors\/(?!index)/);
    expect(runtimeSource).not.toMatch(/projection\.selectors/);
  });

  it('projection_store_has_a_single_runtime_consumer', () => {
    const runtimeFiles = listRuntimeFiles(path.resolve(process.cwd(), 'src'));
    const storeImportConsumers = runtimeFiles.filter((filePath) =>
      readFileSync(filePath, 'utf8').includes("./projection.store")
      || readFileSync(filePath, 'utf8').includes("../projection/projection.store")
      || readFileSync(filePath, 'utf8').includes("../app/projection/projection.store"),
    );

    expect(storeImportConsumers).toEqual([
      path.resolve(process.cwd(), 'src/app/projection/projection_state.container.ts'),
    ]);
  });
});