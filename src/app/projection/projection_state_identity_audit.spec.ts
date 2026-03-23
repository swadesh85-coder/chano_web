import { describe, expect, it } from 'vitest';
import { ProjectionEngine } from './projection_engine';
import type { ProjectionSnapshotDocument, ProjectionState } from './projection.models';
import {
  selectFolderById,
  selectFolderTree,
  selectImageGroupRecords,
  selectImageGroupsForThread,
  selectRecordById,
  selectRecordsByThread,
  selectThreadById,
  selectThreadsByFolder,
} from '../../projection/selectors';

type SelectorIdentityResult = {
  readonly sourceState: ProjectionState;
  readonly folderName: string | null;
  readonly threadTitle: string | null;
  readonly recordName: string | null;
  readonly rootFolderId: string | null;
  readonly threadIds: readonly string[];
  readonly recordIds: readonly string[];
  readonly imageGroupRecordIds: readonly string[];
  readonly imageGroupIds: readonly string[];
  readonly folderRef: ProjectionState['folders'][number] | null;
  readonly threadRef: ProjectionState['threads'][number] | null;
  readonly recordRef: ProjectionState['records'][number] | null;
};

function createSnapshotDocument(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-identity-1',
        entityVersion: 1,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'folder-identity-1',
          name: 'Identity Inbox',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-identity-1',
        entityVersion: 2,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'thread-identity-1',
          folderUuid: 'folder-identity-1',
          title: 'Identity Thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-identity-1',
        entityVersion: 3,
        lastEventVersion: 3,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'record-identity-1',
          threadUuid: 'thread-identity-1',
          type: 'image',
          body: 'Identity Image',
          createdAt: 1710000001,
          editedAt: 1710000001,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: 'image-group-identity-1',
        },
      },
    ],
  };
}

function createReplacementSnapshotDocument(): ProjectionSnapshotDocument {
  return {
    folders: [
      {
        entityType: 'folder',
        entityUuid: 'folder-identity-2',
        entityVersion: 10,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'folder-identity-2',
          name: 'Identity Archive',
          parentFolderUuid: null,
        },
      },
    ],
    threads: [
      {
        entityType: 'thread',
        entityUuid: 'thread-identity-2',
        entityVersion: 11,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'thread-identity-2',
          folderUuid: 'folder-identity-2',
          title: 'Replacement Thread',
        },
      },
    ],
    records: [
      {
        entityType: 'record',
        entityUuid: 'record-identity-2',
        entityVersion: 12,
        lastEventVersion: 12,
        ownerUserId: 'owner-identity',
        data: {
          uuid: 'record-identity-2',
          threadUuid: 'thread-identity-2',
          type: 'text',
          body: 'Replacement Record',
          createdAt: 1710000100,
          editedAt: 1710000100,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
        },
      },
    ],
  };
}

function readSelectorResult(engine: ProjectionEngine): SelectorIdentityResult {
  const sourceState = engine.state;
  const folder = sourceState.folders[0] ?? null;
  const thread = sourceState.threads[0] ?? null;
  const record = sourceState.records[0] ?? null;
  const rootFolderNode = selectFolderTree(sourceState)[0] ?? null;

  return {
    sourceState,
    folderName: folder === null ? null : selectFolderById(sourceState, folder.id)?.name ?? null,
    threadTitle: thread === null ? null : selectThreadById(sourceState, thread.id)?.title ?? null,
    recordName: record === null ? null : selectRecordById(sourceState, record.id)?.name ?? null,
    rootFolderId: rootFolderNode?.entity.id ?? null,
    threadIds: folder === null ? [] : selectThreadsByFolder(sourceState, folder.id).map((entry) => entry.id),
    recordIds: thread === null ? [] : selectRecordsByThread(sourceState, thread.id).map((entry) => entry.id),
    imageGroupRecordIds: record?.imageGroupId === null || record === null
      ? []
      : selectImageGroupRecords(sourceState, record.imageGroupId).map((entry) => entry.id),
    imageGroupIds: thread === null ? [] : selectImageGroupsForThread(sourceState, thread.id).map((entry) => entry.imageGroupId),
    folderRef: folder === null ? null : selectFolderById(sourceState, folder.id),
    threadRef: thread === null ? null : selectThreadById(sourceState, thread.id),
    recordRef: record === null ? null : selectRecordById(sourceState, record.id),
  };
}

describe('Projection state identity audit', () => {
  it('selector reads derive from the exact engine state instance without duplicating entities', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotDocument(), 100);

    const selectorResult = readSelectorResult(engine);

    expect(selectorResult.sourceState).toBe(engine.state);
    expect(selectorResult.folderName).toBe('Identity Inbox');
    expect(selectorResult.threadTitle).toBe('Identity Thread');
    expect(selectorResult.recordName).toBe('Identity Image');
    expect(selectorResult.rootFolderId).toBe('folder-identity-1');
    expect(selectorResult.threadIds).toEqual(['thread-identity-1']);
    expect(selectorResult.recordIds).toEqual(['record-identity-1']);
    expect(selectorResult.imageGroupRecordIds).toEqual(['record-identity-1']);
    expect(selectorResult.imageGroupIds).toEqual(['image-group-identity-1']);
    expect(selectorResult.folderRef).toEqual(engine.state.folders[0]);
    expect(selectorResult.folderRef).toBe(engine.state.folders[0]);
    expect(selectorResult.threadRef).toEqual(engine.state.threads[0]);
    expect(selectorResult.threadRef).toBe(engine.state.threads[0]);
    expect(selectorResult.recordRef).toEqual(engine.state.records[0]);
    expect(selectorResult.recordRef).toBe(engine.state.records[0]);
  });

  it('rebinds selector reads to the replacement engine state instance after snapshot swap', () => {
    const engine = new ProjectionEngine();
    engine.applySnapshot(createSnapshotDocument(), 100);
    const previousState = engine.state;

    engine.applySnapshot(createReplacementSnapshotDocument(), 200);

    const selectorResult = readSelectorResult(engine);

    expect(selectorResult.sourceState).toBe(engine.state);
    expect(selectorResult.sourceState).not.toBe(previousState);
    expect(selectorResult.folderName).toBe('Identity Archive');
    expect(selectorResult.threadTitle).toBe('Replacement Thread');
    expect(selectorResult.recordName).toBe('Replacement Record');
    expect(selectorResult.rootFolderId).toBe('folder-identity-2');
    expect(selectorResult.threadIds).toEqual(['thread-identity-2']);
    expect(selectorResult.recordIds).toEqual(['record-identity-2']);
    expect(selectorResult.imageGroupRecordIds).toEqual([]);
    expect(selectorResult.imageGroupIds).toEqual([]);
    expect(selectorResult.folderRef).toEqual(engine.state.folders[0]);
    expect(selectorResult.folderRef).toBe(engine.state.folders[0]);
    expect(selectorResult.threadRef).toEqual(engine.state.threads[0]);
    expect(selectorResult.threadRef).toBe(engine.state.threads[0]);
    expect(selectorResult.recordRef).toEqual(engine.state.records[0]);
    expect(selectorResult.recordRef).toBe(engine.state.records[0]);
  });
});