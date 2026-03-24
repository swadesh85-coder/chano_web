# Explorer Visual Baselines

Committed baseline images for the deterministic Explorer visual regression harness live in `visual-baseline/explorer/`.

The harness validates these surfaces:

- `folder-tree-panel`
- `content-empty-state`
- `thread-list-panel`
- `thread-view-panel`
- `record-list-viewport`
- `empty-thread-list-state`
- `empty-record-list-state`

Update the baselines only when the intended Explorer presentation changes:

```bash
npm run test:visual:update-baseline
```

Verification uses the same runner in read-only mode:

```bash
npm run test:visual
```

Generated current captures and diff artifacts are written under `reports/visual-regression/` and are intentionally ignored by git.