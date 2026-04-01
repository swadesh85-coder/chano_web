import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { ExplorerActions } from './explorer_actions';
import { RecordEditor } from './record_editor';
import { RecordListComponent } from './record_list';
import { type ExplorerRecordType } from '../ui/explorer_visual.tokens';
import type { ProjectionUpdate } from '../projection/projection.models';
import {
  type RecordViewModel,
  type ThreadRecordNodeViewModel,
} from '../../viewmodels';
import { ExplorerContainer } from '../explorer.container';

export type ThreadViewNode = ThreadRecordNodeViewModel;

@Component({
  selector: 'app-thread-view',
  imports: [RecordListComponent],
  host: {
    class: 'explorer-view-surface',
  },
  template: `
    @if (activeThreadId() === null) {
      <p class="explorer-state-empty panel-empty">No thread selected</p>
    } @else {
      <app-record-list
        [threadId]="activeThreadId()"
        [isRecordDisabled]="isActionDisabled"
        [createDisabled]="isCreateDisabled()"
        (createRecordRequested)="triggerCreateRecord($event)"
        (recordEditRequested)="promptEditRecord($event.record, $event.event)"
        (recordRenameRequested)="promptRenameRecord($event.record, $event.event)"
        (recordMoveRequested)="promptMoveRecord($event.record, $event.event)"
        (recordDeleteRequested)="triggerSoftDeleteRecord($event.record, $event.event)"
      ></app-record-list>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadViewComponent {
  private readonly actions = inject(ExplorerActions);
  private readonly recordEditor = inject(RecordEditor);
  private readonly container = inject(ExplorerContainer);

  readonly threadId = input<string | null>(null);
  readonly activeThreadId = computed(() => this.threadId());
  readonly viewNodes = computed(() => this.renderThread(this.activeThreadId()));

  constructor() {
    effect(() => {
      const threadId = this.activeThreadId();
      if (threadId === null) {
        return;
      }

      const viewNodes = this.viewNodes();
      console.log('THREAD_RENDER ordering_applied using eventVersion');
      this.logProjectionUpdate(this.container.projectionUpdate(), threadId, viewNodes);
    });
  }

  renderThread(threadId: string | null): readonly ThreadViewNode[] {
    if (threadId === null) {
      return [];
    }

    return this.container.threadRecordNodes(threadId);
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

  promptEditRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const currentBody = typeof record.content === 'string' ? record.content : '';
    const body = globalThis.prompt('Edit record body', currentBody);
    if (typeof body !== 'string') {
      return;
    }

    this.recordEditor.updateRecord(record.id, body);
  }

  promptRenameRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', record.displayLabel);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.recordEditor.renameRecord(record.id, newTitle);
  }

  promptMoveRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const currentLabel = typeof record.content === 'string' && record.content.length > 0
      ? record.content
      : record.type;
    const targetId = globalThis.prompt(`Move ${currentLabel} to target thread id`);
    if (typeof targetId !== 'string') {
      return;
    }

    this.actions.onMoveEntity('record', record.id, targetId);
  }

  triggerSoftDeleteRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();
    this.actions.onSoftDelete('record', record.id);
  }

  trackNode(_index: number, node: ThreadViewNode): string {
    return node.key;
  }

  isMediaRecord(record: RecordViewModel): boolean {
    return record.type === 'image' || record.type === 'file' || record.type === 'audio';
  }

  getRecordLabel(record: RecordViewModel): string {
    return record.displayLabel;
  }

  recordType(record: RecordViewModel): ExplorerRecordType {
    if (record.type === 'image' || record.type === 'file' || record.type === 'audio') {
      return record.type;
    }

    return 'text';
  }

  recordSupportingText(record: RecordViewModel): string {
    return this.isMediaRecord(record) ? `${record.type} record` : 'Text record';
  }

  recordMetaText(record: RecordViewModel): string {
    if (this.isMediaRecord(record)) {
      return `${record.id} · ${record.type} · v${record.eventVersion}`;
    }

    return `${record.id} · thread=${record.threadId} · v${record.eventVersion}`;
  }

  recordAriaLabel(record: RecordViewModel): string {
    if (this.isMediaRecord(record)) {
      return `Open media record ${record.displayLabel}`;
    }

    return `Inspect record ${record.displayLabel}`;
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