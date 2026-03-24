import { describe, expect, it } from 'vitest';
import type { ProjectionState } from './projection/projection.models';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import {
  selectActivePane,
  selectNormalizedFolderId,
  selectResolvedNavigation,
  selectResolvedNavigationState,
  selectSelectedFolderId,
  selectSelectedThreadId,
} from './navigation.selectors';

function createProjectionState(): ProjectionState {
  return {
    folders: [
      { id: 'folder-a', name: 'Folder A', parentId: null, entityVersion: 1, lastEventVersion: 1 },
    ],
    threads: [
      { id: 'thread-a', folderId: 'folder-a', title: 'Thread A', entityVersion: 2, lastEventVersion: 2 },
    ],
    records: [],
  };
}

describe('navigation selectors', () => {
  it('resolve navigation state keeps valid folder selections ID-only', () => {
    const projectionState = createProjectionState();
    const navigationState = {
      selectedFolderId: 'folder-a',
      selectedThreadId: null,
      activePane: 'folder',
    } as const;

    const resolved = selectResolvedNavigationState(projectionState, navigationState);

    expect(selectSelectedFolderId(resolved)).toBe('folder-a');
    expect(selectSelectedThreadId(resolved)).toBeNull();
    expect(selectActivePane(resolved)).toBe('folder');
  });

  it('resolve navigation state falls back from missing thread to the existing folder pane', () => {
    const projectionState = createProjectionState();
    const navigationState = {
      selectedFolderId: 'folder-a',
      selectedThreadId: 'missing-thread',
      activePane: 'thread',
    } as const;

    expect(selectResolvedNavigationState(projectionState, navigationState)).toEqual({
      selectedFolderId: 'folder-a',
      selectedThreadId: null,
      activePane: 'folder',
    });
  });

  it('resolve navigation derives the parent folder from projection for thread selection', () => {
    const projectionState = createProjectionState();
    const navigationState = {
      selectedFolderId: null,
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    } as const;

    expect(selectResolvedNavigation(projectionState, navigationState)).toEqual({
      selectedFolderId: 'folder-a',
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    });
  });

  it('resolve navigation state is deterministic for the same projection and navigation inputs', () => {
    const projectionState = createProjectionState();
    const navigationState = {
      selectedFolderId: 'folder-a',
      selectedThreadId: 'thread-a',
      activePane: 'thread',
    } as const;

    const first = selectResolvedNavigationState(projectionState, navigationState);
    const second = selectResolvedNavigationState(projectionState, navigationState);

    expect(first).toEqual(second);
  });

  it('empty pane remains empty with no implicit selection', () => {
    const projectionState = createProjectionState();

    expect(selectResolvedNavigationState(projectionState, EMPTY_NAVIGATION_STATE)).toEqual(
      EMPTY_NAVIGATION_STATE,
    );
  });

  it('selectNormalizedFolderId maps the projection root marker to the UI root reference only in selectors', () => {
    expect(selectNormalizedFolderId('root', createProjectionState())).toBeNull();
    expect(selectNormalizedFolderId('folder-a', createProjectionState())).toBe('folder-a');
  });
});
