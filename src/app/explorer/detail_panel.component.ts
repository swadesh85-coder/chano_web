import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
  signal,
} from '@angular/core';

type DetailTab = 'details' | 'activity';

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  host: { class: 'detail-panel-host' },
  template: `
    @if (open()) {
      <aside class="detail-panel" role="complementary" aria-label="Detail panel">
        <div class="detail-panel__header">
          <h2 class="detail-panel__title">{{ title() || 'Details' }}</h2>
          <button type="button" class="detail-panel__close" aria-label="Close detail panel" (click)="close()">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="detail-panel__tabs" role="tablist">
          <button type="button" role="tab" class="detail-panel__tab"
            [attr.aria-selected]="activeTab() === 'details'"
            [class.detail-panel__tab--active]="activeTab() === 'details'"
            (click)="activeTab.set('details')">
            Details
          </button>
          <button type="button" role="tab" class="detail-panel__tab"
            [attr.aria-selected]="activeTab() === 'activity'"
            [class.detail-panel__tab--active]="activeTab() === 'activity'"
            (click)="activeTab.set('activity')">
            Activity
          </button>
        </div>

        <div class="detail-panel__body" role="tabpanel">
          @if (activeTab() === 'details') {
            <dl class="detail-panel__properties">
              <div class="detail-panel__property">
                <dt>Type</dt>
                <dd>{{ entityType() || '—' }}</dd>
              </div>
              <div class="detail-panel__property">
                <dt>Location</dt>
                <dd>{{ location() || '—' }}</dd>
              </div>
              @if (itemCount() !== null) {
                <div class="detail-panel__property">
                  <dt>{{ entityType() === 'Thread' ? 'Records' : 'Items' }}</dt>
                  <dd>{{ itemCount() }}</dd>
                </div>
              }
              <div class="detail-panel__property">
                <dt>Origin</dt>
                <dd>Mobile</dd>
              </div>
              <div class="detail-panel__property">
                <dt>Sync Status</dt>
                <dd>
                  <span class="detail-panel__status detail-panel__status--projected">✓ Projected</span>
                </dd>
              </div>
            </dl>
          } @else {
            <div class="detail-panel__activity">
              <p class="detail-panel__activity-placeholder">Activity tracking will be available in a future update.</p>
            </div>
          }
        </div>
      </aside>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly entityType = input('');
  readonly location = input('');
  readonly itemCount = input<number | null>(null);

  readonly closeRequested = output<void>();

  readonly activeTab = signal<DetailTab>('details');

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.open()) {
      this.close();
    }
  }

  close(): void {
    this.closeRequested.emit();
  }
}
