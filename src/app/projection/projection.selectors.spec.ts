import { describe, expect, it } from 'vitest';
import type { ProjectionState } from './projection.models';
import {
  selectFolders,
  selectFolderById,
  selectFolderChildren,
  selectFolderChildrenMap,
  selectRootFolders,
  selectFolderTree,
  selectImageGroupRecords,
  selectImageGroupsForThread,
  selectRecordEventVersion,
  selectRecords,
  selectRecordById,
  selectRecordMap,
  selectRecordsByThread,
  selectRecordsByThreadId,
  selectThreadLastEventVersion,
  selectThreadMap,
  selectThreadRecordCount,
  selectThreads,
  selectThreadById,
  selectThreadsByFolder,
  selectThreadsByFolderId,
} from '../../projection/selectors';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-1', name: 'Inbox', parentId: null, entityVersion: 1 },
      { id: 'folder-2', name: 'Archive', parentId: 'folder-1', entityVersion: 2 },
    ],
    threads: [
      { id: 'thread-1', folderId: 'folder-1', title: 'Roadmap', entityVersion: 3 },
    ],
    records: [
      {
        id: 'record-1',
        threadId: 'thread-1',
        type: 'image',
        name: 'Hero image',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: 'group-1',
        entityVersion: 4,
        lastEventVersion: 4,
        mediaId: 'media-1',
        mimeType: 'image/jpeg',
      },
      {
        id: 'record-2',
        threadId: 'thread-1',
        type: 'image',
        name: 'Hero image alt',
        createdAt: 2,
        editedAt: 2,
        orderIndex: 1,
        isStarred: false,
        imageGroupId: 'group-1',
        entityVersion: 5,
        lastEventVersion: 5,
        mediaId: 'media-2',
        mimeType: 'image/jpeg',
      },
      {
        id: 'record-3',
        threadId: 'thread-1',
        type: 'text',
        name: 'Summary',
        createdAt: 3,
        editedAt: 3,
        orderIndex: 2,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 6,
        lastEventVersion: 6,
      },
    ],
  };
}

