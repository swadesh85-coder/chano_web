// @vitest-environment jsdom

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitPaneComponent } from './split_pane.component';

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

describe('SplitPaneComponent', () => {
  let fixture: ComponentFixture<SplitPaneComponent>;
  let component: SplitPaneComponent;
  let emittedRatios: number[];
  let rafCallbacks: Array<FrameRequestCallback>;

  beforeEach(async () => {
    ensureAngularTestEnvironment();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });

    await TestBed.configureTestingModule({
      imports: [SplitPaneComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SplitPaneComponent);
    component = fixture.componentInstance;
    emittedRatios = [];
    component.ratioChanged.subscribe((ratio) => emittedRatios.push(ratio));

    Object.defineProperty(fixture.nativeElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function flushAnimationFrame(): void {
    const pendingCallbacks = [...rafCallbacks];
    rafCallbacks = [];
    for (const callback of pendingCallbacks) {
      if (typeof callback === 'function') {
        callback(16);
      }
    }
  }

  it('updates_ratio_and_respects_min_max_bounds', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40, pointerId: 1 }));
    flushAnimationFrame();
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 700, pointerId: 1 }));
    flushAnimationFrame();
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 700, pointerId: 1 }));

    expect(emittedRatios[0]).toBe(0.25);
    expect(emittedRatios[emittedRatios.length - 1]).toBe(0.5);
    expect(emittedRatios.every((ratio) => ratio >= 0.25 && ratio <= 0.5)).toBe(true);
  });

  it('throttles_pointermove_updates_to_one_emit_per_animation_frame', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, pointerId: 7 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 240, pointerId: 7 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, pointerId: 7 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 320, pointerId: 7 }));

    expect(emittedRatios).toEqual([]);

    flushAnimationFrame();

    expect(emittedRatios).toEqual([0.4]);
  });

  it('applies_the_final_ratio_on_pointerup_even_before_animation_frame_flush', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, pointerId: 9 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, pointerId: 9 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 700, pointerId: 9 }));

    expect(emittedRatios[emittedRatios.length - 1]).toBe(0.5);

    flushAnimationFrame();

    expect(emittedRatios).toEqual([0.5]);
  });

  it('filters_micro_movements_below_epsilon_during_throttled_updates', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 240, pointerId: 11 }));
    flushAnimationFrame();
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 241, pointerId: 11 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 241.4, pointerId: 11 }));

    flushAnimationFrame();

    expect(emittedRatios).toEqual([0.3]);
  });

  it('emits_when_movement_meets_or_exceeds_epsilon', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 240, pointerId: 12 }));
    flushAnimationFrame();
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 242, pointerId: 12 }));

    flushAnimationFrame();

    expect(emittedRatios).toEqual([0.3, 0.3025]);
  });

  it('always_emits_final_ratio_on_pointerup_even_when_delta_is_below_epsilon', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 240, pointerId: 13 }));
    flushAnimationFrame();
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 241, pointerId: 13 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 241, pointerId: 13 }));

    expect(emittedRatios).toEqual([0.3, 0.30125]);
  });

  it('produces_the_same_final_ratio_for_the_same_drag_sequence', () => {
    const divider = fixture.nativeElement.querySelector('[data-testid="split-pane-divider"]') as HTMLButtonElement;

    const runSequence = (): number => {
      emittedRatios = [];
      divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 240, pointerId: 15 }));
      flushAnimationFrame();
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 320, pointerId: 15 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 321, pointerId: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 500, pointerId: 15 }));
      return emittedRatios[emittedRatios.length - 1] ?? Number.NaN;
    };

    const firstFinalRatio = runSequence();
    const secondFinalRatio = runSequence();

    expect(firstFinalRatio).toBe(0.5);
    expect(secondFinalRatio).toBe(0.5);
  });
});