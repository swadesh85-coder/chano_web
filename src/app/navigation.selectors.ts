import type { ProjectionState } from './projection/projection.models';
import type { NavigationPane, NavigationState } from './navigation.state';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import { selectFolderById, selectThreadById } from '../projection/selectors';

const ROOT_FOLDER_ID = 'root';

export interface ResolvedNavigationState {
  readonly selectedFolderId: string | null;
  readonly selectedThreadId: string | null;
  readonly activePane: NavigationPane;
}

export function selectResolvedNavigationState(
  projectionState: ProjectionState,
  navigationState: NavigationState,
): NavigationState {
  const resolved = selectResolvedNavigation(projectionState, navigationState);
  return createNavigationState(
    resolved.selectedFolderId,
    resolved.selectedThreadId,
    resolved.activePane,
  );
}

export function selectResolvedNavigation(
  projectionState: ProjectionState,
  navigationState: NavigationState,
): ResolvedNavigationState {
  if (navigationState.activePane === 'thread') {
    const thread = selectThreadById(projectionState, navigationState.selectedThreadId);
    if (thread !== null) {
      return Object.freeze({
        selectedFolderId: selectNormalizedFolderId(thread.folderId, projectionState),
        selectedThreadId: thread.id,
        activePane: 'thread',
      });
    }

    const fallbackFolderId = selectValidFolderId(projectionState, navigationState.selectedFolderId);
    if (isFolderSelectionValid(projectionState, navigationState.selectedFolderId)) {
      return Object.freeze({
        selectedFolderId: fallbackFolderId,
        selectedThreadId: null,
        activePane: 'folder',
      });
    }

    return EMPTY_NAVIGATION_STATE;
  }

  if (navigationState.activePane === 'folder') {
    if (isFolderSelectionValid(projectionState, navigationState.selectedFolderId)) {
      return Object.freeze({
        selectedFolderId: selectValidFolderId(projectionState, navigationState.selectedFolderId),
        selectedThreadId: null,
        activePane: 'folder',
      });
    }

    return EMPTY_NAVIGATION_STATE;
  }

  return EMPTY_NAVIGATION_STATE;
}

export function selectSelectedFolderId(navigationState: NavigationState): string | null {
  return navigationState.selectedFolderId;
}

export function selectSelectedThreadId(navigationState: NavigationState): string | null {
  return navigationState.selectedThreadId;
}

export function selectActivePane(navigationState: NavigationState): NavigationPane {
  return navigationState.activePane;
}

export function isFolderSelectionValid(
  projectionState: ProjectionState,
  folderId: string | null,
): boolean {
  return folderId === null || selectFolderById(projectionState, folderId) !== null;
}

export function isThreadSelectionValid(
  projectionState: ProjectionState,
  threadId: string | null,
): boolean {
  return threadId !== null && selectThreadById(projectionState, threadId) !== null;
}

export function selectNormalizedFolderId(
  folderId: string | null,
  _projectionState: ProjectionState,
): string | null {
  if (folderId === ROOT_FOLDER_ID) {
    return null;
  }

  return folderId;
}

function selectValidFolderId(
  projectionState: ProjectionState,
  folderId: string | null,
): string | null {
  if (!isFolderSelectionValid(projectionState, folderId)) {
    return null;
  }

  return folderId;
}

function createNavigationState(
  selectedFolderId: string | null,
  selectedThreadId: string | null,
  activePane: NavigationPane,
): NavigationState {
  return Object.freeze({
    selectedFolderId,
    selectedThreadId,
    activePane,
  });
}
