import { Injectable, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
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

  contentPane(folderId: string | null, selectedThreadId: string | null): ContentPaneViewModel {
    if (selectedThreadId !== null) {
      return {
        mode: 'records',
        threadList: EMPTY_THREADS,
        recordList: this.recordList(selectedThreadId),
      };
    }

    return {
      mode: 'threads',
      threadList: this.threadList(folderId),
      recordList: EMPTY_RECORDS,
    };
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }
}