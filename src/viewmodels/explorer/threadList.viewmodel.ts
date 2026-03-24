import type {
  ProjectionState,
} from '../../app/projection/projection.models';
import {
  selectThreadsByFolder,
  selectThreadLastEventVersion,
  selectThreadRecordCount,
} from '../../projection/selectors';
import type {
  ThreadListItemSelectorView,
  ThreadListViewModel,
} from './explorer.viewmodel.types';

export function selectThreadListViewModel(
  state: ProjectionState,
  folderId: string | null,
): readonly ThreadListViewModel[] {
  return buildThreadListViewModel(buildThreadSelectorView(state, folderId));
}

export function buildThreadListViewModel(
  threads: readonly ThreadListItemSelectorView[],
): readonly ThreadListViewModel[] {
  return threads.map((thread) => {
    return {
      id: thread.entityId,
      title: thread.title,
      folderId: thread.folderId,
      lastEventVersion: thread.lastEventVersion,
      recordCount: thread.recordCount,
    };
  });
}

export function getThreadListVirtualKey(thread: ThreadListViewModel): string {
  return thread.id;
}

function buildThreadSelectorView(
  state: ProjectionState,
  folderId: string | null,
): readonly ThreadListItemSelectorView[] {
  return selectThreadsByFolder(state, folderId).map((thread) => {
    const lastEventVersion = selectThreadLastEventVersion(state, thread.id);
    if (lastEventVersion === null) {
      throw new Error(`Thread ${thread.id} missing authoritative lastEventVersion`);
    }

    return {
      entityId: thread.id,
      title: thread.title,
      folderId: thread.folderId,
      lastEventVersion,
      recordCount: selectThreadRecordCount(state, thread.id),
    };
  });
}
