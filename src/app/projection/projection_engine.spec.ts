import { describe, expect, it, vi } from 'vitest';
import { ProjectionEngine } from './projection_engine';
import type { EventEnvelope, ProjectionState } from './projection.models';

function createSnapshotJson(): string {
  return JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-1',
          name: 'Inbox',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-1',
          folderUuid: 'folder-1',
          title: 'Roadmap',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-1',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-1',
          threadUuid: 'thread-1',
          type: 'text',
          body: 'Seed note',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

function createReplacementSnapshotJson(): string {
  return JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-2',
        entityVersion: 1,
        ownerUserId: 'owner-2',
        data: {
          uuid: 'folder-2',
          name: 'Archive',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-2',
        entityVersion: 1,
        ownerUserId: 'owner-2',
        data: {
          uuid: 'thread-2',
          folderUuid: 'folder-2',
          title: 'Imported',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-9',
        entityVersion: 1,
        ownerUserId: 'owner-2',
        data: {
          uuid: 'record-9',
          threadUuid: 'thread-2',
          type: 'text',
          body: 'Snapshot body',
          createdAt: 1711000000,
          editedAt: 1711000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

function createDeterministicSnapshotJson(): string {
  return JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-a',
        entityVersion: 1,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'folder-a',
          name: 'Alpha',
          parentFolderUuid: null,
        },
      },
      {
        entityType: 'folder',
        entityUuid: 'folder-b',
        entityVersion: 2,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'folder-b',
          name: 'Beta',
          parentFolderUuid: 'folder-a',
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-a',
        entityVersion: 3,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'thread-a',
          folderUuid: 'folder-a',
          title: 'Alpha Thread',
        },
      },
      {
        entityType: 'thread',
        entityUuid: 'thread-b',
        entityVersion: 4,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'thread-b',
          folderUuid: 'folder-b',
          title: 'Beta Thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-a',
        entityVersion: 5,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'record-a',
          threadUuid: 'thread-a',
          type: 'text',
          body: 'Alpha body',
          createdAt: 1710000010,
          editedAt: 1710000010,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
      {
        entityType: 'record',
        entityUuid: 'record-b',
        entityVersion: 6,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'record-b',
          threadUuid: 'thread-b',
          type: 'text',
          body: 'Beta body',
          createdAt: 1710000020,
          editedAt: 1710000020,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

function createUnorderedSnapshotJson(): string {
  return JSON.stringify({
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-b',
        entityVersion: 2,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'folder-b',
          name: 'Beta',
          parentFolderUuid: 'folder-a',
        },
      },
      {
        entityType: 'folder',
        entityUuid: 'folder-a',
        entityVersion: 1,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'folder-a',
          name: 'Alpha',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-b',
        entityVersion: 4,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'thread-b',
          folderUuid: 'folder-b',
          title: 'Beta Thread',
        },
      },
      {
        entityType: 'thread',
        entityUuid: 'thread-a',
        entityVersion: 3,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'thread-a',
          folderUuid: 'folder-a',
          title: 'Alpha Thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-c',
        entityVersion: 9,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'record-c',
          threadUuid: 'thread-a',
          type: 'text',
          body: 'Alpha 2',
          createdAt: 1710000040,
          editedAt: 1710000040,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: null,
        },
      },
      {
        entityType: 'record',
        entityUuid: 'record-b',
        entityVersion: 6,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'record-b',
          threadUuid: 'thread-b',
          type: 'text',
          body: 'Beta 1',
          createdAt: 1710000030,
          editedAt: 1710000030,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
      {
        entityType: 'record',
        entityUuid: 'record-a',
        entityVersion: 5,
        ownerUserId: 'owner-a',
        data: {
          uuid: 'record-a',
          threadUuid: 'thread-a',
          type: 'text',
          body: 'Alpha 1',
          createdAt: 1710000010,
          editedAt: 1710000010,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createEventEnvelope(
  eventVersion: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  const entityId = overrides.entityId ?? 'record-2';
  const entityType = overrides.entityType ?? 'record';
  const operation = overrides.operation ?? 'create';
  const payload = overrides.payload ?? {
    threadUuid: 'thread-1',
    type: 'text',
    body: `Body ${eventVersion}`,
    createdAt: 1710000000 + eventVersion,
  };

  return {
    eventId: overrides.eventId ?? `evt-${eventVersion}`,
    originDeviceId: overrides.originDeviceId ?? 'mobile-1',
    eventVersion,
    entityType,
    entityId,
    operation,
    timestamp: overrides.timestamp ?? 1710000000 + eventVersion,
    payload,
    checksum: overrides.checksum ?? 'sha256',
  };
}

function createDuplicateReplaySequence(): readonly EventEnvelope[] {
  return [
    createEventEnvelope(101),
    createEventEnvelope(102, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102',
      },
    }),
    createEventEnvelope(102, {
      eventId: 'evt-102-duplicate',
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102 duplicate',
      },
    }),
    createEventEnvelope(103, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 103',
      },
    }),
  ];
}

function createNonDuplicateReplaySequence(): readonly EventEnvelope[] {
  return [
    createEventEnvelope(101),
    createEventEnvelope(102, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102',
      },
    }),
    createEventEnvelope(103, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 103',
      },
    }),
  ];
}

