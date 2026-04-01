import { Injectable, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type {
  MediaViewerViewModel,
  RecordViewModel,
  ThreadListViewModel,
  ThreadRecordNodeViewModel,
} from '../viewmodels';
import {
  selectMediaRecordViewModel,
  selectMediaViewerViewModel,
  selectRecordViewModel,
  selectRecordListViewModel,
  selectThreadListViewModel,
  selectThreadRecordNodeViewModel,
} from '../viewmodels';

@Injectable({ providedIn: 'root' })
export class ExplorerContainer {
  private readonly projection = inject(ProjectionStateContainer);

  private readonly projectionState = this.projection.state;
  readonly projectionUpdate = this.projection.projectionUpdate;

  threadList(folderId: string | null): readonly ThreadListViewModel[] {
    return selectThreadListViewModel(this.projectionState(), folderId);
  }

  recordList(threadId: string | null): readonly RecordViewModel[] {
    return selectRecordListViewModel(this.projectionState(), threadId);
  }

  threadRecordNodes(threadId: string | null): readonly ThreadRecordNodeViewModel[] {
    return selectThreadRecordNodeViewModel(this.projectionState(), threadId);
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }

  selectMediaRecord(threadId: string | null, recordId: string | null): RecordViewModel | null {
    const state = this.projectionState();
    const scopedRecord = selectMediaRecordViewModel(state, threadId, recordId);
    if (scopedRecord !== null) {
      return scopedRecord;
    }

    return selectRecordViewModel(state, recordId);
  }

  selectMediaViewerState(threadId: string | null, recordId: string | null): MediaViewerViewModel | null {
    if (recordId === null) {
      return null;
    }

    const mediaRecord = this.selectMediaRecord(threadId, recordId);
    if (mediaRecord === null) {
      return null;
    }

    return selectMediaViewerViewModel(this.projectionState(), mediaRecord.id);
  }
}