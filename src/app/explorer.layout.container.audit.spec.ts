import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Explorer layout container audit', () => {
  it('keeps projection and ordering logic outside structural layout files', () => {
    const layoutSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer.layout.container.ts'), 'utf8');
    const contentPaneSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/content_pane.component.ts'), 'utf8');
    const folderTreeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/folder_tree.component.ts'), 'utf8');

    expect(layoutSource).not.toMatch(/ProjectionStateContainer|ProjectionEngine|ProjectionStore/);
    expect(layoutSource).not.toMatch(/selectFolders|selectThreadsByFolder|selectRecordListViewModel/);
    expect(layoutSource).not.toMatch(/\.sort\(|toSorted\(/);

    expect(contentPaneSource).not.toMatch(/ProjectionStateContainer|ProjectionEngine|ProjectionStore/);
    expect(contentPaneSource).not.toMatch(/\.sort\(|toSorted\(/);

    expect(folderTreeSource).not.toMatch(/ProjectionStateContainer|ProjectionEngine|ProjectionStore/);
    expect(folderTreeSource).not.toMatch(/\.sort\(|toSorted\(/);
  });
});