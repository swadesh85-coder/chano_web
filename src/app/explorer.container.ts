import { Injectable, computed, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type { ProjectionState } from './projection/projection.models';
import type {
  MediaViewerViewModel,
  RecordViewModel,
  ThreadListViewModel,
  ThreadRecordNodeViewModel,
} from '../viewmodels';
import {
  selectMediaRecordViewModel,
  selectMediaViewerViewModel,
  selectRecordListViewModel,
  selectThreadListViewModel,
  selectThreadRecordNodeViewModel,
} from '../viewmodels';

@Injectable({ providedIn: 'root' })
export class ExplorerContainer {
  private readonly projection = inject(ProjectionStateContainer);

  private readonly projectionState = this.projection.state;
  readonly projectionUpdate = this.projection.projectionUpdate;
  private threadListCache: {
    readonly state: ProjectionState;
    readonly folderId: string | null;
    readonly result: readonly ThreadListViewModel[];
  } | null = null;
  private recordListCache: {
    readonly state: ProjectionState;
    readonly threadId: string | null;
    readonly result: readonly RecordViewModel[];
  } | null = null;
  private threadRecordNodesCache: {
    readonly state: ProjectionState;
    readonly threadId: string | null;
    readonly result: readonly ThreadRecordNodeViewModel[];
  } | null = null;
  private mediaRecordCache: {
    readonly state: ProjectionState;
    readonly threadId: string | null;
    readonly recordId: string | null;
    readonly result: RecordViewModel | null;
  } | null = null;
  private mediaViewerStateCache: {
    readonly state: ProjectionState;
    readonly threadId: string | null;
    readonly recordId: string | null;
    readonly result: MediaViewerViewModel | null;
  } | null = null;

  threadList(folderId: string | null): readonly ThreadListViewModel[] {
    const state = this.projectionState();
    const cache = this.threadListCache;
    if (cache !== null && cache.state === state && cache.folderId === folderId) {
      return cache.result;
    }

    const result = selectThreadListViewModel(state, folderId);
    this.threadListCache = { state, folderId, result };
    return result;
  }

  recordList(threadId: string | null): readonly RecordViewModel[] {
    const state = this.projectionState();
    const cache = this.recordListCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId) {
      return cache.result;
    }

    const result = selectRecordListViewModel(state, threadId);
    this.recordListCache = { state, threadId, result };
    return result;
  }

  threadRecordNodes(threadId: string | null): readonly ThreadRecordNodeViewModel[] {
    const state = this.projectionState();
    const cache = this.threadRecordNodesCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId) {
      return cache.result;
    }

    const result = selectThreadRecordNodeViewModel(state, threadId);
    this.threadRecordNodesCache = { state, threadId, result };
    return result;
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }

  selectMediaRecord(threadId: string | null, recordId: string | null): RecordViewModel | null {
    const state = this.projectionState();
    const cache = this.mediaRecordCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId && cache.recordId === recordId) {
      return cache.result;
    }

    const result = selectMediaRecordViewModel(state, threadId, recordId);
    this.mediaRecordCache = { state, threadId, recordId, result };
    return result;
  }

  selectMediaViewerState(threadId: string | null, recordId: string | null): MediaViewerViewModel | null {
    const state = this.projectionState();
    const cache = this.mediaViewerStateCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId && cache.recordId === recordId) {
      return cache.result;
    }

    if (threadId === null || recordId === null) {
      return null;
    }

    const mediaRecord = this.selectMediaRecord(threadId, recordId);
    if (mediaRecord === null) {
      return null;
    }

    const result = selectMediaViewerViewModel(state, mediaRecord.id);
    this.mediaViewerStateCache = { state, threadId, recordId, result };
    return result;
  }
}