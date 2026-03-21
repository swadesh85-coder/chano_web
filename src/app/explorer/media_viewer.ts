import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ProjectionStore } from '../projection/projection.store';
import type { RecordProjectionEntity } from '../projection/projection.models';

type SupportedMediaType = 'image' | 'file' | 'audio';

type MediaViewerState = {
  readonly type: SupportedMediaType;
  readonly recordId: string;
  readonly title: string;
  readonly mediaId: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly imageGroupId: string | null;
  readonly groupRecordIds: readonly string[];
  readonly currentIndex: number;
};

@Component({
  selector: 'app-media-viewer',
  templateUrl: './media_viewer.html',
  styleUrl: './media_viewer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'handleEscape($event)',
  },
})
export class MediaViewerComponent {
  private readonly projection = inject(ProjectionStore);

  readonly viewerOpen = signal(false);
  readonly selectedRecord = signal<RecordProjectionEntity | null>(null);
  readonly renderState = signal<MediaViewerState | null>(null);
  readonly canNavigateBackward = computed(() => (this.renderState()?.currentIndex ?? 0) > 0);
  readonly canNavigateForward = computed(() => {
    const state = this.renderState();
    if (state === null) {
      return false;
    }

    return state.currentIndex < state.groupRecordIds.length - 1;
  });

  openMedia(recordId: string): void {
    const record = this.resolveRecord(recordId);
    if (record === null || !this.isSupportedMediaType(record.data.type)) {
      return;
    }

    this.selectedRecord.set(record);
    this.viewerOpen.set(true);
    console.log(`MEDIA_VIEW_OPEN record=${record.entityUuid} type=${record.data.type}`);
    this.renderSelectedRecord(record);
  }

  renderImage(record: RecordProjectionEntity): MediaViewerState {
    const groupRecords = this.resolveImageGroupRecords(record);
    const state: MediaViewerState = {
      type: 'image',
      recordId: record.entityUuid,
      title: this.resolveDisplayTitle(record),
      mediaId: this.resolveOptionalMediaText(record.data.mediaId),
      mimeType: this.resolveOptionalMediaText(record.data.mimeType),
      size: record.data.size ?? null,
      imageGroupId: record.data.imageGroupId,
      groupRecordIds: groupRecords.map((groupRecord) => groupRecord.entityUuid),
      currentIndex: Math.max(0, groupRecords.findIndex((groupRecord) => groupRecord.entityUuid === record.entityUuid)),
    };

    console.log(`MEDIA_RENDER type=image mediaId=${state.mediaId ?? 'null'}`);
    return state;
  }

  renderFile(record: RecordProjectionEntity): MediaViewerState {
    const state: MediaViewerState = {
      type: 'file',
      recordId: record.entityUuid,
      title: this.resolveDisplayTitle(record),
      mediaId: this.resolveOptionalMediaText(record.data.mediaId),
      mimeType: this.resolveOptionalMediaText(record.data.mimeType),
      size: record.data.size ?? null,
      imageGroupId: null,
      groupRecordIds: [record.entityUuid],
      currentIndex: 0,
    };

    console.log(`MEDIA_RENDER type=file mediaId=${state.mediaId ?? 'null'}`);
    return state;
  }

  renderAudio(record: RecordProjectionEntity): MediaViewerState {
    const state: MediaViewerState = {
      type: 'audio',
      recordId: record.entityUuid,
      title: this.resolveDisplayTitle(record),
      mediaId: this.resolveOptionalMediaText(record.data.mediaId),
      mimeType: this.resolveOptionalMediaText(record.data.mimeType),
      size: record.data.size ?? null,
      imageGroupId: null,
      groupRecordIds: [record.entityUuid],
      currentIndex: 0,
    };

    console.log(`MEDIA_RENDER type=audio mediaId=${state.mediaId ?? 'null'}`);
    return state;
  }

  closeMediaViewer(): void {
    const record = this.selectedRecord();
    if (record !== null) {
      console.log(`MEDIA_VIEW_CLOSE record=${record.entityUuid}`);
    }

    this.viewerOpen.set(false);
    this.selectedRecord.set(null);
    this.renderState.set(null);
  }

  navigateImageGroup(direction: -1 | 1): void {
    const state = this.renderState();
    if (state === null || state.type !== 'image') {
      return;
    }

    const nextRecordId = state.groupRecordIds[state.currentIndex + direction];
    if (typeof nextRecordId !== 'string') {
      return;
    }

    const nextRecord = this.resolveRecord(nextRecordId);
    if (nextRecord === null || nextRecord.data.type !== 'image') {
      return;
    }

    this.selectedRecord.set(nextRecord);
    this.renderState.set(this.renderImage(nextRecord));
  }

  handleEscape(event: Event): void {
    if (!this.viewerOpen()) {
      return;
    }

    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    event.preventDefault();
    this.closeMediaViewer();
  }

  formatSize(size: number | null): string {
    if (size === null) {
      return 'Unknown size';
    }

    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  private renderSelectedRecord(record: RecordProjectionEntity): void {
    switch (record.data.type) {
      case 'image':
        this.renderState.set(this.renderImage(record));
        break;
      case 'file':
        this.renderState.set(this.renderFile(record));
        break;
      case 'audio':
        this.renderState.set(this.renderAudio(record));
        break;
    }
  }

  private resolveRecord(recordId: string): RecordProjectionEntity | null {
    return this.projection.getProjectionState().records.get(recordId) ?? null;
  }

  private resolveImageGroupRecords(record: RecordProjectionEntity): readonly RecordProjectionEntity[] {
    if (record.data.imageGroupId === null) {
      return [record];
    }

    return this.projection.getProjectionState().imageGroups.get(record.data.imageGroupId) ?? [record];
  }

  private resolveDisplayTitle(record: RecordProjectionEntity): string {
    return record.data.title ?? (record.data.body || record.entityUuid);
  }

  private resolveOptionalMediaText(value: string | undefined): string | null {
    return typeof value === 'string' ? value : null;
  }

  private isSupportedMediaType(type: string): type is SupportedMediaType {
    return type === 'image' || type === 'file' || type === 'audio';
  }
}