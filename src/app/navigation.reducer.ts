import type { ProjectionState } from './projection/projection.models';
import type { NavigationState } from './navigation.state';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import { selectNavigationAuthorityState } from './navigation.selectors';

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
      return createNavigationState(action.folderId, null);
    case 'selectThread':
      return createNavigationState(state.selectedFolderId, action.threadId);
    case 'clearSelection':
      return EMPTY_NAVIGATION_STATE;
    case 'restoreFromProjection':
      return selectNavigationAuthorityState(action.snapshotState, state);
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
): NavigationState {
  return Object.freeze({
    selectedFolderId,
    selectedThreadId,
  });
}
