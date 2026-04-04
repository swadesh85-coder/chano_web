import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  host: { class: 'empty-state-host' },
  template: `
    <div class="empty-state" role="status">
      <span class="material-symbols-outlined empty-state__icon" aria-hidden="true">{{ icon() }}</span>
      <h3 class="empty-state__title">{{ title() }}</h3>
      @if (description()) {
        <p class="empty-state__description">{{ description() }}</p>
      }
      @if (actionLabel()) {
        <button type="button" class="empty-state__action" (click)="actionClicked.emit()">
          {{ actionLabel() }}
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  readonly icon = input('folder_open');
  readonly title = input('No items');
  readonly description = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);

  readonly actionClicked = output<void>();
}
