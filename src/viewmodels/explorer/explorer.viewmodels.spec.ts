import { describe, expect, it } from 'vitest';
import { ProjectionEngine } from '../../app/projection/projection_engine';
import type {
  EventEnvelope,
  ProjectionSnapshotDocument,
  ProjectionState,
} from '../../app/projection/projection.models';
import { selectFolderTreeViewModel } from './folderTree.viewmodel';
import { selectRecordListViewModel, selectThreadRecordNodeViewModel } from './record.viewmodel';
import { selectThreadListViewModel } from './threadList.viewmodel';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-b', name: 'Folder B', parentId: null, entityVersion: 2, lastEventVersion: 2 },
      { id: 'folder-a-2', name: 'Folder A2', parentId: 'folder-a', entityVersion: 4, lastEventVersion: 4 },
      { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1, lastEventVersion: 1 },
      { id: 'folder-a-1', name: 'Folder A1', parentId: 'folder-a', entityVersion: 3, lastEventVersion: 3 },
    ],
    threads: [
      { id: 'thread-c', folderId: 'folder-a', title: 'Thread C', entityVersion: 4, lastEventVersion: 4 },
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 2, lastEventVersion: 2 },
      { id: 'thread-b', folderId: 'folder-a', title: 'Thread B', entityVersion: 3, lastEventVersion: 3 },
    ],
    records: [
      {
        id: 'record-3',
        threadId: 'thread-a',
        type: 'text',
        name: 'Third',
        createdAt: 3,
        editedAt: 3,
        orderIndex: 2,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 7,
        lastEventVersion: 7,
      },
      {
        id: 'record-1',
        threadId: 'thread-a',
        type: 'text',
        name: 'First',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 5,
        lastEventVersion: 5,
      },
      {
        id: 'record-2',
        threadId: 'thread-a',
        type: 'text',
        name: 'Second',
        createdAt: 2,
        editedAt: 2,
        orderIndex: 1,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 6,
        lastEventVersion: 6,
      },
      {
        id: 'record-b-1',
        threadId: 'thread-b',
        type: 'text',
        name: 'Thread B record',
        createdAt: 4,
        editedAt: 4,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 10,
        lastEventVersion: 10,
      },
      {
        id: 'record-c-1',
        threadId: 'thread-c',
        type: 'image',
        name: 'Thread C image',
        createdAt: 5,
        editedAt: 5,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: 'group-1',
        entityVersion: 10,
        lastEventVersion: 10,
        mediaId: 'media-1',
        mimeType: 'image/jpeg',
      },
    ],
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

function createSnapshotDocument(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-root',
        entityVersion: 1,
        lastEventVersion: 1,
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
        lastEventVersion: 2,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'thread-root',
          folderUuid: 'folder-root',
          title: 'Primary thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-root-1',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-1',
        data: {
          uuid: 'record-root-1',
          threadUuid: 'thread-root',
          type: 'text',
          body: 'Seed',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
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
      type: 'text',
      body: `Record ${eventVersion}`,
      createdAt: eventVersion,
      editedAt: eventVersion,
      orderIndex: eventVersion - 100,
      isStarred: false,
      imageGroupId: null,
    },
    checksum: overrides.checksum ?? 'sha256',
  };
}

function collectViewModels(state: ProjectionState) {
  return {
    folderTree: selectFolderTreeViewModel(state),
    threadList: selectThreadListViewModel(state, 'folder-root'),
    recordList: selectRecordListViewModel(state, 'thread-root'),
    threadNodes: selectThreadRecordNodeViewModel(state, 'thread-root'),
  };
}

