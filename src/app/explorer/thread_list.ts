import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  type ThreadListViewModel,
  getThreadListVirtualKey,
} from '../../viewmodels';
import { VirtualListComponent } from '../virtual_list.component';
import { ContentItemRowComponent } from '../ui/content_item_row.component';
import {
  EXPLORER_THREAD_ROW_HEIGHT_PX,
  EXPLORER_VIRTUAL_LIST_BUFFER,
} from '../ui/explorer_visual.tokens';

@Component({
  selector: 'app-thread-list',
  imports: [VirtualListComponent, ContentItemRowComponent],
  host: {
    class: 'explorer-view-surface',
  },
  template: `
    @if (threads().length === 0) {
      <p class="explorer-state-empty panel-empty">No threads visible for this folder</p>
    } @else {
      <app-virtual-list
        class="explorer-list-viewport"
        [items]="threads()"
        [itemHeight]="itemHeight"
        [buffer]="buffer"
        [trackByKey]="trackThread"
      >
        <ng-template let-thread>
          <div
            class="explorer-list-row"
            data-testid="thread-item"
            [attr.data-thread-id]="thread.id"
          >
            <app-content-item-row
              [title]="thread.title"
              [supportingText]="thread.recordCount + ' records'"
              [metaText]="thread.id + ' · folder=' + thread.folderId + ' · v' + thread.lastEventVersion"
              [kind]="'thread'"
              [density]="'thread'"
              [selected]="selectedThreadId() === thread.id"
              [ariaLabel]="'Select thread ' + thread.title"
              (activated)="threadSelected.emit(thread.id)"
            >
              <span row-actions class="panel-actions">
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
            </app-content-item-row>
          </div>
        </ng-template>
      </app-virtual-list>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadListComponent {
  readonly threads = input.required<readonly ThreadListViewModel[]>();
  readonly selectedThreadId = input<string | null>(null);
  readonly disabledThreadIds = input<Readonly<Record<string, boolean>>>({});
  readonly itemHeight = EXPLORER_THREAD_ROW_HEIGHT_PX;
  readonly buffer = EXPLORER_VIRTUAL_LIST_BUFFER;
  readonly trackThread = (thread: ThreadListViewModel, _index: number) => getThreadListVirtualKey(thread);

  readonly threadSelected = output<string>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();

  isDisabled(threadId: string): boolean {
    return this.disabledThreadIds()[threadId] ?? false;
  }
}