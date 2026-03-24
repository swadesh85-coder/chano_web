import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

@Component({
  selector: 'app-section-header',
  template: `
    <header class="ui-section-header">
      <div class="ui-section-header__copy">
        @if (eyebrow() !== null) {
          <p class="ui-section-header__eyebrow">{{ eyebrow() }}</p>
        }

        <h2 class="ui-section-header__title">{{ title() }}</h2>

        @if (subtitle() !== null) {
          <p class="ui-section-header__subtitle">{{ subtitle() }}</p>
        }
      </div>

      <div class="ui-section-header__actions">
        <ng-content select="[section-actions]"></ng-content>
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly eyebrow = input<string | null>(null);
}