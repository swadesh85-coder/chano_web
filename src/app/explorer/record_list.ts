import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  type RecordViewModel,
  type ThreadRecordNodeViewModel,
  getThreadRecordNodeVirtualKey,
} from '../../viewmodels';
import { ExplorerContentPaneContainer } from '../explorer_content_pane.container';
import { MediaViewerComponent } from './media_viewer';
import { VirtualListComponent, type VirtualListRange } from '../virtual_list.component';
import { ContentItemRowComponent } from '../ui/content_item_row.component';
import {
  EXPLORER_RECORD_ROW_HEIGHT_PX,
  EXPLORER_VIRTUAL_LIST_BUFFER,
} from '../ui/explorer_visual.tokens';

@Component({
  selector: 'app-record-list',
  imports: [MediaViewerComponent, VirtualListComponent, ContentItemRowComponent],
  host: {
    class: 'explorer-view-surface',
  },
  template: `
    @if (threadId() === null) {
      <p class="explorer-state-empty panel-empty">Select a thread to inspect records</p>
    } @else {
      <div class="explorer-view-shell">
        <div class="explorer-action-bar">
          <button
            type="button"
            class="panel-action-button panel-action-button--accent"
            (click)="createRecordRequested.emit($event)"
            [disabled]="createDisabled()"
            data-testid="create-record-button"
            aria-label="Add content to thread"
          >
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">add</span>
            Add Content
          </button>
        </div>

        @if (totalItems() === 0) {
          <p class="explorer-state-empty panel-empty">No records visible for this thread</p>
        } @else {
          <app-media-viewer #mediaViewer [threadId]="threadId()"></app-media-viewer>

          <app-virtual-list
            class="explorer-list-viewport"
            [totalItems]="totalItems()"
            [renderedItems]="visibleNodes()"
            [itemHeight]="itemHeight"
            [buffer]="buffer"
            [trackByKey]="trackNode"
            (rangeChanged)="updateVisibleRange($event)"
          >
            <ng-template let-node>
              <div class="explorer-list-row record-card-row" data-testid="thread-view-node" [attr.data-node-key]="node.key">
                @if (node.kind === 'record') {
                  <app-content-item-row
                    [title]="node.record.displayLabel"
                    [supportingText]="recordSupportingText(node.record)"
                    [metaText]="recordMetaText(node.record)"
                    [mainTestId]="'record-item'"
                    [kind]="'record'"
                    [recordType]="recordType(node.record)"
                    [density]="'record'"
                    [interactive]="isMediaRecord(node.record)"
                    [ariaLabel]="recordAriaLabel(node.record)"
                    (activated)="isMediaRecord(node.record) && mediaViewer.openMedia(node.record.id)"
                  >
                    <span row-actions class="panel-actions">
                      <button
                        type="button"
                        class="panel-action-button"
                        (click)="recordEditRequested.emit({ record: node.record, event: $event })"
                        [disabled]="isDisabled(node.record.id)"
                        aria-label="Edit record body"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="panel-action-button"
                        (click)="recordRenameRequested.emit({ record: node.record, event: $event })"
                        [disabled]="isDisabled(node.record.id)"
                        aria-label="Rename record"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        class="panel-action-button"
                        (click)="recordMoveRequested.emit({ record: node.record, event: $event })"
                        [disabled]="isDisabled(node.record.id)"
                        aria-label="Move record"
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        class="panel-action-button panel-action-button--danger"
                        (click)="recordDeleteRequested.emit({ record: node.record, event: $event })"
                        [disabled]="isDisabled(node.record.id)"
                        aria-label="Delete record"
                      >
                        Delete
                      </button>
                    </span>
                  </app-content-item-row>
                } @else {
                  <app-content-item-row
                    [title]="'imageGroup:' + node.imageGroupId"
                    [supportingText]="'Media bundle'"
                    [metaText]="node.recordIdsSummary"
                    [mainTestId]="'image-group-item'"
                    [kind]="'group'"
                    [density]="'record'"
                    [interactive]="node.leadRecordId !== null"
                    [ariaLabel]="'Open image group ' + node.imageGroupId"
                    (activated)="node.leadRecordId !== null && mediaViewer.openMedia(node.leadRecordId)"
                  ></app-content-item-row>
                }
              </div>
            </ng-template>
          </app-virtual-list>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordListComponent {
  private readonly contentPane = inject(ExplorerContentPaneContainer);

  readonly threadId = input<string | null>(null);
  readonly isRecordDisabled = input<(recordId: string) => boolean>(() => false);
  readonly createDisabled = input(false);
  readonly itemHeight = EXPLORER_RECORD_ROW_HEIGHT_PX;
  readonly buffer = EXPLORER_VIRTUAL_LIST_BUFFER;
  readonly trackNode = (node: ThreadRecordNodeViewModel, _index: number) => getThreadRecordNodeVirtualKey(node);
  private readonly visibleRange = signal<VirtualListRange>({ start: 0, end: 0 });
  readonly totalItems = computed(() => this.contentPane.recordNodeCount(this.threadId()));
  readonly visibleNodes = computed(() => this.contentPane.visibleRecordNodes(this.threadId(), this.visibleRange()));

  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();

  updateVisibleRange(range: VirtualListRange): void {
    const currentRange = this.visibleRange();
    if (currentRange.start === range.start && currentRange.end === range.end) {
      return;
    }

    this.visibleRange.set(range);
  }

  isDisabled(recordId: string): boolean {
    return this.isRecordDisabled()(recordId);
  }

  isMediaRecord(record: RecordViewModel): boolean {
    return record.type === 'image' || record.type === 'file' || record.type === 'audio';
  }

  recordType(record: RecordViewModel): 'text' | 'image' | 'file' | 'audio' {
    if (record.type === 'image' || record.type === 'file' || record.type === 'audio') {
      return record.type;
    }

    return 'text';
  }

  recordSupportingText(record: RecordViewModel): string {
    return this.isMediaRecord(record)
      ? `${record.type} record`
      : 'Text record';
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
}