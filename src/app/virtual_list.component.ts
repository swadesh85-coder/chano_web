import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  computed,
  contentChild,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

export interface VirtualListRange {
  readonly start: number;
  readonly end: number;
}

export interface VirtualListItemContext<TItem> {
  readonly $implicit: TItem;
  readonly index: number;
}

@Component({
  selector: 'app-virtual-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @let range = renderedRange();
    @let renderedItems = visibleItems();

    <div #viewport class="virtual-list__viewport">
      <div class="virtual-list__spacer" [style.height.px]="totalHeight()">
        <div class="virtual-list__content" [style.transform]="'translateY(' + offsetTop() + 'px)'">
          @for (item of renderedItems; track trackRenderedItem($index, item)) {
            <div class="virtual-list__row" [style.height.px]="itemHeight()">
              <ng-container
                [ngTemplateOutlet]="itemTemplate()"
                [ngTemplateOutletContext]="templateContext(range.start + $index, item)"
              ></ng-container>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .virtual-list__viewport {
        height: 100%;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
      }

      .virtual-list__spacer {
        position: relative;
        width: 100%;
      }

      .virtual-list__content {
        position: absolute;
        inset: 0 0 auto;
        will-change: transform;
      }

      .virtual-list__row {
        box-sizing: border-box;
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualListComponent<TItem> {
  readonly items = input.required<readonly TItem[]>();
  readonly itemHeight = input(56);
  readonly buffer = input(4);
  readonly viewportHeight = input(560);
  readonly trackByKey = input<(item: TItem, index: number) => string | number>((_item, index) => index);

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  readonly itemTemplate = contentChild.required<TemplateRef<VirtualListItemContext<TItem>>>(TemplateRef);
  private readonly scrollOffset = signal(0);
  private readonly measuredViewportHeight = signal(0);
  private readonly visibleRange = signal<VirtualListRange>({ start: 0, end: 0 });
  private animationFrameId: number | ReturnType<typeof globalThis.setTimeout> | null = null;
  private latestScrollOffset = 0;
  private latestViewportHeight = 0;

  readonly resolvedViewportHeight = computed(() => {
    return this.measuredViewportHeight() > 0 ? this.measuredViewportHeight() : this.viewportHeight();
  });

  readonly renderedRange = computed(() => this.visibleRange());

  readonly visibleItems = computed(() => {
    const range = this.renderedRange();
    return this.items().slice(range.start, range.end);
  });

  readonly totalHeight = computed(() => this.items().length * Math.max(1, this.itemHeight()));
  readonly offsetTop = computed(() => this.renderedRange().start * Math.max(1, this.itemHeight()));

  constructor() {
    effect((onCleanup) => {
      const viewportRef = this.viewport();
      if (viewportRef === undefined) {
        return;
      }

      const viewport = viewportRef.nativeElement;
      const handleScroll = () => {
        this.scheduleViewportSync(viewport.scrollTop, viewport.clientHeight);
      };
      const handleResize = () => {
        this.scheduleViewportSync(viewport.scrollTop, viewport.clientHeight);
      };

      viewport.addEventListener('scroll', handleScroll, { passive: true });
      globalThis.addEventListener?.('resize', handleResize, { passive: true });
      this.scheduleViewportSync(viewport.scrollTop, viewport.clientHeight);

      onCleanup(() => {
        viewport.removeEventListener('scroll', handleScroll);
        globalThis.removeEventListener?.('resize', handleResize);
        this.cancelScheduledSync();
      });
    });

    effect(() => {
      const nextRange = this.computeVisibleRange(
        this.scrollOffset(),
        this.resolvedViewportHeight(),
      );
      this.applyVisibleRange(nextRange);
    });

    effect(() => {
      const range = this.renderedRange();
      console.log(`VIRTUAL_RANGE (guarded) start=${range.start} end=${range.end}`);
    });
  }

  trackRenderedItem(renderedIndex: number, item: TItem): string | number {
    return this.trackByKey()(item, this.renderedRange().start + renderedIndex);
  }

  templateContext(index: number, item: TItem): VirtualListItemContext<TItem> {
    return {
      $implicit: item,
      index,
    };
  }

  private computeVisibleRange(
    scrollOffset: number,
    viewportHeight: number,
  ): VirtualListRange {
    const totalItems = this.items().length;
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }

    const itemHeight = Math.max(1, this.itemHeight());
    const bufferedStart = Math.max(0, Math.floor(scrollOffset / itemHeight) - this.buffer());
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight));
    const bufferedEnd = Math.min(totalItems, bufferedStart + visibleCount + (this.buffer() * 2));

    return {
      start: bufferedStart,
      end: Math.max(bufferedStart, bufferedEnd),
    };
  }

  private scheduleViewportSync(scrollOffset: number, measuredViewportHeight: number): void {
    this.latestScrollOffset = scrollOffset;
    this.latestViewportHeight = measuredViewportHeight > 0 ? measuredViewportHeight : this.viewportHeight();

    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = this.requestFrame(() => {
      this.animationFrameId = null;
      console.log('VIRTUAL_SCROLL frameUpdate');
      this.scrollOffset.set(this.latestScrollOffset);
      this.measuredViewportHeight.set(this.latestViewportHeight);
    });
  }

  private applyVisibleRange(nextRange: VirtualListRange): void {
    const currentRange = this.visibleRange();
    if (currentRange.start === nextRange.start && currentRange.end === nextRange.end) {
      return;
    }

    this.visibleRange.set(nextRange);
  }

  private cancelScheduledSync(): void {
    if (this.animationFrameId === null) {
      return;
    }

    this.cancelFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private requestFrame(callback: FrameRequestCallback): number | ReturnType<typeof globalThis.setTimeout> {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return globalThis.requestAnimationFrame(callback);
    }

    return globalThis.setTimeout(() => callback(Date.now()), 16);
  }

  private cancelFrame(frameId: number | ReturnType<typeof globalThis.setTimeout>): void {
    if (typeof globalThis.cancelAnimationFrame === 'function' && typeof frameId === 'number') {
      globalThis.cancelAnimationFrame(frameId);
      return;
    }

    globalThis.clearTimeout(frameId);
  }
}