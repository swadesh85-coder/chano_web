import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MediaViewerComponent } from './media_viewer';
import { ProjectionStore } from '../projection/projection.store';
import type { ProjectionSnapshotState, RecordProjectionEntity } from '../projection/projection.models';

describe('MediaViewerComponent', () => {
  let fixture: ComponentFixture<MediaViewerComponent>;
  let component: MediaViewerComponent;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let projectionRecords: ReturnType<typeof signal<RecordProjectionEntity[]>>;

  beforeEach(async () => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    projectionRecords = signal<RecordProjectionEntity[]>([]);

    await TestBed.configureTestingModule({
      imports: [MediaViewerComponent],
      providers: [
        {
          provide: ProjectionStore,
          useValue: {
            getProjectionState: (): ProjectionSnapshotState => buildProjectionState(projectionRecords()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MediaViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function recordEntity(
    recordId: string,
    type: 'image' | 'file' | 'audio',
    overrides: Partial<RecordProjectionEntity['data']> = {},
  ): RecordProjectionEntity {
    return {
      entityType: 'record',
      entityUuid: recordId,
      entityVersion: 1,
      data: {
        uuid: recordId,
        threadUuid: 'thread:0001',
        type,
        body: `${type} body`,
        createdAt: 1,
        editedAt: 1,
        orderIndex: 0,
        isStarred: false,
        imageGroupId: null,
        lastEventVersion: 1,
        ...overrides,
      },
    };
  }

  function buildProjectionState(records: readonly RecordProjectionEntity[]): ProjectionSnapshotState {
    const recordMap = new Map(records.map((record) => [record.entityUuid, cloneRecord(record)]));
    const imageGroups = new Map<string, readonly RecordProjectionEntity[]>();

    for (const record of recordMap.values()) {
      if (record.data.type !== 'image' || record.data.imageGroupId === null) {
        continue;
      }

      const group = imageGroups.get(record.data.imageGroupId) ?? [];
      imageGroups.set(record.data.imageGroupId, [...group, record]);
    }

    return {
      folders: new Map(),
      threads: new Map(),
      records: recordMap,
      imageGroups,
    };
  }

  function cloneRecord(record: RecordProjectionEntity): RecordProjectionEntity {
    return {
      ...record,
      data: { ...record.data },
    };
  }

  it('media_viewer_open_image', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        body: 'Hero image',
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
        orderIndex: 0,
      }),
      recordEntity('rec-2', 'image', {
        body: 'Hero image alt',
        mediaId: 'media-790',
        mimeType: 'image/jpeg',
        imageGroupId: 'img-123',
        orderIndex: 1,
      }),
    ]);

    component.openMedia('rec-1');
    fixture.detectChanges();

    expect(component.viewerOpen()).toBe(true);
    expect(component.selectedRecord()?.entityUuid).toBe('rec-1');
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

    component.openMedia('rec-1');
    component.closeMediaViewer();

    expect(JSON.stringify(projectionRecords())).toBe(beforeHash);
  });

  it('viewer_close_cleanup', () => {
    projectionRecords.set([
      recordEntity('rec-1', 'image', {
        mediaId: 'media-789',
        mimeType: 'image/jpeg',
      }),
    ]);

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
});