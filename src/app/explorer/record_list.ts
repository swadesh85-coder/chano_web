import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { RecordViewModel } from '../../viewmodels';
import { MediaViewerComponent } from './media_viewer';

@Component({
  selector: 'app-record-list',
  imports: [MediaViewerComponent],
  template: `
    @if (threadId() === null) {
      <p class="empty-text panel-empty">Select a thread to inspect records</p>
    } @else {
      <div class="thread-view-toolbar">
        <button
          type="button"
          class="thread-view-action thread-view-action--primary"
          (click)="createRecordRequested.emit($event)"
          [disabled]="createDisabled()"
          data-testid="create-record-button"
          aria-label="Create text record"
        >
          Create Text Record
        </button>
      </div>

      @if (records().length === 0) {
        <p class="thread-view-empty">No records visible for this thread</p>
      } @else {
        <app-media-viewer #mediaViewer [threadId]="threadId()"></app-media-viewer>

        @for (record of records(); track record.id) {
          <div class="thread-view-item" data-testid="thread-view-node">
            @if (isMediaRecord(record)) {
              <button
                type="button"
                class="thread-view-item-body thread-view-content thread-view-open-button"
                data-testid="record-item"
                aria-haspopup="dialog"
                (click)="mediaViewer.openMedia(record.id)"
              >
                <span class="thread-view-title">{{ record.displayLabel }}</span>
                <span class="thread-view-meta"> {{ record.id }} · {{ record.type }} · v{{ record.eventVersion }}</span>
              </button>
            } @else {
              <div class="thread-view-item-body thread-view-content" data-testid="record-item">
                <span class="thread-view-title">{{ record.displayLabel }}</span>
                <span class="thread-view-meta"> {{ record.id }} · thread={{ record.threadId }} · v{{ record.eventVersion }}</span>
              </div>
            }
            <span class="thread-view-actions">
              <button
                type="button"
                class="thread-view-action"
                (click)="recordEditRequested.emit({ record, event: $event })"
                [disabled]="isDisabled(record.id)"
                aria-label="Edit record body"
              >
                Edit
              </button>
              <button
                type="button"
                class="thread-view-action"
                (click)="recordRenameRequested.emit({ record, event: $event })"
                [disabled]="isDisabled(record.id)"
                aria-label="Rename record"
              >
                Rename
              </button>
              <button
                type="button"
                class="thread-view-action"
                (click)="recordMoveRequested.emit({ record, event: $event })"
                [disabled]="isDisabled(record.id)"
                aria-label="Move record"
              >
                Move
              </button>
              <button
                type="button"
                class="thread-view-action thread-view-action--danger"
                (click)="recordDeleteRequested.emit({ record, event: $event })"
                [disabled]="isDisabled(record.id)"
                aria-label="Delete record"
              >
                Delete
              </button>
            </span>
          </div>
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordListComponent {
  readonly threadId = input<string | null>(null);
  readonly records = input.required<readonly RecordViewModel[]>();
  readonly disabledRecordIds = input<Readonly<Record<string, boolean>>>({});
  readonly createDisabled = input(false);

  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();

  isDisabled(recordId: string): boolean {
    return this.disabledRecordIds()[recordId] ?? false;
  }

  isMediaRecord(record: RecordViewModel): boolean {
    return record.type === 'image' || record.type === 'file' || record.type === 'audio';
  }
}