import { Injectable, inject } from '@angular/core';
import { ProjectionStateContainer } from './projection/projection_state.container';
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

  threadList(folderId: string | null): readonly ThreadListViewModel[] {
    return selectThreadListViewModel(this.projectionState(), folderId);
  }

  recordList(threadId: string | null): readonly RecordListViewModel[] {
    return selectRecordListViewModel(this.projectionState(), threadId);
  }

  recordNodes(threadId: string | null): readonly ThreadRecordNodeViewModel[] {
    return selectThreadRecordNodeViewModel(this.projectionState(), threadId);
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

    if (activePane === 'thread' && selectedThreadId !== null) {
      return Object.freeze({
        mode: 'records',
        threadList: EMPTY_THREADS,
      });
    }

    if (activePane !== 'folder') {
      return EMPTY_CONTENT_PANE;
    }

    return Object.freeze({
      mode: 'threads',
      threadList: orderedThreadList,
    });
  }

  hasVisibleThread(folderId: string | null, threadId: string): boolean {
    return this.threadList(folderId).some((thread) => thread.id === threadId);
  }
}