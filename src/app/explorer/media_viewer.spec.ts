import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaViewerComponent } from './media_viewer';
import { ProjectionStore } from '../projection/projection.store';
import type { ProjectionState, RecordEntry } from '../projection/projection.models';

describe('MediaViewerComponent', () => {
  let fixture: ComponentFixture<MediaViewerComponent>;
  let component: MediaViewerComponent;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let projectionRecords: ReturnType<typeof signal<RecordEntry[]>>;

  beforeEach(async () => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    projectionRecords = signal<RecordEntry[]>([]);

    await TestBed.configureTestingModule({
      imports: [MediaViewerComponent],
      providers: [
        {
          provide: ProjectionStore,
          useValue: {
            state: (): ProjectionState => ({
              folders: [],
              threads: [],
              records: projectionRecords(),
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MediaViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function recordEntity(
    recordId: string,
    type: 'image' | 'file' | 'audio',
    overrides: Partial<RecordEntry> = {},
  ): RecordEntry {
    return {
      id: recordId,
      threadId: 'thread:0001',
      type,
      name: `${type} body`,
      createdAt: 1,
      editedAt: 1,
      orderIndex: 0,
      isStarred: false,
      imageGroupId: null,
      entityVersion: 1,
      lastEventVersion: 1,
      ...overrides,
    };
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

  it('media_viewer_open_image', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        name: 'Hero image',
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
        orderIndex: 0,
      }),
      recordEntity('rec-2', 'image', {
        name: 'Hero image alt',
        mediaId: 'media-790',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
        orderIndex: 1,
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-1');
    fixture.detectChanges();

    expect(component.viewerOpen()).toBe(true);
    expect(component.selectedRecord()?.id).toBe('rec-1');
    expect(component.renderState()).toMatchObject({
      type: 'image',
      recordId: 'rec-1',
      mediaId: 'media-789',
      mimeType: 'image/jpeg',
      imageGroupId: 'img-123',
      currentIndex: 0,
    });
    expect(fixture.nativeElement.querySelector('[data-testid="media-image-placeholder"]')).not.toBeNull();
    expect(consoleLog).toHaveBeenCalledWith('MEDIA_VIEW_OPEN record=rec-1 type=image');
    expect(consoleLog).toHaveBeenCalledWith('MEDIA_RENDER type=image mediaId=media-789');
  });

  it('media_viewer_open_file', () => {
    projectionRecords.set([
      recordEntity('rec-file', 'file', {
        title: 'Quarterly report',
        mediaId: 'file-123',
        mimeType: 'application/pdf',
        size: 4096,
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-file');
    fixture.detectChanges();

    expect(component.renderState()).toMatchObject({
      type: 'file',
      recordId: 'rec-file',
      title: 'Quarterly report',
      mediaId: 'file-123',
      mimeType: 'application/pdf',
      size: 4096,
    });
    expect(fixture.nativeElement.querySelector('[data-testid="media-file-metadata"]')).not.toBeNull();
  });

  it('media_viewer_open_audio', () => {
    projectionRecords.set([
      recordEntity('rec-audio', 'audio', {
        title: 'Voice memo',
        mediaId: 'aud-555',
        mimeType: 'audio/mpeg',
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-audio');
    fixture.detectChanges();

    expect(component.renderState()).toMatchObject({
      type: 'audio',
      recordId: 'rec-audio',
      title: 'Voice memo',
      mediaId: 'aud-555',
      mimeType: 'audio/mpeg',
    });
    expect(fixture.nativeElement.querySelector('[data-testid="media-audio-placeholder"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('audio')).toBeNull();
  });

  it('no_media_network_call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-1');
    fixture.detectChanges();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('audio')).toBeNull();
  });

  it('no_projection_mutation', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'file', {
        mediaId: 'file-123',
        mimeType: 'application/pdf',
      }),
    ]);
    const beforeHash = JSON.stringify(projectionRecords());

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-1');
    component.closeMediaViewer();

    expect(JSON.stringify(projectionRecords())).toBe(beforeHash);
  });

  it('media_viewer_accepts_frozen_projection_input_without_mutation', () => {
    projectionRecords.set(
      deepFreeze([
        recordEntity('rec-1', 'image', {
          name: 'Hero image',
          mediaId: 'media-789',
          mimeType: 'image/jpeg',
          imageGroupId: 'img-123',
          orderIndex: 0,
        }),
        recordEntity('rec-2', 'image', {
          name: 'Hero image alt',
          mediaId: 'media-790',
          mimeType: 'image/jpeg',
          imageGroupId: 'img-123',
          orderIndex: 1,
        }),
      ]),
    );

    fixture.componentRef.setInput('threadId', 'thread:0001');

    expect(() => {
      component.openMedia('rec-1');
      fixture.detectChanges();
      component.navigateImageGroup(1);
      fixture.detectChanges();
    }).not.toThrow();

    expect(component.selectedRecord()?.id).toBe('rec-2');
  });

  it('viewer_close_cleanup', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-1');
    fixture.detectChanges();
    component.closeMediaViewer();
    fixture.detectChanges();

    expect(component.viewerOpen()).toBe(false);
    expect(component.selectedRecord()).toBeNull();
    expect(component.renderState()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="media-viewer-overlay"]')).toBeNull();
    expect(consoleLog).toHaveBeenCalledWith('MEDIA_VIEW_CLOSE record=rec-1');
  });

  it('media_viewer_render_is_deterministic_for_same_input', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        name: 'Hero image',
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
      }),
      recordEntity('rec-2', 'image', {
        name: 'Hero image alt',
        mediaId: 'media-790',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
      }),
    ]);

    fixture.componentRef.setInput('threadId', 'thread:0001');
    component.openMedia('rec-1');
    fixture.detectChanges();
    const firstRender = fixture.nativeElement.querySelector('[data-testid="media-viewer-overlay"]')?.textContent?.replace(/\s+/g, ' ').trim();

    fixture.detectChanges();
    const secondRender = fixture.nativeElement.querySelector('[data-testid="media-viewer-overlay"]')?.textContent?.replace(/\s+/g, ' ').trim();

    expect(firstRender).toBe(secondRender);
  });
});