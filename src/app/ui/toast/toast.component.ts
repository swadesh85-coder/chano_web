import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ToastService, type ToastItem } from './toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="toast-container" aria-live="polite" aria-relevant="additions">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="toast"
          [attr.data-type]="toast.type"
          role="status"
        >
          <span class="toast__icon material-symbols-rounded" aria-hidden="true">
            @switch (toast.type) {
              @case ('success') { check_circle }
              @case ('error') { error }
              @case ('warning') { warning }
              @case ('info') { info }
            }
          </span>
          <span class="toast__message">{{ toast.message }}</span>
          @if (toast.action) {
            <button
              type="button"
              class="toast__action"
              (click)="onAction(toast)"
            >
              {{ toast.action.label }}
            </button>
          }
          <button
            type="button"
            class="toast__dismiss"
            aria-label="Dismiss notification"
            (click)="toastService.dismiss(toast.id)"
          >
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  onAction(toast: ToastItem): void {
    toast.action?.callback();
    this.toastService.dismiss(toast.id);
  }
}