describe('Projection selectors', () => {
  it('return fresh derived collections on each call', () => {
    const state = createProjectionState();

    const firstFolders = selectFolders(state);
    const secondFolders = selectFolders(state);
    const firstRootFolders = selectRootFolders(state);
    const secondRootFolders = selectRootFolders(state);
    const firstChildrenMap = selectFolderChildrenMap(state);
    const secondChildrenMap = selectFolderChildrenMap(state);
    const firstChildren = selectFolderChildren(state, 'folder-1');
    const secondChildren = selectFolderChildren(state, 'folder-1');
    const firstFolderTree = selectFolderTree(state);
    const secondFolderTree = selectFolderTree(state);
    const firstAllThreads = selectThreads(state);
    const secondAllThreads = selectThreads(state);
    const firstThreadMap = selectThreadMap(state);
    const secondThreadMap = selectThreadMap(state);
    const firstThreads = selectThreadsByFolder(state, 'folder-1');
    const secondThreads = selectThreadsByFolder(state, 'folder-1');
    const firstThreadsByFolderId = selectThreadsByFolderId(state, 'folder-1');
    const secondThreadsByFolderId = selectThreadsByFolderId(state, 'folder-1');
    const firstAllRecords = selectRecords(state);
    const secondAllRecords = selectRecords(state);
    const firstRecordMap = selectRecordMap(state);
    const secondRecordMap = selectRecordMap(state);
    const firstRecords = selectRecordsByThread(state, 'thread-1');
    const secondRecords = selectRecordsByThread(state, 'thread-1');
    const firstRecordsByThreadId = selectRecordsByThreadId(state, 'thread-1');
    const secondRecordsByThreadId = selectRecordsByThreadId(state, 'thread-1');
    const firstImageGroupRecords = selectImageGroupRecords(state, 'group-1');
    const secondImageGroupRecords = selectImageGroupRecords(state, 'group-1');
    const firstImageGroups = selectImageGroupsForThread(state, 'thread-1');
    const secondImageGroups = selectImageGroupsForThread(state, 'thread-1');

    expect(firstFolders).toEqual(secondFolders);
    expect(firstFolders).not.toBe(secondFolders);
    expect(firstFolders.rootFolderIds).toEqual(['folder-1']);
    expect(firstFolders.childrenByFolderId).toEqual({ 'folder-1': ['folder-2'] });
    expect(firstRootFolders).toEqual(secondRootFolders);
    expect(firstRootFolders).not.toBe(secondRootFolders);
    expect(firstChildrenMap).toEqual(secondChildrenMap);
    expect(firstChildrenMap).not.toBe(secondChildrenMap);
    expect(firstChildren).toEqual(secondChildren);
    expect(firstChildren).not.toBe(secondChildren);
    expect(firstFolderTree).toEqual(secondFolderTree);
    expect(firstFolderTree).not.toBe(secondFolderTree);
    expect(firstAllThreads).toEqual(secondAllThreads);
    expect(firstAllThreads).not.toBe(secondAllThreads);
    expect(firstThreadMap).toEqual(secondThreadMap);
    expect(firstThreadMap).not.toBe(secondThreadMap);
    expect(firstThreads).toEqual(secondThreads);
    expect(firstThreads).not.toBe(secondThreads);
    expect(firstThreadsByFolderId).toEqual(secondThreadsByFolderId);
    expect(firstThreadsByFolderId).not.toBe(secondThreadsByFolderId);
    expect(firstAllRecords).toEqual(secondAllRecords);
    expect(firstAllRecords).not.toBe(secondAllRecords);
    expect(firstRecordMap).toEqual(secondRecordMap);
    expect(firstRecordMap).not.toBe(secondRecordMap);
    expect(firstRecords).toEqual(secondRecords);
    expect(firstRecords).not.toBe(secondRecords);
    expect(firstRecordsByThreadId).toEqual(secondRecordsByThreadId);
    expect(firstRecordsByThreadId).not.toBe(secondRecordsByThreadId);
    expect(firstImageGroupRecords).toEqual(secondImageGroupRecords);
    expect(firstImageGroupRecords).not.toBe(secondImageGroupRecords);
    expect(firstImageGroups).toEqual(secondImageGroups);
    expect(firstImageGroups).not.toBe(secondImageGroups);
  });

  it('preserve authoritative entity identity while returning fresh selector collections', () => {
    const state = createProjectionState();

    expect(selectFolderById(state, 'folder-1')).toEqual(state.folders[0]);
    expect(selectFolderById(state, 'folder-1')).toBe(state.folders[0]);
    expect(selectThreadById(state, 'thread-1')).toEqual(state.threads[0]);
    expect(selectThreadById(state, 'thread-1')).toBe(state.threads[0]);
    expect(selectRecordById(state, 'record-1')).toEqual(state.records[0]);
    expect(selectRecordById(state, 'record-1')).toBe(state.records[0]);
  });

  it('orders folder hierarchy deterministically by orderIndex then entityVersion then id', () => {
    const state = {
      folders: [
        { id: 'folder-c', name: 'Folder C', parentId: null, entityVersion: 3, orderIndex: 2 },
        { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 2, orderIndex: null },
        { id: 'folder-b', name: 'Folder B', parentId: null, entityVersion: 1, orderIndex: 0 },
      ],
      threads: [],
      records: [],
    } as unknown as ProjectionState;

    expect(selectRootFolders(state)).toEqual(['folder-b', 'folder-c', 'folder-a']);
    expect(selectFolderTree(state).map((node) => node.entity.id)).toEqual(['folder-b', 'folder-c', 'folder-a']);
  });

  it('reflect changes immediately without selector cache invalidation', () => {
    const initialState = createProjectionState();
    const updatedState: ProjectionState = {
      ...initialState,
      records: [
        {
          ...initialState.records[0],
          orderIndex: 3,
          lastEventVersion: 9,
        },
        initialState.records[1],
        {
          ...initialState.records[2],
          name: 'Summary updated',
          orderIndex: 0,
          lastEventVersion: 10,
        },
      ],
    };

    expect(selectRecordsByThread(initialState, 'thread-1').map((record) => record.id)).toEqual([
      'record-1',
      'record-2',
      'record-3',
    ]);
    expect(selectRecordsByThread(updatedState, 'thread-1').map((record) => record.id)).toEqual([
      'record-3',
      'record-2',
      'record-1',
    ]);
    expect(selectThreadLastEventVersion(initialState, 'thread-1')).toBe(6);
    expect(selectThreadLastEventVersion(updatedState, 'thread-1')).toBe(10);
    expect(selectThreadRecordCount(updatedState, 'thread-1')).toBe(3);
    expect(selectImageGroupRecords(initialState, 'group-1').map((record) => record.id)).toEqual(['record-1', 'record-2']);
    expect(selectImageGroupRecords(updatedState, 'group-1').map((record) => record.id)).toEqual(['record-2', 'record-1']);
    expect(selectRecordEventVersion(updatedState.records[2]!)).toBe(10);
  });

  it('derives normalized thread and record selections with deterministic replay-safe ordering', () => {
    const state = {
      folders: [],
      threads: [
        { id: 'thread-c', folderId: 'folder-1', title: 'Thread C', entityVersion: 8 },
        { id: 'thread-a', folderId: 'folder-1', title: 'Thread A', entityVersion: 5 },
        { id: 'thread-b', folderId: 'folder-1', title: 'Thread B', entityVersion: 5 },
      ],
      records: [
        {
          id: 'record-c',
          threadId: 'thread-a',
          type: 'text',
          name: 'Third',
          createdAt: 3,
          editedAt: 3,
          orderIndex: null,
          isStarred: false,
          imageGroupId: null,
          entityVersion: 12,
          lastEventVersion: 12,
        },
        {
          id: 'record-a',
          threadId: 'thread-a',
          type: 'text',
          name: 'First',
          createdAt: 1,
          editedAt: 1,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
          entityVersion: 10,
          lastEventVersion: 10,
        },
        {
          id: 'record-b',
          threadId: 'thread-a',
          type: 'text',
          name: 'Second',
          createdAt: 2,
          editedAt: 2,
          orderIndex: 0,
          isStarred: false,
          imageGroupId: null,
          entityVersion: 11,
          lastEventVersion: 11,
        },
      ],
    } as ProjectionState;

    const threadSelection = selectThreadsByFolderId(state, 'folder-1');
    const recordSelection = selectRecordsByThreadId(state, 'thread-a');

    expect(threadSelection.threadIds).toEqual(['thread-a', 'thread-b', 'thread-c']);
    expect(Object.keys(threadSelection.threadMap)).toEqual(['thread-a', 'thread-b', 'thread-c']);
    expect(recordSelection.recordIds).toEqual(['record-a', 'record-b', 'record-c']);
    expect(Object.keys(recordSelection.recordMap)).toEqual(['record-a', 'record-b', 'record-c']);
  });
});