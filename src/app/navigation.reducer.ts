import type { ProjectionState } from './projection/projection.models';
import type { NavigationState } from './navigation.state';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import { selectResolvedNavigationState } from './navigation.selectors';

export type NavigationAction =
  | {
      readonly type: 'selectFolder';
      readonly folderId: string | null;
    }
  | {
      readonly type: 'selectThread';
      readonly threadId: string;
    }
  | {
      readonly type: 'clearSelection';
    }
  | {
      readonly type: 'restoreFromProjection';
      readonly snapshotState: ProjectionState;
    };

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case 'selectFolder':
      return createNavigationState(action.folderId, null, 'folder');
    case 'selectThread':
      return createNavigationState(state.selectedFolderId, action.threadId, 'thread');
    case 'clearSelection':
      return EMPTY_NAVIGATION_STATE;
    case 'restoreFromProjection':
      return selectResolvedNavigationState(action.snapshotState, state);
  }
}

export function selectFolder(folderId: string | null): NavigationAction {
  return {
    type: 'selectFolder',
    folderId,
  };
}

export function selectThread(threadId: string): NavigationAction {
  return {
    type: 'selectThread',
    threadId,
  };
}

export function clearSelection(): NavigationAction {
  return {
    type: 'clearSelection',
  };
}

export function restoreFromProjection(snapshotState: ProjectionState): NavigationAction {
  return {
    type: 'restoreFromProjection',
    snapshotState,
  };
}

function createNavigationState(
  selectedFolderId: string | null,
  selectedThreadId: string | null,
  activePane: NavigationState['activePane'],
): NavigationState {
  return Object.freeze({
    selectedFolderId,
    selectedThreadId,
    activePane,
  });
}
