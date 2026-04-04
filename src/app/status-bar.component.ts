import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

export type ConnectionStatus = 'connected' | 'syncing' | 'reconnecting' | 'disconnected' | 'error';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  template: `
    <footer class="status-bar" aria-label="Status bar">
      <div class="status-bar__left">
        <span class="status-bar__indicator">
          <span
            class="status-bar__dot"
            [class.status-bar__dot--connected]="connectionStatus() === 'connected'"
            [class.status-bar__dot--syncing]="connectionStatus() === 'syncing'"
            [class.status-bar__dot--reconnecting]="connectionStatus() === 'reconnecting'"
            [class.status-bar__dot--disconnected]="connectionStatus() === 'disconnected'"
            [class.status-bar__dot--error]="connectionStatus() === 'error'"
          ></span>
          {{ connectionLabel() }}
        </span>

        @if (syncProgress() !== null) {
          <span class="status-bar__sync-progress">{{ syncProgress() }}</span>
        }
      </div>

      <div class="status-bar__right">
        @if (lastUpdated() !== null) {
          <span class="status-bar__staleness">Last updated: {{ lastUpdated() }}</span>
        }
        @if (itemCount() !== null) {
          <span>{{ itemCount() }} items</span>
        }
      </div>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBarComponent {
  readonly connectionStatus = input<ConnectionStatus>('disconnected');
  readonly syncProgress = input<string | null>(null);
  readonly itemCount = input<number | null>(null);
  readonly lastUpdated = input<string | null>(null);

  protected connectionLabel(): string {
    switch (this.connectionStatus()) {
      case 'connected': return 'Connected to Phone';
      case 'syncing': return 'Syncing…';
      case 'reconnecting': return 'Reconnecting…';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Connection error';
    }
  }
}
