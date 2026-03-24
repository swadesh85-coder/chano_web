import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const primitiveFiles = [
  'src/app/ui/list_row.component.ts',
  'src/app/ui/sidebar_item.component.ts',
  'src/app/ui/content_item_row.component.ts',
  'src/app/ui/section_header.component.ts',
  'src/app/ui/explorer_visual.tokens.ts',
] as const;

const tokenizedExplorerFiles = [
  'src/app/split_pane.component.ts',
  'src/app/explorer.layout.css',
  'src/app/explorer/media_viewer.css',
  'src/app/explorer/content_pane.ts',
  'src/app/explorer/thread_list.ts',
  'src/app/explorer/record_list.ts',
  'src/app/explorer/thread_view.ts',
] as const;

describe('Explorer UI primitives audit', () => {
  it('keep_ui_primitives_presentation_only', () => {
    for (const relativePath of primitiveFiles) {
      const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

      expect(source).not.toContain('ProjectionStateContainer');
      expect(source).not.toContain('ProjectionEngine');
      expect(source).not.toContain('ProjectionStore');
      expect(source).not.toContain('NavigationContainer');
      expect(source).not.toContain('ExplorerContainer');
      expect(source).not.toContain('inject(');
    }
  });

  it('keeps_badge_resolution_schema_driven_and_deterministic', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/ui/list_row.component.ts'), 'utf8');
    const tokenSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/ui/explorer_visual.tokens.ts'), 'utf8');

    expect(source).not.toContain('readonly badge = input');
    expect(tokenSource).toContain('resolveExplorerBadge');
    expect(tokenSource).toContain("root: 'ROOT'");
    expect(tokenSource).toContain("folder: 'DIR'");
    expect(tokenSource).toContain("thread: 'THR'");
    expect(tokenSource).toContain("text: 'REC'");
    expect(tokenSource).toContain("image: 'IMG'");
    expect(tokenSource).toContain("file: 'FIL'");
    expect(tokenSource).toContain("audio: 'AUD'");
  });

  it('declares_global_explorer_design_tokens_and_states', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(source).toContain('--space-1: 4px');
    expect(source).toContain('--explorer-toolbar-height: 72px');
    expect(source).toContain('--explorer-sidebar-min-width: 200px');
    expect(source).toContain('--explorer-sidebar-max-width: 50%');
    expect(source).toContain('--explorer-row-height-sidebar: 44px');
    expect(source).toContain('--explorer-row-height-thread: 88px');
    expect(source).toContain('--explorer-row-height-record: 132px');
    expect(source).toContain('--color-surface-hover');
    expect(source).toContain('--color-surface-selected');
    expect(source).toContain('.ui-list-row[data-selected=\'true\']');
    expect(source).toContain('.ui-list-row__main:focus-visible');
    expect(source).toContain('.empty-text');
  });

  it('consumes_layout_tokens_in_explorer_components_instead_of_magic_values', () => {
    for (const relativePath of tokenizedExplorerFiles) {
      const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

      expect(source).not.toContain('0.875rem');
      expect(source).not.toContain('0.75rem');
      expect(source).not.toContain('0.5rem');
      expect(source).not.toContain('200px');
      expect(source).not.toContain('220px');
      expect(source).not.toContain('320px');
      expect(source).not.toContain('44rem');
      expect(source).not.toContain('42rem');
    }
  });

  it('renders_thread_view_with_shared_content_row_primitive_and_no_legacy_bespoke_row_markup', () => {
    const template = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/thread_view.html'), 'utf8');
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/thread_view.ts'), 'utf8');

    expect(template).toContain('<app-content-item-row');
    expect(template).not.toContain('thread-view-item-body');
    expect(template).not.toContain('thread-view-open-button');
    expect(source).toContain("class: 'explorer-view-surface'");
    expect(source).not.toContain("styleUrl: './thread_view.css'");
  });
});