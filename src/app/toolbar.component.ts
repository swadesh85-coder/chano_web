import {
  ChangeDetectionStrategy,
  Component,
  output,
} from '@angular/core';

@Component({
  selector: 'app-explorer-toolbar',
  standalone: true,
  template: `
    <header class="explorer-toolbar" aria-label="Explorer toolbar">
      <div class="explorer-toolbar__brand">
        <h1 class="explorer-toolbar__title">Chano</h1>
        <p class="explorer-toolbar__subtitle">Deterministic explorer workspace</p>
      </div>

      <div class="explorer-toolbar__controls">
        <button type="button" class="panel-action-button" aria-label="New item">
          New
        </button>

        <label class="explorer-toolbar__search">
          <span class="explorer-toolbar__search-label">Search</span>
          <input
            type="search"
            class="explorer-toolbar__search-input"
            placeholder="Search explorer"
            aria-label="Search explorer"
          />
        </label>

        <button
          type="button"
          class="panel-action-button"
          (click)="viewToggleRequested.emit()"
          aria-label="Toggle sidebar"
        >
          View
        </button>
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarComponent {
  readonly viewToggleRequested = output<void>();
}