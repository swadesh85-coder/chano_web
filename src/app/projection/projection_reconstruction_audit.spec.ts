import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function listRuntimeTypeScriptFiles(dirPath: string): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...listRuntimeTypeScriptFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.ts') && !absolutePath.endsWith('.spec.ts')) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Projection reconstruction audit', () => {
  it('runtime source contains no legacy projection re-materialization patterns', () => {
    const runtimeFiles = listRuntimeTypeScriptFiles(path.resolve(process.cwd(), 'src'));
    const combinedSource = runtimeFiles
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(combinedSource).not.toMatch(/ProjectionSnapshotState|FolderProjectionEntity|ThreadProjectionEntity|RecordProjectionEntity/);
    expect(combinedSource).not.toMatch(/createEmptyProjectionSnapshotState|getProjectionState\(/);
    expect(combinedSource).not.toMatch(/ImageGroupProjection|groupsByThread|getImageGroups\(|buildImageGroups\(/);
    expect(combinedSource).not.toMatch(/Object\.values\(state\./);
  });

  it('projection consumers do not memoize derived projection collections in component state', () => {
    const explorerSource = readWorkspaceFile('src/app/explorer/explorer.ts');
    const mediaViewerSource = readWorkspaceFile('src/app/explorer/media_viewer.ts');

    expect(explorerSource).not.toMatch(/ProjectionStore/);
    expect(explorerSource).not.toMatch(/state\(\)\.(folders|threads|records)/);
    expect(mediaViewerSource).not.toMatch(/ProjectionStore/);
    expect(mediaViewerSource).not.toMatch(/state\(\)\.(folders|threads|records)/);
  });

  it('runtime projection files exist after cache removal cleanup', () => {
    const folderSelectorsPath = path.resolve(process.cwd(), 'src/projection/selectors/folder.selectors.ts');
    const threadSelectorsPath = path.resolve(process.cwd(), 'src/projection/selectors/thread.selectors.ts');
    const recordSelectorsPath = path.resolve(process.cwd(), 'src/projection/selectors/record.selectors.ts');
    const selectorsIndexPath = path.resolve(process.cwd(), 'src/projection/selectors/index.ts');
    const enginePath = path.resolve(process.cwd(), 'src/app/projection/projection_engine.ts');
    const storePath = path.resolve(process.cwd(), 'src/app/projection/projection.store.ts');
    const compatibilitySelectorsPath = path.resolve(process.cwd(), 'src/app/projection/projection.selectors.ts');

    expect(statSync(folderSelectorsPath).isFile()).toBe(true);
    expect(statSync(threadSelectorsPath).isFile()).toBe(true);
    expect(statSync(recordSelectorsPath).isFile()).toBe(true);
    expect(statSync(selectorsIndexPath).isFile()).toBe(true);
    expect(statSync(enginePath).isFile()).toBe(true);
    expect(statSync(storePath).isFile()).toBe(true);
    expect(() => statSync(compatibilitySelectorsPath)).toThrow();
  });
});