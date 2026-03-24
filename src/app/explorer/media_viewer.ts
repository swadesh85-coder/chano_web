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
              class="media-viewer-close"
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
                      class="media-viewer-nav-button"
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
                      class="media-viewer-nav-button"
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
  styles: [
    `
      :host {
        display: contents;
      }

      .media-viewer-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: rgba(2, 6, 23, 0.78);
        backdrop-filter: blur(10px);
      }

      .media-viewer-dialog {
        width: min(42rem, 100%);
        max-height: min(44rem, calc(100dvh - 3rem));
        overflow: auto;
        border: 1px solid rgba(94, 234, 212, 0.22);
        border-radius: 1.25rem;
        background:
          radial-gradient(circle at top right, rgba(20, 184, 166, 0.18), transparent 35%),
          linear-gradient(180deg, rgba(8, 16, 20, 0.98), rgba(6, 11, 16, 0.98));
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
      }

      .media-viewer-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.25rem 1.25rem 1rem;
        border-bottom: 1px solid rgba(94, 234, 212, 0.12);
      }

      .media-viewer-eyebrow {
        margin: 0 0 0.35rem;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(153, 246, 228, 0.7);
      }

      .media-viewer-title {
        margin: 0;
        color: #f0fdfa;
        font-size: 1.15rem;
      }

      .media-viewer-close,
      .media-viewer-nav-button {
        border: 1px solid rgba(153, 246, 228, 0.18);
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.34);
        color: rgba(240, 253, 250, 0.92);
        padding: 0.45rem 0.85rem;
        font-size: 0.78rem;
        cursor: pointer;
      }

      .media-viewer-close:disabled,
      .media-viewer-nav-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .media-viewer-stage {
        padding: 1.25rem;
      }

      .media-preview {
        display: grid;
        gap: 0.5rem;
        border: 1px solid rgba(153, 246, 228, 0.12);
        border-radius: 1rem;
        background: rgba(8, 16, 20, 0.82);
        padding: 1rem;
      }

      .media-preview--image {
        min-height: 18rem;
      }

      .media-preview-frame {
        display: grid;
        place-items: center;
        align-content: center;
        gap: 0.55rem;
        min-height: 16rem;
        border: 1px dashed rgba(94, 234, 212, 0.3);
        border-radius: 0.9rem;
        background: linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(15, 23, 42, 0.32));
      }

      .media-preview-label {
        font-weight: 600;
        color: #f0fdfa;
      }

      .media-preview-meta,
      .media-viewer-nav-meta,
      .media-viewer-metadata dt,
      .media-viewer-metadata dd {
        color: rgba(204, 251, 241, 0.72);
        font-size: 0.82rem;
      }

      .media-viewer-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 0.85rem;
      }

      .media-audio-shell {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 0.75rem;
        align-items: center;
      }

      .media-audio-button,
      .media-audio-time {
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.45);
        color: rgba(240, 253, 250, 0.65);
        font-size: 0.72rem;
      }

      .media-audio-track {
        display: block;
        height: 0.4rem;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(94, 234, 212, 0.18), rgba(148, 163, 184, 0.18));
      }

      .media-viewer-metadata {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: 0.75rem;
        margin: 0;
        padding: 0 1.25rem 1.25rem;
      }

      .media-viewer-metadata div {
        border: 1px solid rgba(153, 246, 228, 0.12);
        border-radius: 0.9rem;
        background: rgba(8, 16, 20, 0.72);
        padding: 0.85rem;
      }

      .media-viewer-metadata dt {
        margin: 0 0 0.35rem;
      }

      .media-viewer-metadata dd {
        margin: 0;
        color: #f0fdfa;
        word-break: break-word;
      }

      @media (max-width: 640px) {
        .media-viewer-backdrop {
          padding: 0.75rem;
        }

        .media-viewer-header,
        .media-viewer-stage,
        .media-viewer-metadata {
          padding-left: 1rem;
          padding-right: 1rem;
        }

        .media-viewer-nav {
          flex-direction: column;
          align-items: stretch;
        }
      }
    `,
  ],
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