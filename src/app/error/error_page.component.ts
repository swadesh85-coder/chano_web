import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

export type ErrorSeverity = 'fatal' | 'session_lost' | 'mutation_failed' | 'partial_load' | 'network';

@Component({
  selector: 'app-error-page',
  standalone: true,
  template: `
    <div class="error-page" role="alert">
      <div class="error-page__content">
        <span class="material-symbols-outlined error-page__icon" aria-hidden="true">{{ errorIcon() }}</span>
        <h1 class="error-page__title">{{ errorTitle() }}</h1>
        <p class="error-page__message">{{ errorMessage() }}</p>

        <div class="error-page__actions">
          @if (severity() === 'fatal' || severity() === 'network') {
            <button type="button" class="error-page__button error-page__button--primary"
              (click)="reconnectRequested.emit()">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">refresh</span>
              Reconnect
            </button>
          }
          @if (severity() === 'session_lost') {
            <button type="button" class="error-page__button error-page__button--primary"
              (click)="reconnectRequested.emit()">
              Reconnect
            </button>
            <button type="button" class="error-page__button error-page__button--secondary"
              (click)="repairRequested.emit()">
              Re-pair Device
            </button>
          }
          @if (severity() === 'partial_load') {
            <button type="button" class="error-page__button error-page__button--primary"
              (click)="retryRequested.emit()">
              Retry
            </button>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorPageComponent {
  readonly severity = input<ErrorSeverity>('fatal');

  readonly reconnectRequested = output<void>();
  readonly repairRequested = output<void>();
  readonly retryRequested = output<void>();

  protected errorIcon(): string {
    switch (this.severity()) {
      case 'fatal': return 'error';
      case 'session_lost': return 'link_off';
      case 'mutation_failed': return 'sync_problem';
      case 'partial_load': return 'cloud_off';
      case 'network': return 'wifi_off';
    }
  }

  protected errorTitle(): string {
    switch (this.severity()) {
      case 'fatal': return 'Something went wrong';
      case 'session_lost': return 'Session expired';
      case 'mutation_failed': return 'Operation failed';
      case 'partial_load': return 'Loading incomplete';
      case 'network': return 'Network error';
    }
  }

  protected errorMessage(): string {
    switch (this.severity()) {
      case 'fatal': return 'We encountered an unexpected error. Please try reconnecting.';
      case 'session_lost': return 'Your session has ended. Reconnect to continue or re-pair your device.';
      case 'mutation_failed': return 'The operation could not be completed. Your data is safe.';
      case 'partial_load': return 'Some content could not be loaded. Retrying automatically…';
      case 'network': return 'Unable to reach the server. Check your connection and try again.';
    }
  }
}
