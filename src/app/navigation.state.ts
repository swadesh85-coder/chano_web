export type NavigationPane = 'folder' | 'thread' | 'empty';

export interface NavigationState {
  readonly selectedFolderId: string | null;
  readonly selectedThreadId: string | null;
  readonly activePane: NavigationPane;
}

export const EMPTY_NAVIGATION_STATE: NavigationState = Object.freeze({
  selectedFolderId: null,
  selectedThreadId: null,
  activePane: 'empty',
});
