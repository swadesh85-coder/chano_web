import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import {
  clearSelection,
  navigationReducer,
  restoreFromProjection,
  selectFolder,
  selectThread,
  type NavigationAction,
} from './navigation.reducer';
import { EMPTY_NAVIGATION_STATE } from './navigation.state';
import {
  selectActivePane,
  selectResolvedNavigation,
  selectResolvedNavigationState,
  selectSelectedFolderId,
  selectSelectedThreadId,
} from './navigation.selectors';

@Injectable({ providedIn: 'root' })
export class NavigationContainer {
  private readonly projection = inject(ProjectionStateContainer);
  private readonly rawState = signal(EMPTY_NAVIGATION_STATE);

  private readonly projectionState = this.projection.state;

  readonly state = computed(() =>
    selectResolvedNavigationState(this.projectionState(), this.rawState()),
  );
  readonly selectedFolderId = computed(() => selectSelectedFolderId(this.state()));
  readonly selectedThreadId = computed(() => selectSelectedThreadId(this.state()));
  readonly activePane = computed(() => selectActivePane(this.state()));

  constructor() {
    effect(() => {
      const snapshotState = this.projectionState();
      untracked(() => {
        this.dispatch(restoreFromProjection(snapshotState));
      });
    });
  }

  selectFolder(folderId: string | null): void {
    this.dispatch(selectFolder(folderId));
  }

  selectThread(threadId: string): void {
    this.dispatch(selectThread(threadId));
  }

  clearSelection(): void {
    this.dispatch(clearSelection());
  }

  restoreFromProjection(): void {
    this.dispatch(restoreFromProjection(this.projectionState()));
  }

  private dispatch(action: NavigationAction): void {
    const previousState = untracked(() => this.state());
    const nextState = navigationReducer(previousState, action);
    const resolvedState = selectResolvedNavigation(this.projectionState(), nextState);
    if (isSameNavigationState(previousState, nextState)) {
      return;
    }

    this.rawState.set(nextState);
    if (action.type === 'selectThread') {
      console.log(
        `NAVIGATION action=selectThread thread=${resolvedState.selectedThreadId ?? 'null'} resolvedFolder=${resolvedState.selectedFolderId ?? 'null'} pane=${resolvedState.activePane}`,
      );
      return;
    }

    console.log(
      `NAVIGATION action=${action.type} folder=${resolvedState.selectedFolderId ?? 'null'} thread=${resolvedState.selectedThreadId ?? 'null'} pane=${resolvedState.activePane}`,
    );
  }
}

function isSameNavigationState(left: typeof EMPTY_NAVIGATION_STATE, right: typeof EMPTY_NAVIGATION_STATE): boolean {
  return left.selectedFolderId === right.selectedFolderId
    && left.selectedThreadId === right.selectedThreadId
    && left.activePane === right.activePane;
}
