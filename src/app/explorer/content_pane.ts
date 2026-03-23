import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type {
  ContentPaneViewModel,
  RecordViewModel,
} from '../../viewmodels';
import { RecordListComponent } from './record_list';
import { ThreadListComponent } from './thread_list';

@Component({
  selector: 'app-content-pane',
  imports: [RecordListComponent, ThreadListComponent],
  template: `
    @if (content().mode === 'empty') {
      <p class="empty-text panel-empty">Select a folder or thread to inspect content</p>
    } @else if (content().mode === 'records') {
      <app-record-list
        [threadId]="activeThreadId()"
        [records]="content().recordList"
        [disabledRecordIds]="disabledRecordIds()"
        [createDisabled]="createRecordDisabled()"
        (createRecordRequested)="createRecordRequested.emit($event)"
        (recordEditRequested)="recordEditRequested.emit($event)"
        (recordRenameRequested)="recordRenameRequested.emit($event)"
        (recordMoveRequested)="recordMoveRequested.emit($event)"
        (recordDeleteRequested)="recordDeleteRequested.emit($event)"
      ></app-record-list>
    } @else {
      <app-thread-list
        [threads]="content().threadList"
        [selectedThreadId]="selectedThreadId()"
        [disabledThreadIds]="disabledThreadIds()"
        (threadSelected)="threadSelected.emit($event)"
        (threadRenameRequested)="threadRenameRequested.emit($event)"
        (threadMoveRequested)="threadMoveRequested.emit($event)"
        (threadDeleteRequested)="threadDeleteRequested.emit($event)"
      ></app-thread-list>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentPaneComponent {
  readonly content = input.required<ContentPaneViewModel>();
  readonly selectedThreadId = input<string | null>(null);
  readonly activeThreadId = input<string | null>(null);
  readonly disabledThreadIds = input<Readonly<Record<string, boolean>>>({});
  readonly disabledRecordIds = input<Readonly<Record<string, boolean>>>({});
  readonly createRecordDisabled = input(false);

  readonly threadSelected = output<string>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();
  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
}