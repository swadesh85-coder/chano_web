import type {
  ProjectionState,
} from '../../app/projection/projection.models';
import {
  selectThreadLastEventVersion,
  selectThreadRecordCount,
  selectThreadsByFolderId,
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

function buildThreadSelectorView(
  state: ProjectionState,
  folderId: string | null,
): readonly ThreadListItemSelectorView[] {
  const selection = selectThreadsByFolderId(state, folderId);

  return selection.threadIds.map((threadId) => {
    const thread = selection.threadMap[threadId]!;

    return {
      entityId: thread.id,
      title: thread.title,
      folderId: thread.folderId,
      lastEventVersion: selectThreadLastEventVersion(state, thread.id) ?? thread.entityVersion,
      recordCount: selectThreadRecordCount(state, thread.id),
    };
  });
}
