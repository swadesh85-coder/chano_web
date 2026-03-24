import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadViewComponent } from './thread_view';
import { ProjectionStore } from '../projection/projection.store';
import { ExplorerActions } from './explorer_actions';
import { PendingCommandStore } from './pending_command_store';
import { MutationCommandSender } from '../../transport';
import { RecordEditor } from './record_editor';
import type {
  ProjectionState,
  ProjectionUpdate,
  RecordEntry,
} from '../projection/projection.models';

describe('ThreadViewComponent', () => {
  let fixture: ComponentFixture<ThreadViewComponent>;
  let component: ThreadViewComponent;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let projectionUpdateSignal: ReturnType<typeof signal<ProjectionUpdate | null>>;
  let pendingStore: {
    isPending: ReturnType<typeof vi.fn>;
    isCreatePending: ReturnType<typeof vi.fn>;
    setPending: ReturnType<typeof vi.fn>;
  };
  let sendCommand: ReturnType<typeof vi.fn>;
  let projectionStateSignals: {
    records: ReturnType<typeof signal<RecordEntry[]>>;
  };

  const recordEntity = (
    uuid: string,
    body: string,
    threadUuid: string,
    type = 'text',
    orderIndex = 0,
    lastEventVersion = 1,
    entityVersion = 1,
    imageGroupId: string | null = null,
  ): RecordEntry => ({
    id: uuid,
    threadId: threadUuid,
    type,
    name: body,
    createdAt: entityVersion,
    editedAt: entityVersion,
    orderIndex,
    isStarred: false,
    imageGroupId,
    entityVersion,
    lastEventVersion,
  });

  function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }

    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }

    return Object.freeze(value);
  }

  beforeEach(async () => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    projectionUpdateSignal = signal<ProjectionUpdate | null>(null);
    pendingStore = {
      isPending: vi.fn(() => false),
      isCreatePending: vi.fn(() => false),
      setPending: vi.fn(),
    };
    sendCommand = vi.fn(() => null);
    projectionStateSignals = {
      records: signal<RecordEntry[]>([]),
    };

    await TestBed.configureTestingModule({
      imports: [ThreadViewComponent],
      providers: [
        ExplorerActions,
        RecordEditor,
        { provide: PendingCommandStore, useValue: pendingStore },
        { provide: MutationCommandSender, useValue: { sendCommand } },
        {
          provide: ProjectionStore,
          useValue: {
            state: (): ProjectionState => ({
              folders: [],
              threads: [],
              records: projectionStateSignals.records(),
            }),
            lastProjectionUpdate: projectionUpdateSignal.asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ThreadViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function render(threadId: string | null): void {
    fixture.componentRef.setInput('threadId', threadId);
    fixture.detectChanges();
  }

  function getTextValues(selector: string): string[] {
    return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll(selector))
      .map((element) => {
        const textParts = Array.from<HTMLElement>(
          element.querySelectorAll('.ui-list-row__title, .ui-list-row__supporting, .ui-list-row__meta'),
        )
          .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter((value) => value.length > 0);

        if (textParts.length > 0) {
          return textParts.join(' ');
        }

        return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
  }

  function getOrderedThreadViewText(): string[] {
    return getTextValues('.thread-view-content');
  }

  function hashProjectionInputs(): string {
    return JSON.stringify(projectionStateSignals.records());
  }

  it('thread_render_snapshot', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
      recordEntity('rec-2', 'image-2', 'thread:0001', 'image', 3, 202, 1, 'img-123'),
      recordEntity('record:text-2', 'record:text-2', 'thread:0001', 'text', 3, 202, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 200 });

    render('thread:0001');

    expect(getOrderedThreadViewText()[0]).toContain('record:text-1');
    expect(getOrderedThreadViewText()[1]).toContain('imageGroup:img-123');
    expect(getOrderedThreadViewText()[2]).toContain('record:text-2');
    expect(consoleLog).toHaveBeenCalledWith('THREAD_RENDER snapshot_loaded thread=0001');
    expect(consoleLog).toHaveBeenCalledWith('THREAD_RENDER image_group_applied group=img-123');
  });

  it('thread_render_event_update', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 200 });
    render('thread:0001');

    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('record:text-2', 'record:text-2', 'thread:0001', 'text', 3, 201, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'record', eventVersion: 201 });
    render('thread:0001');

    expect(getOrderedThreadViewText()).toHaveLength(2);
    expect(getOrderedThreadViewText()[1]).toContain('record:text-2');
    expect(consoleLog).toHaveBeenCalledWith('THREAD_RENDER event_applied entity=record thread=0001');
  });

  it('image_group_render', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
      recordEntity('rec-2', 'image-2', 'thread:0001', 'image', 3, 202, 1, 'img-123'),
      recordEntity('record:text-2', 'record:text-2', 'thread:0001', 'text', 3, 202, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 200 });

    render('thread:0001');

    expect(getTextValues('[data-testid="image-group-item"]')).toEqual([
      'imageGroup:img-123 Media bundle [rec-1, rec-2]',
    ]);
    expect(getTextValues('[data-testid="record-item"]')).toEqual([
      'record:text-2 Text record record:text-2 · thread=thread:0001 · v202',
    ]);
  });

  it('image_group_ordering', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
      recordEntity('rec-2', 'image-2', 'thread:0001', 'image', 3, 202, 1, 'img-123'),
      recordEntity('record:text-2', 'record:text-2', 'thread:0001', 'text', 3, 202, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'record', eventVersion: 202 });

    render('thread:0001');

    expect(getOrderedThreadViewText()).toEqual([
      'record:text-1 Text record record:text-1 · thread=thread:0001 · v200',
      'imageGroup:img-123 Media bundle [rec-1, rec-2]',
      'record:text-2 Text record record:text-2 · thread=thread:0001 · v202',
    ]);
  });

  it('no_local_state_mutation_thread', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
    ]);
    const beforeHash = hashProjectionInputs();

    render('thread:0001');
    component.handleThreadSelection('thread:0001');
    fixture.detectChanges();

    expect(hashProjectionInputs()).toBe(beforeHash);
  });

  it('thread_view_accepts_frozen_projection_input_without_mutation', () => {
    projectionStateSignals.records.set(
      deepFreeze([
        recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
        recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
      ]),
    );

    expect(() => render('thread:0001')).not.toThrow();
    expect(component.viewNodes().map((node) => node.key)).toEqual([
      'record:record:text-1',
      'imageGroup:img-123',
    ]);
  });

  it('deterministic_thread_render', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'record:text-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-1', 'image-1', 'thread:0001', 'image', 2, 201, 1, 'img-123'),
      recordEntity('rec-2', 'image-2', 'thread:0001', 'image', 3, 202, 1, 'img-123'),
      recordEntity('record:text-2', 'record:text-2', 'thread:0001', 'text', 3, 202, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'snapshot_loaded', entityType: null, eventVersion: 200 });
    render('thread:0001');

    const firstRender = JSON.stringify(component.viewNodes());

    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'record', eventVersion: 202 });
    render('thread:0001');

    const secondRender = JSON.stringify(component.viewNodes());

    expect(firstRender).toBe(secondRender);
    expect(getTextValues('[data-testid="image-group-item"]')).toHaveLength(1);
  });

  it('thread_order_event_version', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-3', 'rec-3', 'thread:0001', 'text', 3, 202, 9),
      recordEntity('rec-1', 'rec-1', 'thread:0001', 'text', 1, 200, 7),
      recordEntity('rec-2', 'rec-2', 'thread:0001', 'text', 2, 201, 8),
    ]);

    render('thread:0001');

    expect(component.renderThread('thread:0001').map((node) => node.key)).toEqual([
      'record:rec-1',
      'record:rec-2',
      'record:rec-3',
    ]);
    expect(consoleLog).toHaveBeenCalledWith('THREAD_RENDER ordering_applied using eventVersion');
  });

  it('thread_order_stable_replay', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-3', 'rec-3', 'thread:0001', 'text', 3, 202, 1),
      recordEntity('rec-1', 'rec-1', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-2', 'rec-2', 'thread:0001', 'text', 2, 201, 1),
    ]);

    const firstRender = JSON.stringify(component.renderThread('thread:0001'));
    const secondRender = JSON.stringify(component.renderThread('thread:0001'));

    expect(firstRender).toBe(secondRender);
  });

  it('no_entity_version_usage', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-1', 'rec-1', 'thread:0001', 'text', 1, 201, 99),
      recordEntity('rec-2', 'rec-2', 'thread:0001', 'text', 1, 200, 1),
    ]);

    expect(component.renderThread('thread:0001').map((node) => node.key)).toEqual([
      'record:rec-2',
      'record:rec-1',
    ]);
  });

  it('no_runtime_position_usage', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-b', 'rec-b', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('rec-a', 'rec-a', 'thread:0001', 'text', 1, 200, 1),
    ]);

    expect(component.renderThread('thread:0001').map((node) => node.key)).toEqual([
      'record:rec-a',
      'record:rec-b',
    ]);
  });

  it('deterministic_group_ordering', () => {
    projectionStateSignals.records.set([
      recordEntity('rec-3', 'rec-3', 'thread:0001', 'text', 3, 202, 1),
      recordEntity('rec-2b', 'img-b', 'thread:0001', 'image', 2, 201, 1, 'img-200'),
      recordEntity('rec-2a', 'img-a', 'thread:0001', 'image', 2, 200, 1, 'img-100'),
      recordEntity('rec-1', 'rec-1', 'thread:0001', 'text', 1, 199, 1),
    ]);

    expect(component.renderThread('thread:0001').map((node) => node.key)).toEqual([
      'record:rec-1',
      'imageGroup:img-100',
      'imageGroup:img-200',
      'record:rec-3',
    ]);
  });

  it('no_optimistic_update_record', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'Original body', 'thread:0001', 'text', 1, 200, 1),
    ]);
    render('thread:0001');

    vi.spyOn(globalThis, 'prompt').mockReturnValueOnce('Updated body');

    const editButton = fixture.nativeElement.querySelector('[aria-label="Edit record body"]') as HTMLButtonElement;
    editButton.click();
    fixture.detectChanges();

    expect(sendCommand).toHaveBeenCalledWith({
      entityType: 'record',
      entityId: 'record:text-1',
      operation: 'update',
      payload: {
        body: 'Updated body',
      },
    });
    expect(getTextValues('[data-testid="record-item"]')).toEqual([
      'Original body Text record record:text-1 · thread=thread:0001 · v200',
    ]);
  });

  it('event_driven_update_record', () => {
    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'Original body', 'thread:0001', 'text', 1, 200, 1),
    ]);
    render('thread:0001');

    vi.spyOn(globalThis, 'prompt').mockReturnValueOnce('Created body');

    const createButton = fixture.nativeElement.querySelector('[data-testid="create-record-button"]') as HTMLButtonElement;
    createButton.click();
    fixture.detectChanges();

    expect(getTextValues('[data-testid="record-item"]')).toEqual([
      'Original body Text record record:text-1 · thread=thread:0001 · v200',
    ]);

    projectionStateSignals.records.set([
      recordEntity('record:text-1', 'Original body', 'thread:0001', 'text', 1, 200, 1),
      recordEntity('record:text-2', 'Created body', 'thread:0001', 'text', 2, 201, 1),
    ]);
    projectionUpdateSignal.set({ reason: 'event_applied', entityType: 'record', eventVersion: 201 });
    render('thread:0001');

    expect(getTextValues('[data-testid="record-item"]')).toEqual([
      'Original body Text record record:text-1 · thread=thread:0001 · v200',
      'Created body Text record record:text-2 · thread=thread:0001 · v201',
    ]);
  });

  it('thread_view_record_click_opens_media_viewer', () => {
    projectionStateSignals.records.set([
      {
        ...recordEntity('rec-1', 'Cover image', 'thread:0001', 'image', 1, 200, 1, null),
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
      },
    ]);

    render('thread:0001');

    const recordButton = fixture.nativeElement.querySelector('[data-testid="record-item"]') as HTMLButtonElement;
    recordButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="media-viewer-overlay"]')).not.toBeNull();
    expect(consoleLog).toHaveBeenCalledWith('MEDIA_VIEW_OPEN record=rec-1 type=image');
  });
});