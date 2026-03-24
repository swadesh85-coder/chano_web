import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ThreadViewComponent virtualization enforcement', () => {
  it('delegates_rendering_to_the_shared_virtualized_record_list_component', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/thread_view.ts'), 'utf8');
    const template = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/thread_view.html'), 'utf8');

    expect(source).toContain('imports: [RecordListComponent]');
    expect(source).toContain('<app-record-list');
    expect(template).toContain('<app-record-list');
  });

  it('removes_the_static_full_list_bypass_branch', () => {
    const template = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/thread_view.html'), 'utf8');

    expect(template).not.toContain('explorer-static-list');
    expect(template).not.toContain('@for (node of nodes; track trackNode($index, node))');
    expect(template).not.toContain('<app-content-item-row');
  });
});