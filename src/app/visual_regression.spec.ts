// @vitest-environment node

import { describe, expect, it } from 'vitest';

describe('Explorer visual regression', () => {
  it('keeps the explorer captures pixel-stable against the committed baselines', { timeout: 180_000 }, async () => {
    const { runVisualRegression } = await import('../../scripts/visual-regression-runner.mjs');
    const result = await runVisualRegression({ updateBaseline: false });

    expect(result.passed).toBe(true);
    expect(result.failureCount).toBe(0);
    expect(result.captures.map((capture) => capture.id)).toEqual([
      'folder-tree-panel',
      'content-empty-state',
      'thread-list-panel',
      'thread-view-panel',
      'record-list-viewport',
      'empty-thread-list-state',
      'empty-record-list-state',
    ]);
  });
});