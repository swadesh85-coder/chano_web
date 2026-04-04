import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  AfterViewChecked,
  ViewChild,
  inject,
  input,
  output,
} from '@angular/core';
import { DialogService, type DialogSize } from './dialog.service';

@Component({
  selector: 'app-dialog',
  standalone: true,
  template: `
    @if (dialogService.state(); as dialog) {
      <div
        class="dialog-overlay"
        [class.dialog-overlay--visible]="dialog.visible"
        (click)="onOverlayClick(dialog.config.dismissOnOverlay !== false)"
        aria-hidden="true"
      ></div>
      <div
        #dialogPanel
        class="dialog-panel"
        [attr.data-size]="dialog.config.size ?? 'md'"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="dialog.config.title"
      >
        <header class="dialog-panel__header">
          <h2 class="dialog-panel__title">{{ dialog.config.title }}</h2>
          @if (dialog.config.showClose !== false) {
            <button
              type="button"
              class="dialog-panel__close"
              aria-label="Close dialog"
              (click)="dialogService.close()"
            >
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          }
        </header>
        <div class="dialog-panel__body">
          <ng-content></ng-content>
        </div>
        <footer class="dialog-panel__footer">
          <ng-content select="[dialog-actions]"></ng-content>
        </footer>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogComponent implements OnDestroy, AfterViewChecked {
  protected readonly dialogService = inject(DialogService);

  @ViewChild('dialogPanel') private dialogPanel?: ElementRef<HTMLElement>;

  private focusTrapped = false;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dialogService.isOpen) {
      this.dialogService.close();
    }
  }

  @HostListener('document:keydown.tab', ['$event'])
  onTab(event: Event): void {
    if (!this.dialogService.isOpen || !this.dialogPanel) return;
    const keyEvent = event as KeyboardEvent;

    const panel = this.dialogPanel.nativeElement;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (keyEvent.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!keyEvent.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngAfterViewChecked(): void {
    if (this.dialogService.isOpen && this.dialogPanel && !this.focusTrapped) {
      const panel = this.dialogPanel.nativeElement;
      const firstFocusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
      this.focusTrapped = true;
    }

    if (!this.dialogService.isOpen) {
      this.focusTrapped = false;
    }
  }

  onOverlayClick(dismissable: boolean): void {
    if (dismissable) {
      this.dialogService.close();
    }
  }

  ngOnDestroy(): void {
    this.dialogService.close();
  }
}
