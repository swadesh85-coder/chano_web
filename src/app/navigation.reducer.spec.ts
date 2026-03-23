import { describe, expect, it } from 'vitest';
import type { ProjectionState } from './projection/projection.models';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import {
  clearSelection,
  navigationReducer,
  restoreFromProjection,
  selectFolder,
  selectThread,
} from './navigation.reducer';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1 },
      { id: 'folder-b', name: 'Folder B', parentId: 'folder-a', entityVersion: 2 },
    ],
    threads: [
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 3 },
      { id: 'thread-root', folderId: 'root', title: 'Root Thread', entityVersion: 4 },
    ],
    records: [],
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

describe('navigationReducer', () => {
  it('selectFolder sets folder pane state and clears thread selection', () => {
    const initialState = {
      selectedFolderId: 'folder-b',
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    } as const;

    const nextState = navigationReducer(initialState, selectFolder('folder-a'));

    expect(nextState).toEqual({
      selectedFolderId: 'folder-a',
      selectedThreadId: null,
      activePane: 'folder',
    });
  });

  it('selectThread sets thread pane state with the parent folder reference', () => {
    const nextState = navigationReducer(EMPTY_NAVIGATION_STATE, selectThread('thread-a'));

    expect(nextState).toEqual({
      selectedFolderId: null,
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    });
  });

  it('clearSelection resets to the explicit empty pane', () => {
    const state = navigationReducer(EMPTY_NAVIGATION_STATE, selectThread('thread-a'));

    expect(navigationReducer(state, clearSelection())).toEqual(EMPTY_NAVIGATION_STATE);
  });

  it('restoreFromProjection safely clears invalid references without creating IDs', () => {
    const projectionState = deepFreeze(createProjectionState());
    const previousState = {
      selectedFolderId: 'missing-folder',
      selectedThreadId: 'missing-thread',
      activePane: 'thread',
    } as const;

    const beforeProjectionHash = JSON.stringify(projectionState);
    const nextState = navigationReducer(previousState, restoreFromProjection(projectionState));

    expect(nextState).toEqual(EMPTY_NAVIGATION_STATE);
    expect(JSON.stringify(projectionState)).toBe(beforeProjectionHash);
  });

  it('restoreFromProjection preserves deterministic thread selection and normalizes root folder IDs', () => {
    const projectionState = createProjectionState();
    const previousState = navigationReducer(EMPTY_NAVIGATION_STATE, selectThread('thread-root'));

    const first = navigationReducer(previousState, restoreFromProjection(projectionState));
    const second = navigationReducer(previousState, restoreFromProjection(projectionState));

    expect(first).toEqual(second);
    expect(first).toEqual({
      selectedFolderId: null,
      selectedThreadId: 'thread-root',
      activePane: 'thread',
    });
  });
});
