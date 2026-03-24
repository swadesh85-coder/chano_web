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
  standalone: true,
  host: {
    class: 'media-viewer-host',
    '(document:keydown.escape)': 'handleEscape($event)',
  },
  template: `
    @if (viewerOpen() && renderState(); as state) {
      <div
        class="media-viewer-backdrop"
        data-testid="media-viewer-overlay"
        (click)="closeMediaViewer()"
      >
        <section
          class="media-viewer-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="media-viewer-title"
          (click)="$event.stopPropagation()"
        >
          <header class="media-viewer-header">
            <div>
              <p class="media-viewer-eyebrow">Projection-only media viewer</p>
              <h3 id="media-viewer-title" class="media-viewer-title">{{ state.title }}</h3>
            </div>
            <button
              type="button"
              class="ui-pill-button media-viewer-close"
              aria-label="Close media viewer"
              (click)="closeMediaViewer()"
            >
              Close
            </button>
          </header>

          <div class="media-viewer-stage">
            @switch (state.type) {
              @case ('image') {
                <div class="media-preview media-preview--image" data-testid="media-image-placeholder">
                  <div class="media-preview-frame">
                    <span class="media-preview-label">Image placeholder</span>
                    <span class="media-preview-meta">{{ state.mimeType ?? 'Unknown mime type' }}</span>
                    <span class="media-preview-meta">{{ state.mediaId ?? 'No media id' }}</span>
                  </div>
                </div>

                @if (state.imageGroupId !== null && state.groupRecordIds.length > 1) {
                  <div class="media-viewer-nav">
                    <button
                      type="button"
                      class="ui-pill-button media-viewer-nav-button"
                      (click)="navigateImageGroup(-1)"
                      [disabled]="!canNavigateBackward()"
                    >
                      Previous
                    </button>
                    <span class="media-viewer-nav-meta">
                      Group {{ state.imageGroupId }} · {{ state.currentIndex + 1 }} / {{ state.groupRecordIds.length }}
                    </span>
                    <button
                      type="button"
                      class="ui-pill-button media-viewer-nav-button"
                      (click)="navigateImageGroup(1)"
                      [disabled]="!canNavigateForward()"
                    >
                      Next
                    </button>
                  </div>
                }
              }
              @case ('file') {
                <div class="media-preview media-preview--file" data-testid="media-file-metadata">
                  <span class="media-preview-label">File metadata</span>
                  <span class="media-preview-meta">Mime type: {{ state.mimeType ?? 'Unknown' }}</span>
                  <span class="media-preview-meta">Media id: {{ state.mediaId ?? 'Unavailable' }}</span>
                  <span class="media-preview-meta">Size: {{ formatSize(state.size) }}</span>
                </div>
              }
              @case ('audio') {
                <div class="media-preview media-preview--audio" data-testid="media-audio-placeholder">
                  <span class="media-preview-label">Audio player unavailable</span>
                  <div class="media-audio-shell" aria-hidden="true">
                    <span class="media-audio-button">Play</span>
                    <span class="media-audio-track"></span>
                    <span class="media-audio-time">00:00</span>
                  </div>
                  <span class="media-preview-meta">Mime type: {{ state.mimeType ?? 'Unknown' }}</span>
                  <span class="media-preview-meta">Media id: {{ state.mediaId ?? 'Unavailable' }}</span>
                </div>
              }
            }
          </div>

          <dl class="media-viewer-metadata">
            <div>
              <dt>Record</dt>
              <dd>{{ state.recordId }}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{{ state.type }}</dd>
            </div>
            <div>
              <dt>Mime Type</dt>
              <dd>{{ state.mimeType ?? 'Unavailable' }}</dd>
            </div>
            <div>
              <dt>Media Id</dt>
              <dd>{{ state.mediaId ?? 'Unavailable' }}</dd>
            </div>
          </dl>
        </section>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
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