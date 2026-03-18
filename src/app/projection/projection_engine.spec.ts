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
      },
      {
        id: 'record-2',
        threadId: 'thread-1',
        type: 'text',
        name: 'Renamed body',
        createdAt: 1710000101,
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
        },
        {
          id: 'record-2',
          threadId: 'thread-1',
          type: 'text',
          name: 'Body 101',
          createdAt: 1710000101,
        },
      ],
    } satisfies ProjectionState);
  });
});