import { Injectable, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
import type { ProjectionState } from './projection/projection.models';
import type { NavigationPane } from './navigation.state';
import type { VirtualListRange } from './virtual_list.component';
import type {
  ContentPaneViewModel,
  RecordListViewModel,
  ThreadListViewModel,
  ThreadRecordNodeViewModel,
} from '../viewmodels';
import {
  selectRecordListViewModel,
  selectThreadRecordNodeViewModel,
  selectThreadListViewModel,
} from '../viewmodels';

const EMPTY_THREADS: readonly ThreadListViewModel[] = [];
const EMPTY_RECORDS: readonly RecordListViewModel[] = [];
const EMPTY_RECORD_NODES: readonly ThreadRecordNodeViewModel[] = [];
const EMPTY_CONTENT_PANE: ContentPaneViewModel = Object.freeze({
  mode: 'empty',
  threadList: EMPTY_THREADS,
});

@Injectable({ providedIn: 'root' })
export class ExplorerContentPaneContainer {
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
    readonly result: readonly RecordListViewModel[];
  } | null = null;
  private recordNodesCache: {
    readonly state: ProjectionState;
    readonly threadId: string | null;
    readonly result: readonly ThreadRecordNodeViewModel[];
  } | null = null;
  private contentPaneCache: {
    readonly activePane: NavigationPane;
    readonly folderId: string | null;
    readonly selectedThreadId: string | null;
    readonly threadList: readonly ThreadListViewModel[];
    readonly result: ContentPaneViewModel;
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

  recordList(threadId: string | null): readonly RecordListViewModel[] {
    const state = this.projectionState();
    const cache = this.recordListCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId) {
      return cache.result;
    }

    const result = selectRecordListViewModel(state, threadId);
    this.recordListCache = { state, threadId, result };
    return result;
  }

  recordNodes(threadId: string | null): readonly ThreadRecordNodeViewModel[] {
    const state = this.projectionState();
    const cache = this.recordNodesCache;
    if (cache !== null && cache.state === state && cache.threadId === threadId) {
      return cache.result;
    }

    const result = selectThreadRecordNodeViewModel(state, threadId);
    this.recordNodesCache = { state, threadId, result };
    return result;
  }

  recordNodeCount(threadId: string | null): number {
    return this.recordNodes(threadId).length;
  }

  visibleRecordNodes(threadId: string | null, range: VirtualListRange): readonly ThreadRecordNodeViewModel[] {
    if (threadId === null || range.end <= range.start) {
      return EMPTY_RECORD_NODES;
    }

    const nodes = this.recordNodes(threadId);
    return nodes.slice(range.start, Math.min(range.end, nodes.length));
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
    const cached = this.contentPaneCache;
    if (
      cached !== null
      && cached.activePane === activePane
      && cached.folderId === folderId
      && cached.selectedThreadId === selectedThreadId
      && cached.threadList === orderedThreadList
    ) {
      return cached.result;
    }

    if (activePane === 'thread' && selectedThreadId !== null) {
      const result = Object.freeze({
        mode: 'records',
        threadList: EMPTY_THREADS,
      });
      this.contentPaneCache = {
        activePane,
        folderId,
        selectedThreadId,
        threadList: EMPTY_THREADS,
        result,
      };
      return result;
    }

    if (activePane !== 'folder') {
      return EMPTY_CONTENT_PANE;
    }

    const result = Object.freeze({
      mode: 'threads',
      threadList: orderedThreadList,
    });
    this.contentPaneCache = {
      activePane,
      folderId,
      selectedThreadId,
      threadList: orderedThreadList,
      result,
    };
    return result;
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }
}