import { describe, expect, it } from 'vitest';
import { ProjectionEngine } from '../../app/projection/projection_engine';
import type {
  EventEnvelope,
  ProjectionSnapshotDocument,
  ProjectionState,
} from '../../app/projection/projection.models';
import {
  selectFolderById,
  selectFolderChildren,
  selectFolderChildrenMap,
  selectRootFolders,
  selectFolderTree,
  selectFolders,
  selectImageGroupRecords,
  selectImageGroupsForThread,
  selectRecordById,
  selectRecordEventVersion,
  selectRecords,
  selectRecordsByThread,
  selectThreadById,
  selectThreadLastEventVersion,
  selectThreadRecordCount,
  selectThreads,
  selectThreadsByFolder,
} from './index';

function createSnapshotDocument(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-root',
        entityVersion: 1,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'folder-root',
          name: 'Root',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-root',
        entityVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-root',
          folderUuid: 'folder-root',
          title: 'Main thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-1',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-1',
          threadUuid: 'thread-root',
          type: 'image',
          body: 'First image',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: 'group-1',
        },
      },
    ],
  };
}

function createEventEnvelope(
  eventVersion: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: overrides.eventId ?? `evt-${eventVersion}`,
    originDeviceId: overrides.originDeviceId ?? 'device-1',
    eventVersion,
    entityType: overrides.entityType ?? 'record',
    entityId: overrides.entityId ?? `record-${eventVersion}`,
    operation: overrides.operation ?? 'create',
    timestamp: overrides.timestamp ?? 1710000000 + eventVersion,
    payload: overrides.payload ?? {
      uuid: `record-${eventVersion}`,
      threadUuid: 'thread-root',
      type: 'image',
      body: `Image ${eventVersion}`,
      createdAt: eventVersion,
      editedAt: eventVersion,
      orderIndex: eventVersion - 100,
      isStarred: false,
      imageGroupId: 'group-1',
    },
    checksum: overrides.checksum ?? 'sha256',
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

function collectSelectorOutput(state: ProjectionState) {
  const firstRecord = state.records[0]?.id ?? null;

  return {
    folders: selectFolders(state),
    rootFolders: selectRootFolders(state),
    folderChildrenMap: selectFolderChildrenMap(state),
    folderById: selectFolderById(state, 'folder-root'),
    folderChildren: selectFolderChildren(state, null),
    folderTree: selectFolderTree(state),
    threads: selectThreads(state),
    threadById: selectThreadById(state, 'thread-root'),
    threadsByFolder: selectThreadsByFolder(state, 'folder-root'),
    threadRecordCount: selectThreadRecordCount(state, 'thread-root'),
    threadLastEventVersion: selectThreadLastEventVersion(state, 'thread-root'),
    records: selectRecords(state),
    recordById: selectRecordById(state, firstRecord),
    recordsByThread: selectRecordsByThread(state, 'thread-root'),
    imageGroupRecords: selectImageGroupRecords(state, 'group-1'),
    imageGroupsForThread: selectImageGroupsForThread(state, 'thread-root'),
    recordEventVersion: firstRecord === null ? null : selectRecordEventVersion(state.records[0]!),
  };
}

describe('Strict selector layer replay', () => {
  it('same_input_produces_identical_output', () => {
    const state = createProjectionState();

    expect(collectSelectorOutput(state)).toEqual(collectSelectorOutput(state));
  });

  it('does_not_mutate_input_state', () => {
    const state = deepFreeze(createProjectionState());
    const before = JSON.stringify(state);

    collectSelectorOutput(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('repeated_execution_is_deterministic', () => {
    const state = createProjectionState();
    const runs = Array.from({ length: 3 }, () => JSON.stringify(collectSelectorOutput(state)));

    expect(new Set(runs).size).toBe(1);
  });

  it('snapshot_and_event_replay_produce_identical_selector_output', () => {
    const firstEngine = new ProjectionEngine();
    const secondEngine = new ProjectionEngine();
    const snapshot = createSnapshotDocument();
    const events = [
      createEventEnvelope(101),
      createEventEnvelope(102, {
        entityId: 'record-102',
        payload: {
          uuid: 'record-102',
          threadUuid: 'thread-root',
          type: 'image',
          body: 'Second image',
          createdAt: 102,
          editedAt: 102,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: 'group-1',
        },
      }),
    ];

    firstEngine.applySnapshot(snapshot, 100);
    secondEngine.applySnapshot(snapshot, 100);

    for (const event of events) {
      firstEngine.applyEvent(event);
      secondEngine.applyEvent(event);
    }

    expect(collectSelectorOutput(firstEngine.state)).toEqual(collectSelectorOutput(secondEngine.state));
  });
});

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-root', name: 'Root', parentId: null, entityVersion: 1 },
    ],
    threads: [
      { id: 'thread-root', folderId: 'folder-root', title: 'Main thread', entityVersion: 2 },
    ],
    records: [
      {
        id: 'record-1',
        threadId: 'thread-root',
        type: 'image',
        name: 'First image',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: 'group-1',
        entityVersion: 3,
        lastEventVersion: 3,
      },
    ],
  };
}