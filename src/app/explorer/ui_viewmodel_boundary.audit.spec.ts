import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const uiFiles = [
  'src/app/explorer/explorer.ts',
  'src/app/explorer/content_pane.ts',
  'src/app/explorer/folder_tree.ts',
  'src/app/explorer/record_list.ts',
  'src/app/explorer/thread_list.ts',
  'src/app/explorer/thread_view.ts',
  'src/app/explorer/media_viewer.ts',
];

const forbiddenUiMutation = [
  /\b(record|thread|folder|node|state)\.[A-Za-z_$][\w$]*\s*=(?!=)/,
  /\b(records|threads|folders|nodes|groupRecordIds)\.(push|pop|splice|shift|unshift|reverse|copyWithin|fill|sort)\(/,
];

describe('Explorer UI ViewModel boundary audit', () => {
  it('rejects selector, projection store, and facade imports inside UI components', () => {
    for (const relativePath of uiFiles) {
      const fileContents = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

      expect(fileContents).not.toMatch(/projection\.selectors/);
      expect(fileContents).not.toMatch(/src\/projection\/selectors/);
      expect(fileContents).not.toMatch(/\.\.\/projection\/projection\.store/);
      expect(fileContents).not.toMatch(/ProjectionStore/);
      expect(fileContents).not.toMatch(/ProjectionEngine/);
      expect(fileContents).not.toMatch(/ExplorerViewModelFacade/);
      expect(fileContents).not.toMatch(/\.state\(/);
    }
  });

  it('rejects mutation of selector and viewmodel inputs inside UI components', () => {
    for (const relativePath of uiFiles) {
      const fileContents = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

      for (const pattern of forbiddenUiMutation) {
        expect(fileContents).not.toMatch(pattern);
      }
    }
  });
});