describe('Explorer viewmodels', () => {
  it('deterministic_output_same_selector_input_identical_viewmodels', () => {
    const state = createProjectionState();

    const first = {
      folderTree: selectFolderTreeViewModel(state),
      threadList: selectThreadListViewModel(state, 'folder-a'),
      recordList: selectRecordListViewModel(state, 'thread-a'),
    };
    const second = {
      folderTree: selectFolderTreeViewModel(state),
      threadList: selectThreadListViewModel(state, 'folder-a'),
      recordList: selectRecordListViewModel(state, 'thread-a'),
    };

    expect(first).toEqual(second);
  });

  it('ordering_is_stable_across_multiple_executions', () => {
    const state = createProjectionState();
    const serializedRuns = Array.from({ length: 3 }, () => JSON.stringify({
      folderTree: selectFolderTreeViewModel(state),
      threadList: selectThreadListViewModel(state, 'folder-a'),
      recordList: selectRecordListViewModel(state, 'thread-a'),
    }));

    expect(new Set(serializedRuns).size).toBe(1);

    const folderTree = selectFolderTreeViewModel(state);
    expect(folderTree.map((node) => node.id)).toEqual(['folder-a', 'folder-b']);
    expect(folderTree[0]?.children.map((node) => node.id)).toEqual(['folder-a-1', 'folder-a-2']);

    const threadList = selectThreadListViewModel(state, 'folder-a');
    expect(threadList.map((thread) => thread.id)).toEqual(['thread-a', 'thread-b', 'thread-c']);
    expect(threadList.map((thread) => thread.lastEventVersion)).toEqual([2, 3, 4]);
    expect(threadList.map((thread) => thread.folderId)).toEqual(['folder-a', 'folder-a', 'folder-a']);

    const recordList = selectRecordListViewModel(state, 'thread-a');
    expect(recordList.map((record) => record.id)).toEqual(['record-1', 'record-2', 'record-3']);
    expect(recordList.map((record) => record.eventVersion)).toEqual([5, 6, 7]);
    expect(recordList.map((record) => record.threadId)).toEqual(['thread-a', 'thread-a', 'thread-a']);
  });

  it('derives thread record nodes directly from selector ordering without local resorting', () => {
    const state: ProjectionState = {
      folders: [],
      threads: [{ id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 1, lastEventVersion: 1 }],
      records: [
        {
          id: 'record-z',
          threadId: 'thread-a',
          type: 'text',
          name: 'Trailing text',
          createdAt: 3,
          editedAt: 3,
          orderIndex: 2,
          isStarred: false,
          imageGroupId: null,
          entityVersion: 3,
          lastEventVersion: 3,
        },
        {
          id: 'record-a1',
          threadId: 'thread-a',
          type: 'image',
          name: 'Lead image',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: 'group-a',
          entityVersion: 1,
          lastEventVersion: 1,
        },
        {
          id: 'record-a2',
          threadId: 'thread-a',
          type: 'image',
          name: 'Second image',
          createdAt: 2,
          editedAt: 2,
          orderIndex: 1,
          isStarred: false,
          imageGroupId: 'group-a',
          entityVersion: 2,
          lastEventVersion: 2,
        },
      ],
    };

    const nodes = selectThreadRecordNodeViewModel(state, 'thread-a');

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.kind).toBe('imageGroup');
    expect(nodes[0]?.key).toBe('imageGroup:group-a');
    expect(nodes[1]).toEqual({
      kind: 'record',
      key: 'record:record-z',
      record: expect.objectContaining({ id: 'record-z', eventVersion: 3 }),
    });
  });

  it('deep_hierarchy_renders_10_levels_without_losing_structure', () => {
    const folders = Array.from({ length: 11 }, (_value, index) => ({
      id: `folder-${index}`,
      name: `Folder ${index}`,
      parentId: index === 0 ? null : `folder-${index - 1}`,
      entityVersion: index + 1,
      lastEventVersion: index + 1,
    }));
    const state: ProjectionState = {
      folders,
      threads: [],
      records: [],
    };

    const tree = selectFolderTreeViewModel(state);
    const visitedIds: string[] = [];
    let current = tree[0] ?? null;

    while (current !== null) {
      visitedIds.push(current.id);
      current = current.children[0] ?? null;
    }

    expect(visitedIds).toEqual(Array.from({ length: 11 }, (_value, index) => `folder-${index}`));
  });

  it('folder_tree_updates_the_correct_parent_branch_only', () => {
    const initialState: ProjectionState = {
      folders: [
        { id: 'folder-root', name: 'Root', parentId: null, entityVersion: 1, lastEventVersion: 1 },
        { id: 'folder-a', name: 'Folder A', parentId: 'folder-root', entityVersion: 2, lastEventVersion: 2 },
        { id: 'folder-b', name: 'Folder B', parentId: 'folder-root', entityVersion: 3, lastEventVersion: 3 },
      ],
      threads: [],
      records: [],
    };
    const updatedState: ProjectionState = {
      ...initialState,
      folders: [
        ...initialState.folders,
        { id: 'folder-a-child', name: 'Folder A Child', parentId: 'folder-a', entityVersion: 4, lastEventVersion: 4 },
      ],
    };

    const initialTree = selectFolderTreeViewModel(initialState);
    const updatedTree = selectFolderTreeViewModel(updatedState);

    expect(initialTree[0]?.children.map((node) => node.id)).toEqual(['folder-a', 'folder-b']);
    expect(updatedTree[0]?.children.map((node) => node.id)).toEqual(['folder-a', 'folder-b']);
    expect(updatedTree[0]?.children[0]?.children.map((node) => node.id)).toEqual(['folder-a-child']);
    expect(updatedTree[0]?.children[1]?.children).toEqual([]);
  });

  it('purity_same_input_reference_produces_no_mutation', () => {
    const state = deepFreeze(createProjectionState());
    const before = JSON.stringify(state);

    selectFolderTreeViewModel(state);
    selectThreadListViewModel(state, 'folder-a');
    selectRecordListViewModel(state, 'thread-a');
    selectThreadRecordNodeViewModel(state, 'thread-c');

    expect(JSON.stringify(state)).toBe(before);
  });

  it('replay_safety_snapshot_plus_event_replay_yields_identical_viewmodels', () => {
    const firstEngine = new ProjectionEngine();
    const secondEngine = new ProjectionEngine();
    const snapshot = createSnapshotDocument();
    const events = [
      createEventEnvelope(101),
      createEventEnvelope(102, {
        entityType: 'thread',
        entityId: 'thread-root',
        operation: 'rename',
        payload: {
          uuid: 'thread-root',
          title: 'Primary thread renamed',
        },
      }),
    ];

    firstEngine.applySnapshot(snapshot, 100);
    secondEngine.applySnapshot(snapshot, 100);

    for (const event of events) {
      firstEngine.applyEvent(event);
      secondEngine.applyEvent(event);
    }

    expect(collectViewModels(firstEngine.state)).toEqual(collectViewModels(secondEngine.state));
  });
});