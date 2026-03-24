// @vitest-environment jsdom

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadRecordNodeViewModel } from '../../viewmodels';
import { ExplorerContainer } from '../explorer.container';
import { RecordListComponent } from './record_list';

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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

function buildLargeNodeSet(): readonly ThreadRecordNodeViewModel[] {
  const nodes: ThreadRecordNodeViewModel[] = [
    {
      kind: 'imageGroup',
      key: 'imageGroup:group-0',
      imageGroupId: 'group-0',
      leadRecordId: 'image-0',
      recordIdsSummary: '[image-0, image-1]',
      records: [
        {
          id: 'image-0',
          threadId: 'thread-1',
          type: 'image',
          content: 'image-0',
          title: null,
          displayLabel: 'image-0',
          isAiGenerated: false,
          eventVersion: 1,
          imageGroupId: 'group-0',
          mediaId: 'media-0',
          mimeType: 'image/jpeg',
          size: null,
        },
        {
          id: 'image-1',
          threadId: 'thread-1',
          type: 'image',
          content: 'image-1',
          title: null,
          displayLabel: 'image-1',
          isAiGenerated: false,
          eventVersion: 2,
          imageGroupId: 'group-0',
          mediaId: 'media-1',
          mimeType: 'image/jpeg',
          size: null,
        },
      ],
    },
  ];

  for (let index = 1; index < 10_000; index += 1) {
    nodes.push({
      kind: 'record',
      key: `record:record-${index}`,
      record: {
        id: `record-${index}`,
        threadId: 'thread-1',
        type: 'text',
        content: `Record ${index}`,
        title: null,
        displayLabel: `Record ${index}`,
        isAiGenerated: false,
        eventVersion: index + 10,
        imageGroupId: null,
        mediaId: null,
        mimeType: null,
        size: null,
      },
    });
  }

  return deepFreeze(nodes);
}

describe('RecordListComponent virtualization', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let nodes: readonly ThreadRecordNodeViewModel[];

  beforeEach(async () => {
    ensureAngularTestEnvironment();
    vi.useFakeTimers();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    nodes = buildLargeNodeSet();

    await TestBed.configureTestingModule({
      imports: [RecordListComponent],
      providers: [
        {
          provide: ExplorerContainer,
          useValue: {
            selectMediaRecord: vi.fn(() => null),
            selectMediaViewerState: vi.fn(() => null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecordListComponent);
    fixture.componentRef.setInput('threadId', 'thread-1');
    fixture.componentRef.setInput('nodes', nodes);
    fixture.componentRef.setInput('disabledRecordIds', {});
    fixture.detectChanges();
    vi.runAllTimers();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function renderedNodeKeys(): string[] {
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="thread-view-node"]'))
      .map((element) => element.dataset['nodeKey'] ?? '');
  }

  function scrollToRecordIndex(index: number): void {
    const viewport = fixture.nativeElement.querySelector('.virtual-list__viewport') as HTMLDivElement;
    viewport.scrollTop = index * 132;
    viewport.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();
    fixture.detectChanges();
  }

  it('renders_only_visible_record_and_image_group_nodes', () => {
    expect(renderedNodeKeys().length).toBeLessThanOrEqual(13);
    expect(renderedNodeKeys()[0]).toBe('imageGroup:group-0');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="image-group-item"]')).toHaveLength(1);
    expect(consoleLog).toHaveBeenCalledWith('VIRTUAL_RANGE (guarded) start=0 end=13');
  });

  it('updates_the_visible_slice_deterministically_on_scroll', () => {
    scrollToRecordIndex(200);
    const firstRender = renderedNodeKeys();

    expect(firstRender[0]).toBe('record:record-196');
    expect(firstRender.length).toBeLessThanOrEqual(13);
    expect(consoleLog).toHaveBeenCalledWith('VIRTUAL_RANGE (guarded) start=196 end=209');

    scrollToRecordIndex(200);

    expect(renderedNodeKeys()).toEqual(firstRender);
  });

  it('does_not_mutate_projection_derived_node_inputs', () => {
    const before = JSON.stringify(nodes);

    scrollToRecordIndex(400);

    expect(JSON.stringify(nodes)).toBe(before);
  });
});