function simulateDuplicateEvents(engine: ProjectionEngine) {
  return engine.trackApplyLog(createDuplicateReplaySequence());
}

function createGapReplaySequence(): readonly EventEnvelope[] {
  return [
    createEventEnvelope(101),
    createEventEnvelope(103, {
      entityId: 'record-3',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Gap event',
        createdAt: 1710000103,
      },
    }),
  ];
}

function simulateGapScenario(engine: ProjectionEngine) {
  return engine.trackApplyLog(createGapReplaySequence());
}

describe('ProjectionEngine', () => {
  it('projection_engine_apply_only_logic', () => {
    const engine = new ProjectionEngine();

    const result = engine.applySnapshot(createSnapshotJson(), 100);

    expect(result.status).toBe('SNAPSHOT_APPLIED');
    expect(engine.getLastAppliedEventVersion()).toBe(100);
    expect(engine.getProjectionState()).toEqual({
      folders: [{ id: 'folder-1', name: 'Inbox', parentId: null }],
      threads: [{ id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' }],
      records: [
        {
          id: 'record-1',
          threadId: 'thread-1',
          type: 'text',
          name: 'Seed note',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      ],
    });
  });

  it('projection_engine_no_validation_logic', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), 100);

    const createResult = engine.applyEvent(createEventEnvelope(101, {
      checksum: 'not-verified',
      payload: {
        uuid: 'different-uuid-in-payload',
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Created without engine validation',
        createdAt: 1710000101,
      },
    }));
    const renameResult = engine.applyEvent(createEventEnvelope(102, {
      entityId: 'record-2',
      operation: 'rename',
      payload: { body: 'Renamed body' },
    }));

    expect(createResult.status).toBe('EVENT_APPLIED');
    expect(renameResult.status).toBe('EVENT_APPLIED');
    expect(engine.getLastAppliedEventVersion()).toBe(102);
    expect(engine.getProjectionState().records).toEqual([
      {
        id: 'record-1',
        threadId: 'thread-1',
        type: 'text',
        name: 'Seed note',
        createdAt: 1710000000,
        editedAt: 1710000000,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
      },
      {
        id: 'record-2',
        threadId: 'thread-1',
        type: 'text',
        name: 'Renamed body',
        createdAt: 1710000101,
        editedAt: 1710000101,
        orderIndex: null,
        isStarred: false,
        imageGroupId: null,
      },
    ]);
  });

  it('projection_engine_gap_triggers_resync_callback', () => {
    const emitResyncRequired = vi.fn();
    const engine = new ProjectionEngine({ emitResyncRequired });
    engine.applySnapshot(createSnapshotJson(), 199);
    engine.applyEvent(createEventEnvelope(200));

    const gapResult = engine.applyEvent(createEventEnvelope(205, {
      entityId: 'record-5',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Gap event',
        createdAt: 1710000205,
      },
    }));

    expect(emitResyncRequired).toHaveBeenCalledWith('EVENT_GAP', {
      expectedEventVersion: 201,
      receivedEventVersion: 205,
    });
    expect(gapResult).toEqual({
      status: 'SNAPSHOT_RESYNC_REQUIRED',
      lastAppliedEventVersion: 200,
      state: engine.getProjectionState(),
      reason: 'EVENT_GAP',
      expectedEventVersion: 201,
      receivedEventVersion: 205,
    });
    expect(engine.getLastAppliedEventVersion()).toBe(200);
  });

  it('projection_engine_duplicate_ignore', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), 100);
    engine.applyEvent(createEventEnvelope(101));

    const duplicateResult = engine.applyEvent(createEventEnvelope(101));

    expect(duplicateResult.status).toBe('EVENT_IGNORED_DUPLICATE');
    expect(engine.getLastAppliedEventVersion()).toBe(101);
    expect(engine.getProjectionState().records).toHaveLength(2);
  });

  it('event_apply_sequential', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = engine.applyEventSequence([
      createEventEnvelope(101),
      createEventEnvelope(102, {
        entityId: 'record-2',
        operation: 'rename',
        payload: {
          body: 'Body 102',
        },
      }),
    ]);

    expect(result.applyLog).toEqual([
      'APPLY eventVersion=101',
      'APPLY eventVersion=102',
    ]);
    expect(result.lastAppliedEventVersion).toBe(102);
    expect(result.resyncRequired).toBe(false);
    expect(engine.trackLastAppliedVersion()).toBe(102);
    expect(engine.isResyncRequired()).toBe(false);
  });

  it('event_duplicate_ignore', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = simulateDuplicateEvents(engine);

    expect(result.applyLog).toEqual([
      'APPLY eventVersion=101',
      'APPLY eventVersion=102',
      'IGNORE duplicate eventVersion=102',
      'APPLY eventVersion=103',
    ]);
    expect(result.lastAppliedEventVersion).toBe(103);
    expect(result.resyncRequired).toBe(false);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY eventVersion=101 lastApplied=100']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY eventVersion=102 lastApplied=101']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_IGNORE_DUPLICATE version=102']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY eventVersion=103 lastApplied=102']);
    expect(engine.getProjectionState().records.find((record) => record.id === 'record-2')?.name).toBe('Body 103');

    consoleLog.mockRestore();
  });

  it('event_duplicate_idempotent', () => {
    const engine = new ProjectionEngine();
    const replayEngine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);
    replayEngine.applySnapshot(createSnapshotJson(), 100);

    expect(engine.applyEvent(createEventEnvelope(101)).status).toBe('EVENT_APPLIED');
    expect(engine.applyEvent(createEventEnvelope(102, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102',
      },
    })).status).toBe('EVENT_APPLIED');

    const stateBeforeDuplicate = engine.getProjectionState();

    const duplicateResult = engine.applyEvent(createEventEnvelope(102, {
      eventId: 'evt-102-duplicate',
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102 duplicate',
      },
    }));

    expect(duplicateResult.status).toBe('EVENT_IGNORED_DUPLICATE');
    expect(engine.getProjectionState()).toEqual(stateBeforeDuplicate);
    expect(engine.getLastAppliedEventVersion()).toBe(102);

    expect(engine.applyEvent(createEventEnvelope(103, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 103',
      },
    })).status).toBe('EVENT_APPLIED');

    const replayResult = replayEngine.trackApplyLog(createNonDuplicateReplaySequence());

    expect(engine.getProjectionState()).toEqual(replayResult.state);
    expect(engine.getLastAppliedEventVersion()).toBe(103);
    expect(replayResult.lastAppliedEventVersion).toBe(103);
  });

  it('event_duplicate_no_resync', () => {
    const emitResyncRequired = vi.fn();
    const engine = new ProjectionEngine({ emitResyncRequired });

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = simulateDuplicateEvents(engine);

    expect(result.lastAppliedEventVersion).toBe(103);
    expect(result.resyncRequired).toBe(false);
    expect(engine.isResyncRequired()).toBe(false);
    expect(emitResyncRequired).not.toHaveBeenCalled();
  });

  it('event_gap_detection', () => {
    const engine = new ProjectionEngine();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = simulateGapScenario(engine);
    const trackedState = engine.trackState();

    expect(result.applyLog).toEqual([
      'APPLY eventVersion=101',
      'RESYNC_TRIGGER eventVersion=103',
    ]);
    expect(result.lastAppliedEventVersion).toBe(101);
    expect(result.resyncRequired).toBe(true);
    expect(trackedState.lastAppliedEventVersion).toBe(101);
    expect(trackedState.resyncRequired).toBe(true);
    expect(trackedState.state.records.find((record) => record.id === 'record-3')).toBeUndefined();
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY version=101']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_GAP_DETECTED version=103']);
    expect(consoleLog.mock.calls).toContainEqual(['RESYNC_REQUIRED true']);

    consoleLog.mockRestore();
  });

  it('event_gap_no_apply', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);
    expect(engine.applyEvent(createEventEnvelope(101)).status).toBe('EVENT_APPLIED');

    const stateBeforeGap = engine.trackState();
    const gapResult = engine.applyEvent(createEventEnvelope(103, {
      entityId: 'record-3',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Gap event',
        createdAt: 1710000103,
      },
    }));
    const stateAfterGap = engine.trackState();

    expect(gapResult.status).toBe('SNAPSHOT_RESYNC_REQUIRED');
    expect(stateAfterGap).toEqual({
      ...stateBeforeGap,
      resyncRequired: true,
    });
    expect(stateAfterGap.state.records.find((record) => record.id === 'record-3')).toBeUndefined();
  });

  it('event_resync_trigger', () => {
    const emitResyncRequired = vi.fn();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const engine = new ProjectionEngine({ emitResyncRequired });

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = simulateGapScenario(engine);

    expect(result.applyLog).toEqual([
      'APPLY eventVersion=101',
      'RESYNC_TRIGGER eventVersion=103',
    ]);
    expect(result.lastAppliedEventVersion).toBe(101);
    expect(result.resyncRequired).toBe(true);
    expect(emitResyncRequired).toHaveBeenCalledWith('EVENT_GAP', {
      expectedEventVersion: 102,
      receivedEventVersion: 103,
    });
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_GAP_DETECTED version=103']);
    expect(consoleLog.mock.calls).toContainEqual(['RESYNC_REQUIRED true']);

    consoleLog.mockRestore();
  });

  it('event_recovery_after_snapshot', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);

    const gapResult = simulateGapScenario(engine);
    const stateBeforeRecovery = engine.trackState();

    expect(gapResult.applyLog).toEqual([
      'APPLY eventVersion=101',
      'RESYNC_TRIGGER eventVersion=103',
    ]);
    expect(stateBeforeRecovery.lastAppliedEventVersion).toBe(101);
    expect(stateBeforeRecovery.resyncRequired).toBe(true);

    const recoveryResult = engine.applySnapshot(createReplacementSnapshotJson(), 200);
    const stateAfterSnapshot = engine.trackState();

    expect(recoveryResult.status).toBe('SNAPSHOT_APPLIED');
    expect(stateAfterSnapshot.lastAppliedEventVersion).toBe(200);
    expect(stateAfterSnapshot.resyncRequired).toBe(false);
    expect(stateAfterSnapshot.state).toEqual(recoveryResult.state);

    const resumeResult = engine.applyEvent(createEventEnvelope(201, {
      entityId: 'record-10',
      payload: {
        threadUuid: 'thread-2',
        type: 'text',
        body: 'Recovered 201',
        createdAt: 1711000201,
      },
    }));

    expect(resumeResult.status).toBe('EVENT_APPLIED');
    expect(engine.trackState()).toEqual({
      lastAppliedEventVersion: 201,
      resyncRequired: false,
      state: engine.getProjectionState(),
    });
    expect(engine.getProjectionState().records.find((record) => record.id === 'record-10')?.name).toBe('Recovered 201');
  });

  it('event_start_boundary_valid', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = engine.applyEvent(createEventEnvelope(101));

    expect(result.status).toBe('EVENT_APPLIED');
    expect(consoleLog.mock.calls).toContainEqual(['BOUNDARY_CHECK expected=101 received=101']);
    expect(consoleLog.mock.calls).toContainEqual(['BOUNDARY_OK start=101']);

    consoleLog.mockRestore();
  });

  it('event_start_boundary_invalid_triggers_resync', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emitResyncRequired = vi.fn();
    const engine = new ProjectionEngine({ emitResyncRequired });

    engine.applySnapshot(createSnapshotJson(), 100);

    const result = engine.applyEvent(createEventEnvelope(105, {
      entityId: 'record-5',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Gap event',
        createdAt: 1710000205,
      },
    }));

    expect(result).toEqual({
      status: 'SNAPSHOT_RESYNC_REQUIRED',
      lastAppliedEventVersion: 100,
      state: engine.getProjectionState(),
      reason: 'EVENT_GAP',
      expectedEventVersion: 101,
      receivedEventVersion: 105,
    });
    expect(emitResyncRequired).toHaveBeenCalledWith('EVENT_GAP', {
      expectedEventVersion: 101,
      receivedEventVersion: 105,
    });
    expect(consoleLog.mock.calls).toContainEqual(['BOUNDARY_CHECK expected=101 received=105']);
    expect(consoleError.mock.calls).toContainEqual(['RESYNC_TRIGGERED']);

    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('event_stream_starts_correctly', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createSnapshotJson(), 100);

    const firstResult = engine.applyEvent(createEventEnvelope(101));
    const secondResult = engine.applyEvent(createEventEnvelope(102, {
      entityId: 'record-2',
      operation: 'rename',
      payload: {
        body: 'Body 102',
      },
    }));

    expect(firstResult.status).toBe('EVENT_APPLIED');
    expect(secondResult.status).toBe('EVENT_APPLIED');
    expect(engine.getLastAppliedEventVersion()).toBe(102);
    expect(engine.getProjectionState().records.find((record) => record.id === 'record-2')?.name).toBe('Body 102');
  });

  it('no_event_applied_before_boundary_check', () => {
    const emitResyncRequired = vi.fn();
    const engine = new ProjectionEngine({ emitResyncRequired });

    engine.applySnapshot(createSnapshotJson(), 100);
    const committedState = engine.getProjectionState();

    const duplicateResult = engine.applyEvent(createEventEnvelope(100));
    const invalidBoundaryResult = engine.applyEvent(createEventEnvelope(105, {
      entityId: 'record-5',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Should not apply',
        createdAt: 1710000205,
      },
    }));

    expect(duplicateResult.status).toBe('EVENT_IGNORED_DUPLICATE');
    expect(invalidBoundaryResult.status).toBe('SNAPSHOT_RESYNC_REQUIRED');
    expect(engine.getProjectionState()).toEqual(committedState);
    expect(engine.getLastAppliedEventVersion()).toBe(100);
    expect(emitResyncRequired).toHaveBeenCalledWith('EVENT_GAP', {
      expectedEventVersion: 101,
      receivedEventVersion: 105,
    });
  });

  it('projection_engine_deterministic_replay', () => {
    const firstEngine = new ProjectionEngine();
    const secondEngine = new ProjectionEngine();
    const events = [
      createEventEnvelope(101),
      createEventEnvelope(102, {
        entityId: 'thread-2',
        entityType: 'thread',
        payload: {
          folderUuid: 'folder-1',
          title: 'Backlog',
        },
      }),
      createEventEnvelope(103, {
        entityId: 'record-2',
        operation: 'move',
        payload: {
          threadUuid: 'thread-1',
        },
      }),
      createEventEnvelope(104, {
        entityId: 'thread-2',
        entityType: 'thread',
        operation: 'rename',
        payload: {
          title: 'Backlog Updated',
        },
      }),
    ];

    firstEngine.applySnapshot(createSnapshotJson(), 100);
    secondEngine.applySnapshot(createSnapshotJson(), 100);

    for (const event of events) {
      firstEngine.applyEvent(event);
      secondEngine.applyEvent(event);
    }

    const firstState = firstEngine.getProjectionState();
    const secondState = secondEngine.getProjectionState();

    expect(firstState).toEqual(secondState);
    expect(firstEngine.getLastAppliedEventVersion()).toBe(104);
    expect(secondEngine.getLastAppliedEventVersion()).toBe(104);
    expect(firstState).toEqual({
      folders: [{ id: 'folder-1', name: 'Inbox', parentId: null }],
      threads: [
        { id: 'thread-1', folderId: 'folder-1', title: 'Roadmap' },
        { id: 'thread-2', folderId: 'folder-1', title: 'Backlog Updated' },
      ],
      records: [
        {
          id: 'record-1',
          threadId: 'thread-1',
          type: 'text',
          name: 'Seed note',
          createdAt: 1710000000,
          editedAt: 1710000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
        {
          id: 'record-2',
          threadId: 'thread-1',
          type: 'text',
          name: 'Body 101',
          createdAt: 1710000101,
          editedAt: 1710000101,
          orderIndex: null,
          isStarred: false,
          imageGroupId: null,
        },
      ],
    } satisfies ProjectionState);
  });

  it('event_block_during_snapshot', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), 100);
    const committedState = engine.getProjectionState();

    engine.onSnapshotStart('snapshot-iso-1');
    const result = engine.onEvent(createEventEnvelope(101, {
      entityId: 'record-2',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Buffered body',
        createdAt: 1710000101,
      },
    }));

    expect(result.status).toBe('EVENT_BUFFERED');
    expect(engine.getProjectionState()).toEqual(committedState);
    expect(engine.getLastAppliedEventVersion()).toBe(100);
  });

  it('snapshot_event_buffering', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), 100);

    engine.onSnapshotStart('snapshot-iso-2');
    engine.onEvent(createEventEnvelope(101));
    engine.onEvent(createEventEnvelope(102, {
      entityId: 'record-3',
      payload: {
        threadUuid: 'thread-1',
        type: 'text',
        body: 'Buffered 102',
        createdAt: 1710000102,
      },
    }));

    expect(consoleLog.mock.calls).toContainEqual(['SNAPSHOT_ASSEMBLY_STARTED snapshotId=snapshot-iso-2']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_BUFFERED version=101']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_BUFFERED version=102']);

    consoleLog.mockRestore();
  });

  it('post_snapshot_event_apply', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const engine = new ProjectionEngine();

    engine.onSnapshotStart('snapshot-iso-3');
    engine.onEvent(createEventEnvelope(102, {
      entityId: 'record-10',
      operation: 'update',
      payload: {
        threadUuid: 'thread-2',
        type: 'text',
        body: 'Buffered 102',
        createdAt: 1711000101,
        editedAt: 1711000102,
      },
    }));
    engine.onEvent(createEventEnvelope(101, {
      entityId: 'record-10',
      payload: {
        threadUuid: 'thread-2',
        type: 'text',
        body: 'Buffered 101',
        createdAt: 1711000101,
      },
    }));
    engine.onEvent(createEventEnvelope(100, {
      entityId: 'record-ignored',
      payload: {
        threadUuid: 'thread-2',
        type: 'text',
        body: 'Ignored by base version',
        createdAt: 1711000100,
      },
    }));

    const result = engine.onSnapshotComplete(createReplacementSnapshotJson(), 100);
    const applyLog = [
      result.status,
      ...consoleLog.mock.calls
        .map(([message]) => message)
        .filter((message): message is string => typeof message === 'string' && message.startsWith('APPLY eventVersion=')),
    ];
    const snapshotApplied = result.status === 'SNAPSHOT_APPLIED';
    const eventAppliedAfterSnapshot = consoleLog.mock.calls.some(
      ([message]) => message === 'EVENT_APPLY version=101',
    );

    expect(result.appliedBufferedEventVersions).toEqual([101, 102]);
    expect(result.lastAppliedEventVersion).toBe(102);
    expect(result.state.records.find((record) => record.id === 'record-10')?.name).toBe('Buffered 102');
    expect(applyLog).toEqual([
      'SNAPSHOT_APPLIED',
      'APPLY eventVersion=101 entity=record id=record-10 op=create',
      'APPLY eventVersion=102 entity=record id=record-10 op=update',
    ]);
    expect(snapshotApplied).toBe(true);
    expect(eventAppliedAfterSnapshot).toBe(true);

    expect(consoleLog.mock.calls).toContainEqual(['SNAPSHOT_APPLIED']);
    expect(consoleLog.mock.calls).toContainEqual(['EVENT_APPLY version=101']);

    consoleLog.mockRestore();
  });

  it('snapshot_atomic_apply', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotJson(), 90);
    const committedState = engine.getProjectionState();

    engine.onSnapshotStart('snapshot-iso-4');
    engine.onEvent(createEventEnvelope(101, {
      entityId: 'record-10',
      payload: {
        threadUuid: 'thread-2',
        type: 'text',
        body: 'Buffered 101',
        createdAt: 1711000101,
      },
    }));

    expect(engine.getProjectionState()).toEqual(committedState);
    expect(engine.getLastAppliedEventVersion()).toBe(90);

    const result = engine.onSnapshotComplete(createReplacementSnapshotJson(), 100);

    expect(result.state).toEqual({
      folders: [{ id: 'folder-2', name: 'Archive', parentId: null }],
      threads: [{ id: 'thread-2', folderId: 'folder-2', title: 'Imported' }],
      records: [
        {
          id: 'record-9',
          threadId: 'thread-2',
          type: 'text',
          name: 'Snapshot body',
          createdAt: 1711000000,
          editedAt: 1711000000,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
        {
          id: 'record-10',
          threadId: 'thread-2',
          type: 'text',
          name: 'Buffered 101',
          createdAt: 1711000101,
          editedAt: 1711000101,
          orderIndex: null,
          isStarred: false,
          imageGroupId: null,
        },
      ],
    });
    expect(engine.getLastAppliedEventVersion()).toBe(101);
  });

  it('projection_determinism_repeat_load', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const snapshotJson = createDeterministicSnapshotJson();
    const mobileChecksum = await sha256Hex(snapshotJson);
    const firstEngine = new ProjectionEngine();
    const secondEngine = new ProjectionEngine();

    firstEngine.applySnapshot(snapshotJson, 200);
    secondEngine.applySnapshot(snapshotJson, 200);

    const firstSerialized = firstEngine.serializeProjectionState();
    const secondSerialized = secondEngine.serializeProjectionState();
    const firstChecksum = await firstEngine.computeProjectionChecksum();
    const secondChecksum = await secondEngine.computeProjectionChecksum();

    console.log(`mobileChecksum=${mobileChecksum}`);
    console.log(`webProjectionChecksum=${firstChecksum}`);
    console.log(`DETERMINISM_CHECK identical=${firstChecksum === secondChecksum}`);

    expect(firstSerialized).toBe(secondSerialized);
    expect(firstChecksum).toBe(secondChecksum);
    expect(firstChecksum).toBe(mobileChecksum);
    expect(consoleLog.mock.calls).toContainEqual(['PROJECTION_BUILD_COMPLETE entityCount=6']);
    expect(consoleLog.mock.calls).toContainEqual([`mobileChecksum=${mobileChecksum}`]);
    expect(consoleLog.mock.calls).toContainEqual([`webProjectionChecksum=${firstChecksum}`]);
    expect(consoleLog.mock.calls).toContainEqual(['DETERMINISM_CHECK identical=true']);

    consoleLog.mockRestore();
  });

  it('projection_entity_ordering', () => {
    const engine = new ProjectionEngine();

    engine.applySnapshot(createUnorderedSnapshotJson(), 150);

    expect(engine.getProjectionState()).toEqual({
      folders: [
        { id: 'folder-a', name: 'Alpha', parentId: null },
        { id: 'folder-b', name: 'Beta', parentId: 'folder-a' },
      ],
      threads: [
        { id: 'thread-a', folderId: 'folder-a', title: 'Alpha Thread' },
        { id: 'thread-b', folderId: 'folder-b', title: 'Beta Thread' },
      ],
      records: [
        {
          id: 'record-a',
          threadId: 'thread-a',
          type: 'text',
          name: 'Alpha 1',
          createdAt: 1710000010,
          editedAt: 1710000010,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
        {
          id: 'record-c',
          threadId: 'thread-a',
          type: 'text',
          name: 'Alpha 2',
          createdAt: 1710000040,
          editedAt: 1710000040,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: null,
        },
        {
          id: 'record-b',
          threadId: 'thread-b',
          type: 'text',
          name: 'Beta 1',
          createdAt: 1710000030,
          editedAt: 1710000030,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      ],
    });
    expect(JSON.parse(engine.serializeProjectionState())).toEqual({
      folders: [
        {
          entityType: 'folder',
          entityUuid: 'folder-a',
          entityVersion: 1,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'folder-a',
            name: 'Alpha',
            parentFolderUuid: null,
          },
        },
        {
          entityType: 'folder',
          entityUuid: 'folder-b',
          entityVersion: 2,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'folder-b',
            name: 'Beta',
            parentFolderUuid: 'folder-a',
          },
        },
      ],
      threads: [
        {
          entityType: 'thread',
          entityUuid: 'thread-a',
          entityVersion: 3,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'thread-a',
            folderUuid: 'folder-a',
            title: 'Alpha Thread',
          },
        },
        {
          entityType: 'thread',
          entityUuid: 'thread-b',
          entityVersion: 4,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'thread-b',
            folderUuid: 'folder-b',
            title: 'Beta Thread',
          },
        },
      ],
      records: [
        {
          entityType: 'record',
          entityUuid: 'record-a',
          entityVersion: 5,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'record-a',
            threadUuid: 'thread-a',
            type: 'text',
            body: 'Alpha 1',
            createdAt: 1710000010,
            editedAt: 1710000010,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
        {
          entityType: 'record',
          entityUuid: 'record-c',
          entityVersion: 9,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'record-c',
            threadUuid: 'thread-a',
            type: 'text',
            body: 'Alpha 2',
            createdAt: 1710000040,
            editedAt: 1710000040,
            orderIndex: 1,
            isStarred: false,
            imageGroupId: null,
          },
        },
        {
          entityType: 'record',
          entityUuid: 'record-b',
          entityVersion: 6,
          ownerUserId: 'owner-a',
          data: {
            uuid: 'record-b',
            threadUuid: 'thread-b',
            type: 'text',
            body: 'Beta 1',
            createdAt: 1710000030,
            editedAt: 1710000030,
            orderIndex: 0,
            isStarred: false,
            imageGroupId: null,
          },
        },
      ],
    });
  });
});