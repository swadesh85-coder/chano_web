// @vitest-environment jsdom

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualListComponent } from './virtual_list.component';

let angularTestEnvironmentInitialized = false;

function ensureAngularTestEnvironment(): void {
  if (angularTestEnvironmentInitialized) {
    return;
  }

  try {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cannot set base providers because it has already been called')) {
      throw error;
    }
  }

  angularTestEnvironmentInitialized = true;
}

interface VirtualRowItem {
  readonly id: string;
  readonly label: string;
}

@Component({
  standalone: true,
  imports: [VirtualListComponent],
  template: `
    <div style="height: 560px;">
      <app-virtual-list
        [items]="items"
        [itemHeight]="56"
        [buffer]="4"
        [viewportHeight]="560"
        [trackByKey]="trackByItem"
      >
        <ng-template let-item let-index="index">
          <div data-testid="virtual-row" [attr.data-row-id]="item.id">{{ index }}::{{ item.label }}</div>
        </ng-template>
      </app-virtual-list>
    </div>
  `,
})
class VirtualListHostComponent {
  readonly items: readonly VirtualRowItem[] = Array.from({ length: 10_000 }, (_value, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
  }));

  readonly trackByItem = (item: VirtualRowItem) => item.id;
}

describe('VirtualListComponent', () => {
  let fixture: ComponentFixture<VirtualListHostComponent>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: Array<FrameRequestCallback | null>;

  beforeEach(async () => {
    ensureAngularTestEnvironment();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    rafCallbacks = [];

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });

    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = null;
    });

    await TestBed.configureTestingModule({
      imports: [VirtualListHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VirtualListHostComponent);
    fixture.detectChanges();
    flushAnimationFrame();
    fixture.detectChanges();
    consoleLog.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function componentInstance(): VirtualListComponent<VirtualRowItem> {
    return fixture.debugElement.query(By.directive(VirtualListComponent)).componentInstance as VirtualListComponent<VirtualRowItem>;
  }

  function flushAnimationFrame(): void {
    const pendingCallbacks = [...rafCallbacks];
    rafCallbacks = [];

    for (const callback of pendingCallbacks) {
      callback?.(16);
    }
  }

  function renderedRowIds(): string[] {
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="virtual-row"]'))
      .map((element) => element.dataset['rowId'] ?? '');
  }

  function getLogMessages(message: string): string[] {
    return consoleLog.mock.calls
      .map((call: readonly unknown[]): unknown => call[0])
      .filter((entry: unknown): entry is string => typeof entry === 'string' && entry.includes(message));
  }

  function dispatchScroll(scrollTop: number): void {
    const viewport = fixture.nativeElement.querySelector('.virtual-list__viewport') as HTMLDivElement;
    viewport.scrollTop = scrollTop;
    viewport.dispatchEvent(new Event('scroll'));
  }

  function scrollTo(scrollTop: number): void {
    dispatchScroll(scrollTop);
    flushAnimationFrame();
    fixture.detectChanges();
  }

  it('throttles_rapid_scroll_updates_to_one_frame_and_uses_the_final_scroll_position', () => {
    const component = componentInstance();

    dispatchScroll(560);
    dispatchScroll(1_120);
    dispatchScroll(1_680);

    expect(getLogMessages('VIRTUAL_SCROLL frameUpdate')).toHaveLength(0);
    expect(component.renderedRange()).toEqual({ start: 0, end: 18 });

    flushAnimationFrame();
    fixture.detectChanges();

    expect(getLogMessages('VIRTUAL_SCROLL frameUpdate')).toHaveLength(1);
    expect(component.renderedRange()).toEqual({ start: 26, end: 44 });
    expect(renderedRowIds()[0]).toBe('item-26');
    expect(renderedRowIds()[17]).toBe('item-43');
  });

  it('skips_range_updates_when_the_computed_slice_does_not_change', () => {
    const component = componentInstance();

    scrollTo(560);
    expect(component.renderedRange()).toEqual({ start: 6, end: 24 });
    expect(renderedRowIds()).toHaveLength(18);
    consoleLog.mockClear();

    scrollTo(575);

    expect(getLogMessages('VIRTUAL_SCROLL frameUpdate')).toHaveLength(1);
    expect(getLogMessages('VIRTUAL_RANGE (guarded)')).toHaveLength(0);
    expect(component.renderedRange()).toEqual({ start: 6, end: 24 });
    expect(renderedRowIds()[0]).toBe('item-6');
    expect(renderedRowIds()[17]).toBe('item-23');
  });

  it('applies_the_last_scroll_position_correctly_after_multiple_events_before_flush', () => {
    const component = componentInstance();

    dispatchScroll(5_600);
    dispatchScroll(6_160);
    dispatchScroll(7_840);

    flushAnimationFrame();
    fixture.detectChanges();

    expect(component.renderedRange()).toEqual({ start: 136, end: 154 });
    expect(renderedRowIds()).toHaveLength(18);
    expect(renderedRowIds()[0]).toBe('item-136');
    expect(renderedRowIds()[17]).toBe('item-153');
    expect(getLogMessages('VIRTUAL_SCROLL frameUpdate')).toHaveLength(1);
    expect(getLogMessages('VIRTUAL_RANGE (guarded) start=136 end=154')).toHaveLength(1);
  });
});