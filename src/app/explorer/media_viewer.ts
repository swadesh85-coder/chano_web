import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  type MediaViewerViewModel,
  type RecordViewModel,
} from '../../viewmodels';
import { ExplorerContainer } from '../explorer.container';

type SupportedMediaType = 'image' | 'file' | 'audio';

type MediaViewerState = MediaViewerViewModel;

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
  private readonly container = inject(ExplorerContainer);

  readonly threadId = input<string | null>(null);
  readonly viewerOpen = signal(false);
  readonly selectedRecordId = signal<string | null>(null);
  readonly selectedRecord = computed(() =>
    this.container.selectMediaRecord(this.threadId(), this.selectedRecordId()),
  );
  readonly renderState = computed(() =>
    this.container.selectMediaViewerState(this.threadId(), this.selectedRecordId()),
  );

  openMedia(recordId: string): void {
    const record = this.container.selectMediaRecord(this.threadId(), recordId);
    if (record === null || !this.isSupportedMediaType(record.type)) {
      return;
    }

    this.selectedRecordId.set(record.id);
    this.viewerOpen.set(true);
    console.log(`MEDIA_VIEW_OPEN record=${record.id} type=${record.type}`);

    const state = this.renderState();
    if (state !== null) {
      console.log(`MEDIA_RENDER type=${state.type} mediaId=${state.mediaId ?? 'null'}`);
    }
  }

  canNavigateBackward(): boolean {
    return (this.renderState()?.currentIndex ?? 0) > 0;
  }

  canNavigateForward(): boolean {
    const state = this.renderState();
    if (state === null) {
      return false;
    }

    return state.currentIndex < state.groupRecordIds.length - 1;
  }

  closeMediaViewer(): void {
    const record = this.selectedRecord();
    if (record !== null) {
      console.log(`MEDIA_VIEW_CLOSE record=${record.id}`);
    }

    this.viewerOpen.set(false);
    this.selectedRecordId.set(null);
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
    if (nextRecord === null || nextRecord.type !== 'image') {
      return;
    }

    this.selectedRecordId.set(nextRecord.id);
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

  private resolveRecord(recordId: string): RecordViewModel | null {
    return this.container.selectMediaRecord(this.threadId(), recordId);
  }

  private isSupportedMediaType(type: string): type is SupportedMediaType {
    return type === 'image' || type === 'file' || type === 'audio';
  }
}