# Browser Performance Profiling Report

- Generated at: 2026-03-24T09:44:36.626Z
- App URL: http://127.0.0.1:4173
- Dataset size: 13704 records, 72 threads, 22 folders
- Heavy thread size: 12000 records
- FPS observed: 3.1-128.2
- Max scripting time per frame: 16.67ms
- Long task count: 9
- Visible-items-only rendering: PASS
- Deterministic replay: PASS
- Pixel-stable replay: PASS
- Layout thrash detected: NO

## Interaction Metrics

### folder-selection
- FPS: 3.1-123.5 (avg 114.5)
- Dropped frames: 2
- Observer long tasks: 0
- Trace long tasks: 3
- Max scripting time/frame: 14.28ms
- Layout events: 20

### thread-selection
- FPS: 7.1-128.2 (avg 118.2)
- Dropped frames: 2
- Observer long tasks: 1
- Trace long tasks: 1
- Max scripting time/frame: 16.67ms
- Layout events: 12

### record-scroll-slow
- FPS: 30.0-125.0 (avg 119.3)
- Dropped frames: 3
- Observer long tasks: 0
- Trace long tasks: 0
- Max scripting time/frame: 16.67ms
- Layout events: 21

### record-scroll-fast
- FPS: 20.0-125.0 (avg 118.1)
- Dropped frames: 2
- Observer long tasks: 1
- Trace long tasks: 1
- Max scripting time/frame: 16.67ms
- Layout events: 22

### split-pane-resize
- FPS: 19.9-126.6 (avg 119.5)
- Dropped frames: 1
- Observer long tasks: 1
- Trace long tasks: 1
- Max scripting time/frame: 16.67ms
- Layout events: 0

## Validation

- Rendered nodes in heavy thread viewport: 16
- Rendered record rows: 16
- Rendered virtual rows: 16
- Record viewport client height: 1584002
- Record viewport scroll height: 1584002
- Deterministic signatures match: true
- Deterministic screenshots match: true

## Observed Improvements

- Record rendering remained bounded to the virtualized visible slice during deep scroll.
- Split-pane resize stayed free of layout events during the recorded drag.
- Folder and thread navigation completed without inconsistent selection state across repeated structural snapshots.

## Bottlenecks

- Long tasks were present during one or more interactions.
