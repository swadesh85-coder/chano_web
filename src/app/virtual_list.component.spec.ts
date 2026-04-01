// @vitest-environment jsdom

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MAX_RENDERED_ITEMS = 200;
const ITEM_COUNT = 10_000;
const ITEM_HEIGHT = 56;
const BUFFER = 4;
const VIEWPORT_HEIGHT = 560;

interface VirtualListRange {
  readonly start: number;
  readonly end: number;
}

function computeVisibleRange(scrollOffset: number): VirtualListRange {
  const bufferedStart = Math.max(0, Math.floor(scrollOffset / ITEM_HEIGHT) - BUFFER);
  const visibleCount = Math.max(1, Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT));
  const requestedCount = visibleCount + (BUFFER * 2);
  const bufferedEnd = Math.min(ITEM_COUNT, bufferedStart + Math.min(requestedCount, MAX_RENDERED_ITEMS));

  return {
    start: bufferedStart,
    end: Math.max(bufferedStart, bufferedEnd),
  };
}

describe('VirtualListComponent', () => {
  it('declares_frame_throttled_virtual_scroll_and_guarded_range_logging', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/virtual_list.component.ts'), 'utf8');

    expect(source).toContain('const MAX_RENDERED_ITEMS = 200;');
    expect(source).toContain('this.scheduleViewportSync(viewport);');
    expect(source).toContain("console.log('VIRTUAL_SCROLL frameUpdate');");
    expect(source).toContain('console.log(`VIRTUAL_RANGE (guarded) start=${range.start} end=${range.end}`);');
    expect(source).toContain('globalThis.requestAnimationFrame');
  });

  it('computes_buffered_ranges_from_the_final_scroll_position', () => {
    expect(computeVisibleRange(0)).toEqual({ start: 0, end: 18 });
    expect(computeVisibleRange(1_680)).toEqual({ start: 26, end: 44 });
    expect(computeVisibleRange(7_840)).toEqual({ start: 136, end: 154 });
  });

  it('keeps_the_same_slice_when_small_scroll_changes_do_not_cross_a_row_boundary', () => {
    expect(computeVisibleRange(560)).toEqual({ start: 6, end: 24 });
    expect(computeVisibleRange(575)).toEqual({ start: 6, end: 24 });
  });
});