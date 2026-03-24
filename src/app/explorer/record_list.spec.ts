import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RecordListComponent virtualization enforcement', () => {
  it('routes_record_rendering_through_total_count_and_visible_slice_inputs_only', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/record_list.ts'), 'utf8');

    expect(source).toContain('readonly totalItems = computed(() => this.contentPane.recordNodeCount(this.threadId()));');
    expect(source).toContain('readonly visibleNodes = computed(() => this.contentPane.visibleRecordNodes(this.threadId(), this.visibleRange()));');
    expect(source).toContain('[totalItems]="totalItems()"');
    expect(source).toContain('[renderedItems]="visibleNodes()"');
    expect(source).toContain('(rangeChanged)="updateVisibleRange($event)"');
  });

  it('does_not_accept_or_render_full_record_node_inputs_directly', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/explorer/record_list.ts'), 'utf8');

    expect(source).not.toContain('readonly nodes = input.required');
    expect(source).not.toContain('[items]="nodes()"');
    expect(source).not.toContain('@if (nodes().length === 0)');
  });
});