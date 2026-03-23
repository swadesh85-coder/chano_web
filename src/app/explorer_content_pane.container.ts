import { Injectable, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type { NavigationPane } from './navigation.state';
import type {
  ContentPaneViewModel,
  RecordListViewModel,
  ThreadListViewModel,
} from '../viewmodels';
import {
  selectRecordListViewModel,
  selectThreadListViewModel,
} from '../viewmodels';

const EMPTY_THREADS: readonly ThreadListViewModel[] = [];
const EMPTY_RECORDS: readonly RecordListViewModel[] = [];
const EMPTY_CONTENT_PANE: ContentPaneViewModel = Object.freeze({
  mode: 'empty',
  threadList: EMPTY_THREADS,
  recordList: EMPTY_RECORDS,
});

@Injectable({ providedIn: 'root' })
export class ExplorerContentPaneContainer {
  private readonly projection = inject(ProjectionStateContainer);

  private readonly projectionState = this.projection.state;
  readonly projectionUpdate = this.projection.projectionUpdate;

  threadList(folderId: string | null): readonly ThreadListViewModel[] {
    return selectThreadListViewModel(this.projectionState(), folderId);
  }

  recordList(threadId: string | null): readonly RecordListViewModel[] {
    return selectRecordListViewModel(this.projectionState(), threadId);
  }

  contentPane(
    folderId: string | null,
    selectedThreadId: string | null,
    activePane: NavigationPane,
  ): ContentPaneViewModel {
    if (activePane === 'empty') {
      return EMPTY_CONTENT_PANE;
    }

    const orderedThreadList = activePane === 'folder'
      ? this.threadList(folderId)
      : EMPTY_THREADS;
    const orderedRecordList = activePane === 'thread' && selectedThreadId !== null
      ? this.recordList(selectedThreadId)
      : EMPTY_RECORDS;

    if (activePane === 'thread' && selectedThreadId !== null) {
      return {
        mode: 'records',
        threadList: EMPTY_THREADS,
        recordList: orderedRecordList,
      };
    }

    if (activePane !== 'folder') {
      return EMPTY_CONTENT_PANE;
    }

    return {
      mode: 'threads',
      threadList: orderedThreadList,
      recordList: EMPTY_RECORDS,
    };
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }
}