import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import {
  EXPLORER_SIDEBAR_MAX_RATIO,
  EXPLORER_SIDEBAR_MIN_WIDTH_PX,
} from './ui/explorer_visual.tokens';

const DEFAULT_RATIO = 0.3;
const MAX_LEFT_RATIO = EXPLORER_SIDEBAR_MAX_RATIO;
const EPSILON = 0.002;

@Component({
  selector: 'app-split-pane',
  standalone: true,
  host: {
    class: 'split-pane-host',
  },
  template: `
    <div
      class="split-pane"
      [class.split-pane--collapsed]="collapsed()"
      [style.--split-pane-ratio]="ratio()"
      data-testid="explorer-split-pane"
    >
      <section class="split-pane__pane split-pane__pane--left" aria-label="Left pane">
        <ng-content select="[pane-left]"></ng-content>
      </section>

      <button
        type="button"
        class="split-pane__divider"
        data-testid="split-pane-divider"
        aria-label="Resize explorer sidebar"
        (pointerdown)="startResize($event)"
      >
        <span class="split-pane__divider-handle" aria-hidden="true"></span>
      </button>

      <section class="split-pane__pane split-pane__pane--right" aria-label="Right pane">
        <ng-content select="[pane-right]"></ng-content>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplitPaneComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ownerDocument = this.host.nativeElement.ownerDocument;

  readonly ratio = input(DEFAULT_RATIO);
  readonly collapsed = input(false);
  readonly ratioChanged = output<number>();

  private activePointerId: number | null = null;
  private pendingClientX: number | null = null;
  private resizeFrameId: number | null = null;
  private lastEmittedRatio: number | null = null;
  private readonly boundPointerMove = (event: PointerEvent) => {
    if (this.activePointerId !== event.pointerId) {
      return;
    }

    this.queueRatioFromPointer(event.clientX);
  };
  private readonly boundPointerUp = (event: PointerEvent) => {
    this.finishResize(event);
  };
  private readonly boundPointerCancel = (event: PointerEvent) => {
    this.finishResize(event);
  };

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.removePointerListeners();
      this.cancelScheduledResize();
      this.activePointerId = null;
      this.pendingClientX = null;
      this.lastEmittedRatio = null;
    });
  }

  startResize(event: PointerEvent): void {
    event.preventDefault();
    this.activePointerId = event.pointerId;
    if (event.currentTarget instanceof HTMLElement && 'setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    this.ownerDocument.addEventListener('pointermove', this.boundPointerMove);
    this.ownerDocument.addEventListener('pointerup', this.boundPointerUp);
    this.ownerDocument.addEventListener('pointercancel', this.boundPointerCancel);
    this.queueRatioFromPointer(event.clientX);
  }

  private finishResize(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) {
      return;
    }

    this.queueRatioFromPointer(event.clientX);
    this.flushPendingRatio(true);
    this.activePointerId = null;
    this.removePointerListeners();
  }

  private queueRatioFromPointer(clientX: number): void {
    this.pendingClientX = clientX;

    if (this.resizeFrameId !== null) {
      return;
    }

    const view = this.ownerDocument.defaultView;
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      this.flushPendingRatio(false);
      return;
    }

    this.resizeFrameId = view.requestAnimationFrame(() => {
      this.resizeFrameId = null;
      this.flushPendingRatio(false);
    });
  }

  private flushPendingRatio(forceEmit: boolean): void {
    if (this.pendingClientX === null) {
      this.cancelScheduledResize();
      return;
    }

    const nextRatio = this.resolveRatio(this.pendingClientX);
    this.pendingClientX = null;
    this.cancelScheduledResize();
    this.emitRatio(nextRatio, forceEmit);
  }

  private resolveRatio(clientX: number): number {
    const bounds = this.host.nativeElement.getBoundingClientRect();
    if (bounds.width <= 0) {
      return DEFAULT_RATIO;
    }

    return clampRatio((clientX - bounds.left) / bounds.width, bounds.width);
  }

  private removePointerListeners(): void {
    this.ownerDocument.removeEventListener('pointermove', this.boundPointerMove);
    this.ownerDocument.removeEventListener('pointerup', this.boundPointerUp);
    this.ownerDocument.removeEventListener('pointercancel', this.boundPointerCancel);
  }

  private cancelScheduledResize(): void {
    if (this.resizeFrameId === null) {
      return;
    }

    const view = this.ownerDocument.defaultView;
    if (view !== null && typeof view.cancelAnimationFrame === 'function') {
      view.cancelAnimationFrame(this.resizeFrameId);
    }

    this.resizeFrameId = null;
  }

  private emitRatio(nextRatio: number, forceEmit: boolean): void {
    if (!forceEmit && this.lastEmittedRatio !== null && Math.abs(nextRatio - this.lastEmittedRatio) < EPSILON) {
      return;
    }

    this.lastEmittedRatio = nextRatio;
    this.ratioChanged.emit(nextRatio);
  }
}

function clampRatio(rawRatio: number, hostWidth: number): number {
  const minimumRatio = Math.min(EXPLORER_SIDEBAR_MIN_WIDTH_PX / Math.max(hostWidth, 1), MAX_LEFT_RATIO);
  const maximumRatio = MAX_LEFT_RATIO;

  if (Number.isNaN(rawRatio)) {
    return DEFAULT_RATIO;
  }

  return Math.min(Math.max(rawRatio, minimumRatio), maximumRatio);
}