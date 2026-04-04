import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
} from '@angular/core';
import { SelectionService } from './selection.service';

@Component({
  selector: 'app-selection-bar',
  standalone: true,
  template: `
    @if (selection.hasSelection()) {
      <div class="selection-bar" role="toolbar" aria-label="Selection actions">
        <button
          type="button"
          class="selection-bar__close"
          aria-label="Clear selection"
          (click)="selection.clearSelection()"
        >
          <span class="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
        <span class="selection-bar__count">{{ selection.count() }} selected</span>

        <div class="selection-bar__actions">
          <button
            type="button"
            class="selection-bar__action"
            (click)="moveRequested.emit(selectedArray())"
          >
            <span class="material-symbols-rounded" aria-hidden="true">drive_file_move</span>
            Move to…
          </button>
          <button
            type="button"
            class="selection-bar__action selection-bar__action--danger"
            (click)="deleteRequested.emit(selectedArray())"
          >
            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
            Delete
          </button>
          <button
            type="button"
            class="selection-bar__action"
            aria-label="More actions"
            (click)="moreRequested.emit(selectedArray())"
          >
            <span class="material-symbols-rounded" aria-hidden="true">more_vert</span>
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionBarComponent {
  protected readonly selection = inject(SelectionService);

  readonly moveRequested = output<readonly string[]>();
  readonly deleteRequested = output<readonly string[]>();
  readonly moreRequested = output<readonly string[]>();

  protected selectedArray(): readonly string[] {
    return Array.from(this.selection.selectedIds());
  }
}
