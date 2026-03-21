import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { RecordEditor } from './record_editor';
import { MediaViewerComponent } from './media_viewer';
import type {
  ProjectionUpdate,
  RecordProjectionEntity,
} from '../projection/projection.models';

type ThreadViewRecordNode = {
  readonly kind: 'record';
  readonly key: string;
  readonly orderIndex: number | null;
  readonly lastEventVersion: number | null;
  readonly deterministicKey: string;
  readonly record: RecordProjectionEntity;
};

type ThreadViewImageGroupNode = {
  readonly kind: 'imageGroup';
  readonly key: string;
  readonly orderIndex: number | null;
  readonly lastEventVersion: number | null;
  readonly deterministicKey: string;
  readonly imageGroupId: string;
  readonly records: readonly RecordProjectionEntity[];
};

export type ThreadViewNode = ThreadViewRecordNode | ThreadViewImageGroupNode;

@Component({
  selector: 'app-thread-view',
  imports: [MediaViewerComponent],
  templateUrl: './thread_view.html',
  styleUrl: './thread_view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadViewComponent {
  private readonly projection = inject(ProjectionStore);
  private readonly actions = inject(ExplorerActions);
  private readonly recordEditor = inject(RecordEditor);

  readonly threadId = input<string | null>(null);
  readonly activeThreadId = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.handleThreadSelection(this.threadId());
    });

    this.subscribeToProjection();
  }

  handleThreadSelection(threadId: string | null): void {
    if (this.activeThreadId() === threadId) {
      return;
    }

    this.activeThreadId.set(threadId);
    this.renderThread(threadId);
  }

  renderThread(threadId: string | null): readonly ThreadViewNode[] {
    if (threadId === null) {
      return [];
    }

    return this.applyOrdering(this.buildDeterministicView(threadId));
  }

  buildDeterministicView(threadId: string): readonly ThreadViewNode[] {
    const projectionState = this.projection.getProjectionState();
    const records = [...projectionState.records.values()].filter((record) => record.data.threadUuid === threadId);
    const groupedRecordIds = new Set<string>();
    const viewNodes: ThreadViewNode[] = [];

    for (const [imageGroupId, imageGroupRecords] of projectionState.imageGroups.entries()) {
      const threadImageGroupRecords = imageGroupRecords.filter((record) => record.data.threadUuid === threadId);
      if (threadImageGroupRecords.length === 0) {
        continue;
      }

      for (const record of threadImageGroupRecords) {
        groupedRecordIds.add(record.entityUuid);
      }

      const firstRecord = threadImageGroupRecords[0];

      viewNodes.push({
        kind: 'imageGroup',
        key: `imageGroup:${imageGroupId}`,
        imageGroupId,
        records: threadImageGroupRecords,
        orderIndex: firstRecord.data.orderIndex,
        lastEventVersion: firstRecord.data.lastEventVersion,
        deterministicKey: imageGroupId,
      });
    }

    for (const record of records) {
      if (groupedRecordIds.has(record.entityUuid)) {
        continue;
      }

      viewNodes.push({
        kind: 'record',
        key: `record:${record.entityUuid}`,
        record,
        orderIndex: record.data.orderIndex,
        lastEventVersion: record.data.lastEventVersion,
        deterministicKey: record.entityUuid,
      });
    }

    return viewNodes;
  }

  applyOrdering(nodes: readonly ThreadViewNode[]): readonly ThreadViewNode[] {
    console.log('THREAD_RENDER ordering_applied using eventVersion');

    return [...nodes].sort((left, right) => {
      const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftEventVersion = left.lastEventVersion ?? Number.MAX_SAFE_INTEGER;
      const rightEventVersion = right.lastEventVersion ?? Number.MAX_SAFE_INTEGER;
      if (leftEventVersion !== rightEventVersion) {
        return leftEventVersion - rightEventVersion;
      }

      return left.deterministicKey.localeCompare(right.deterministicKey);
    });
  }

  isActionDisabled(entityId: string): boolean {
    return this.actions.isPending(entityId) || this.recordEditor.isPending(entityId);
  }

  isCreateDisabled(): boolean {
    return this.recordEditor.isCreatePending();
  }

  triggerCreateRecord(event: Event): void {
    event.stopPropagation();

    const threadId = this.activeThreadId();
    if (threadId === null) {
      return;
    }

    const body = globalThis.prompt('New text record body', '');
    if (typeof body !== 'string') {
      return;
    }

    this.recordEditor.createRecord(threadId, body);
  }

  promptEditRecord(record: RecordProjectionEntity, event: Event): void {
    event.stopPropagation();

    const body = globalThis.prompt('Edit record body', record.data.body);
    if (typeof body !== 'string') {
      return;
    }

    this.recordEditor.updateRecord(record.entityUuid, body);
  }

  promptRenameRecord(record: RecordProjectionEntity, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', record.data.body);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.recordEditor.renameRecord(record.entityUuid, newTitle);
  }

  promptMoveRecord(record: RecordProjectionEntity, event: Event): void {
    event.stopPropagation();

    const targetId = globalThis.prompt(`Move ${record.data.body || record.data.type} to target thread id`);
    if (typeof targetId !== 'string') {
      return;
    }

    this.actions.onMoveEntity('record', record.entityUuid, targetId);
  }

  triggerSoftDeleteRecord(record: RecordProjectionEntity, event: Event): void {
    event.stopPropagation();
    this.actions.onSoftDelete('record', record.entityUuid);
  }

  trackNode(_index: number, node: ThreadViewNode): string {
    return node.key;
  }

  isMediaRecord(record: RecordProjectionEntity): boolean {
    return record.data.type === 'image' || record.data.type === 'file' || record.data.type === 'audio';
  }

  getRecordLabel(record: RecordProjectionEntity): string {
    return record.data.title ?? (record.data.body || record.data.type);
  }

  getImageGroupLeadRecordId(records: readonly RecordProjectionEntity[]): string | null {
    return records[0]?.entityUuid ?? null;
  }

  private subscribeToProjection(): void {
    effect(() => {
      const projectionUpdate = this.projection.lastProjectionUpdate();
      const threadId = this.activeThreadId();
      if (threadId === null) {
        return;
      }

      const viewNodes = this.renderThread(threadId);
      this.logProjectionUpdate(projectionUpdate, threadId, viewNodes);
    });
  }

  private logProjectionUpdate(
    projectionUpdate: ProjectionUpdate | null,
    threadId: string,
    viewNodes: readonly ThreadViewNode[],
  ): void {
    if (projectionUpdate === null) {
      return;
    }

    const formattedThreadId = this.formatThreadLogId(threadId);
    if (projectionUpdate.reason === 'snapshot_loaded') {
      console.log(`THREAD_RENDER snapshot_loaded thread=${formattedThreadId}`);
    } else if (projectionUpdate.entityType !== null) {
      console.log(`THREAD_RENDER event_applied entity=${projectionUpdate.entityType} thread=${formattedThreadId}`);
    }

    for (const node of viewNodes) {
      if (node.kind === 'imageGroup') {
        console.log(`THREAD_RENDER image_group_applied group=${node.imageGroupId}`);
      }
    }
  }

  private formatThreadLogId(threadId: string): string {
    const segments = threadId.split(':');
    return segments[segments.length - 1] || threadId;
  }
}