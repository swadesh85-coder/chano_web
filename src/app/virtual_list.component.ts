import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  computed,
  contentChild,
  effect,
  input,
  output,
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

const MAX_RENDERED_ITEMS = 200;

@Component({
  selector: 'app-virtual-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  host: {
    class: 'virtual-list-host',
  },
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualListComponent<TItem> {
  readonly items = input<readonly TItem[]>([]);
  readonly totalItems = input<number | null>(null);
  readonly renderedItems = input<readonly TItem[] | null>(null);
  readonly itemHeight = input(56);
  readonly buffer = input(4);
  readonly viewportHeight = input(560);
  readonly trackByKey = input<(item: TItem, index: number) => string | number>((_item, index) => index);
  readonly rangeChanged = output<VirtualListRange>();

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  readonly itemTemplate = contentChild.required<TemplateRef<VirtualListItemContext<TItem>>>(TemplateRef);
  private readonly scrollOffset = signal(0);
  private readonly measuredViewportHeight = signal(0);
  private readonly visibleRange = signal<VirtualListRange>({ start: 0, end: 0 });
  private animationFrameId: number | ReturnType<typeof globalThis.setTimeout> | null = null;
  private pendingViewport: HTMLDivElement | null = null;
  private previousStartIndex = -1;
  private previousEndIndex = -1;

  readonly resolvedViewportHeight = computed(() => {
    const fallbackViewportHeight = this.viewportHeight();
    const measuredViewportHeight = this.measuredViewportHeight();
    const browserViewportHeight = typeof globalThis.innerHeight === 'number' && globalThis.innerHeight > 0
      ? globalThis.innerHeight
      : fallbackViewportHeight;

    if (measuredViewportHeight <= 0) {
      return fallbackViewportHeight;
    }

    return Math.min(measuredViewportHeight, browserViewportHeight);
  });

  readonly renderedRange = computed(() => this.visibleRange());

  readonly visibleItems = computed(() => {
    const renderedItems = this.renderedItems();
    if (renderedItems !== null) {
      return renderedItems;
    }

    const range = this.renderedRange();
    return this.items().slice(range.start, range.end);
  });

  readonly totalHeight = computed(() => this.itemCount() * Math.max(1, this.itemHeight()));
  readonly offsetTop = computed(() => this.renderedRange().start * Math.max(1, this.itemHeight()));

  constructor() {
    effect((onCleanup) => {
      const viewportRef = this.viewport();
      if (viewportRef === undefined) {
        return;
      }

      const viewport = viewportRef.nativeElement;
      const handleScroll = () => {
        this.scheduleViewportSync(viewport);
      };
      const handleResize = () => {
        this.scheduleViewportSync(viewport);
      };

      viewport.addEventListener('scroll', handleScroll, { passive: true });
      globalThis.addEventListener?.('resize', handleResize, { passive: true });
      this.scheduleViewportSync(viewport);

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
      this.rangeChanged.emit(range);
      console.log(`VIRTUAL_RANGE (guarded) start=${range.start} end=${range.end}`);
    });

    effect(() => {
      const renderedItems = this.visibleItems();
      if (isVirtualizationGuardEnabled() && renderedItems.length > 200) {
        throw new Error(`VIRTUALIZATION_GUARD_EXCEEDED renderedItems=${renderedItems.length}`);
      }
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
    const totalItems = this.itemCount();
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }

    const itemHeight = Math.max(1, this.itemHeight());
    const bufferedStart = Math.max(0, Math.floor(scrollOffset / itemHeight) - this.buffer());
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight));
    const requestedCount = visibleCount + (this.buffer() * 2);
    const bufferedEnd = Math.min(totalItems, bufferedStart + Math.min(requestedCount, MAX_RENDERED_ITEMS));

    return {
      start: bufferedStart,
      end: Math.max(bufferedStart, bufferedEnd),
    };
  }

  private scheduleViewportSync(viewport: HTMLDivElement): void {
    this.pendingViewport = viewport;

    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = this.requestFrame(() => {
      this.animationFrameId = null;
      const pendingViewport = this.pendingViewport;
      this.pendingViewport = null;
      if (pendingViewport === null) {
        return;
      }

      console.log('VIRTUAL_SCROLL frameUpdate');
      this.scrollOffset.set(pendingViewport.scrollTop);
      this.measuredViewportHeight.set(
        pendingViewport.clientHeight > 0 ? pendingViewport.clientHeight : this.viewportHeight(),
      );
    });
  }

  private applyVisibleRange(nextRange: VirtualListRange): void {
    if (this.previousStartIndex === nextRange.start && this.previousEndIndex === nextRange.end) {
      return;
    }

    this.previousStartIndex = nextRange.start;
    this.previousEndIndex = nextRange.end;
    this.visibleRange.set(nextRange);
  }

  private itemCount(): number {
    return this.totalItems() ?? this.items().length;
  }

  private cancelScheduledSync(): void {
    if (this.animationFrameId === null) {
      this.pendingViewport = null;
      return;
    }

    this.cancelFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.pendingViewport = null;
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

function isVirtualizationGuardEnabled(): boolean {
  return Boolean((globalThis as { ngDevMode?: boolean }).ngDevMode);
}