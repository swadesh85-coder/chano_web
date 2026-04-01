export type NavigationPane = 'folder' | 'thread' | 'empty';

export interface NavigationState {
  readonly selectedFolderId: string | null;
  readonly selectedThreadId: string | null;
}

export const EMPTY_NAVIGATION_STATE: NavigationState = Object.freeze({
  selectedFolderId: null,
  selectedThreadId: null,
});
