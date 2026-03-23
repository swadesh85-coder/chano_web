import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectionState } from '../../app/projection/projection.models';
import {
  selectFolderTreeViewModel,
  selectRecordListViewModel,
  selectThreadListViewModel,
  selectThreadRecordNodeViewModel,
} from './index';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1 },
    ],
    threads: [
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 2 },
    ],
    records: [
      {
        id: 'record-a',
        threadId: 'thread-a',
        type: 'text',
        name: 'Body A',
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        entityVersion: 3,
        lastEventVersion: 3,
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

describe('Explorer viewmodel module audit', () => {
  it('does not import projection store or projection engine', () => {
    const fileContents = fs.readFileSync(
      path.resolve(process.cwd(), 'src/viewmodels/explorer/index.ts'),
      'utf8',
    );

    expect(fileContents).not.toMatch(/ProjectionStore/);
    expect(fileContents).not.toMatch(/ProjectionEngine/);
    expect(fileContents).not.toMatch(/inject\(/);
  });

  it('is deterministic and mutation-safe for identical input', () => {
    const state = deepFreeze(createProjectionState());
    const before = JSON.stringify(state);

    const first = {
      folders: selectFolderTreeViewModel(state),
      threads: selectThreadListViewModel(state, 'folder-a'),
      records: selectRecordListViewModel(state, 'thread-a'),
      nodes: selectThreadRecordNodeViewModel(state, 'thread-a'),
    };
    const second = {
      folders: selectFolderTreeViewModel(state),
      threads: selectThreadListViewModel(state, 'folder-a'),
      records: selectRecordListViewModel(state, 'thread-a'),
      nodes: selectThreadRecordNodeViewModel(state, 'thread-a'),
    };

    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(before);
  });
});