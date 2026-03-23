import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ThreadListViewModel } from '../../viewmodels';

@Component({
  selector: 'app-thread-list',
  template: `
    @if (threads().length === 0) {
      <p class="empty-text panel-empty">No threads visible for this folder</p>
    } @else {
      @for (thread of threads(); track thread.id) {
        <div
          class="panel-item panel-item--thread"
          data-testid="thread-item"
          [class.panel-item--selected]="selectedThreadId() === thread.id"
        >
          <button
            type="button"
            class="panel-item-button"
            (click)="threadSelected.emit(thread.id)"
            [attr.aria-label]="'Select thread ' + thread.title"
          >
            <span class="panel-item-title">{{ thread.title }}</span>
            <span class="panel-item-meta">{{ thread.id }} · folder={{ thread.folderId }} · v{{ thread.lastEventVersion }} · {{ thread.recordCount }} records</span>
          </button>
          <span class="panel-actions">
            <button
              type="button"
              class="panel-action-button"
              (click)="threadRenameRequested.emit({ id: thread.id, title: thread.title, event: $event })"
              [disabled]="isDisabled(thread.id)"
              aria-label="Rename thread"
            >
              Rename
            </button>
            <button
              type="button"
              class="panel-action-button"
              (click)="threadMoveRequested.emit({ id: thread.id, title: thread.title, event: $event })"
              [disabled]="isDisabled(thread.id)"
              aria-label="Move thread"
            >
              Move
            </button>
            <button
              type="button"
              class="panel-action-button panel-action-button--danger"
              (click)="threadDeleteRequested.emit({ id: thread.id, event: $event })"
              [disabled]="isDisabled(thread.id)"
              aria-label="Delete thread"
            >
              Delete
            </button>
          </span>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadListComponent {
  readonly threads = input.required<readonly ThreadListViewModel[]>();
  readonly selectedThreadId = input<string | null>(null);
  readonly disabledThreadIds = input<Readonly<Record<string, boolean>>>({});

  readonly threadSelected = output<string>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();

  isDisabled(threadId: string): boolean {
    return this.disabledThreadIds()[threadId] ?? false;
  }
}