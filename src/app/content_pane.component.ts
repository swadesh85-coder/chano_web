import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ContentPaneComponent as ExplorerContentPaneComponent } from './explorer/content_pane';
import type { NavigationPane } from './navigation.state';
import type {
  ContentPaneViewModel,
  FolderTreeViewModel,
  RecordViewModel,
} from '../viewmodels';
import { SelectionBarComponent } from './explorer/selection_bar.component';
import { SelectionService } from './explorer/selection.service';
import { ContentListViewComponent } from './explorer/content_list_view.component';
import { ContentGridViewComponent } from './explorer/content_grid_view.component';
import { EmptyStateComponent } from './ui/empty_state.component';

type ViewMode = 'list' | 'grid';

@Component({
  selector: 'app-explorer-content-pane',
  standalone: true,
  imports: [
    ExplorerContentPaneComponent,
    SelectionBarComponent,
    ContentListViewComponent,
    ContentGridViewComponent,
    EmptyStateComponent,
  ],
  host: {
    class: 'explorer-content-pane-shell',
  },
  template: `
    <section class="layout-pane layout-pane--content" aria-label="Content pane panel">
      <!-- Header: Selection bar or Content header or Thread header -->
      @if (selection.hasSelection()) {
        <app-selection-bar
          (moveRequested)="bulkMoveRequested.emit($event)"
          (deleteRequested)="bulkDeleteRequested.emit($event)"
        ></app-selection-bar>
      } @else if (activePane() === 'thread') {
        <div class="content-header-bar">
          <div class="content-header-bar__path">
            <button type="button" class="content-header-bar__back" aria-label="Back to folder"
              (click)="folderSelected.emit(selectedFolderId())">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">arrow_back</span>
            </button>
            <span>{{ threadTitle() }}</span>
          </div>
          <div class="content-header-bar__controls">
            <button type="button" class="content-header-bar__view-button"
              aria-label="Show details"
              (click)="detailPanelRequested.emit()">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">info</span>
            </button>
          </div>
        </div>
      } @else {
        <div class="content-header-bar">
          <div class="content-header-bar__path">
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">folder</span>
            <span>{{ folderTitle() }}</span>
          </div>
          <div class="content-header-bar__controls">
            <button type="button" class="content-header-bar__view-button"
              [attr.aria-pressed]="viewMode() === 'grid'"
              aria-label="Grid view"
              (click)="viewMode.set('grid')">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">grid_view</span>
            </button>
            <button type="button" class="content-header-bar__view-button"
              [attr.aria-pressed]="viewMode() === 'list'"
              aria-label="List view"
              (click)="viewMode.set('list')">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">view_list</span>
            </button>
            <button type="button" class="content-header-bar__view-button"
              aria-label="Show details"
              (click)="detailPanelRequested.emit()">
              <span class="material-symbols-outlined icon-sm" aria-hidden="true">info</span>
            </button>
          </div>
        </div>
      }

      <!-- Body -->
      <div class="layout-pane__body" role="region" aria-label="Content pane"
        (dragover)="onFileDragOver($event)"
        (dragleave)="onFileDragLeave($event)"
        (drop)="onFileDrop($event)">

        @if (fileDropActive()) {
          <div class="file-drop-overlay" aria-hidden="true">
            <span class="material-symbols-outlined file-drop-overlay__icon">upload_file</span>
            <span class="file-drop-overlay__text">Drop files to upload</span>
          </div>
        }
        @if (activePane() === 'empty') {
          <app-empty-state
            [icon]="'cloud_off'"
            [title]="'Waiting for mobile connection'"
            [description]="'Connect your phone to access your vault'"
            [actionLabel]="'How to connect'"
          ></app-empty-state>
        } @else if (activePane() === 'thread') {
          <section class="content-main-section" [attr.data-mode]="content().mode">
            <app-content-pane
              [content]="content()"
              [selectedThreadId]="selectedThreadId()"
              [activeThreadId]="selectedThreadId()"
              [isThreadDisabled]="isThreadDisabled()"
              [isRecordDisabled]="isRecordDisabled()"
              [createRecordDisabled]="createRecordDisabled()"
              (threadSelected)="threadSelected.emit($event)"
              (threadRenameRequested)="threadRenameRequested.emit($event)"
              (threadMoveRequested)="threadMoveRequested.emit($event)"
              (threadDeleteRequested)="threadDeleteRequested.emit($event)"
              (createRecordRequested)="createRecordRequested.emit($event)"
              (recordEditRequested)="recordEditRequested.emit($event)"
              (recordRenameRequested)="recordRenameRequested.emit($event)"
              (recordMoveRequested)="recordMoveRequested.emit($event)"
              (recordDeleteRequested)="recordDeleteRequested.emit($event)"
            ></app-content-pane>
          </section>
        } @else if (viewMode() === 'grid') {
          <app-content-grid-view
            [folders]="childFolders()"
            [threads]="content().threadList"
            (folderActivated)="folderSelected.emit($event)"
            (threadActivated)="threadSelected.emit($event)"
          ></app-content-grid-view>
        } @else {
          <app-content-list-view
            [folders]="childFolders()"
            [threads]="content().threadList"
            (folderActivated)="folderSelected.emit($event)"
            (threadActivated)="threadSelected.emit($event)"
          ></app-content-list-view>
        }
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerContentPaneShellComponent {
  protected readonly selection = inject(SelectionService);

  readonly activePane = input<NavigationPane>('empty');
  readonly content = input.required<ContentPaneViewModel>();
  readonly childFolders = input<readonly FolderTreeViewModel[]>([]);
  readonly selectedThreadId = input<string | null>(null);
  readonly selectedFolderId = input<string | null>(null);
  readonly selectedFolder = input<FolderTreeViewModel | null>(null);
  readonly isThreadDisabled = input<(threadId: string) => boolean>(() => false);
  readonly isRecordDisabled = input<(recordId: string) => boolean>(() => false);
  readonly createRecordDisabled = input(false);

  readonly folderSelected = output<string | null>();
  readonly threadSelected = output<string>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();
  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly bulkMoveRequested = output<readonly string[]>();
  readonly bulkDeleteRequested = output<readonly string[]>();
  readonly detailPanelRequested = output<void>();
  readonly filesDropped = output<readonly File[]>();

  readonly viewMode = signal<ViewMode>('list');
  readonly fileDropActive = signal(false);

  readonly folderTitle = computed(() => {
    if (this.selectedFolderId() === null) {
      return 'My Vault';
    }
    return this.selectedFolder()?.name ?? 'Folder';
  });

  readonly threadTitle = computed(() => {
    const threadId = this.selectedThreadId();
    if (threadId === null) return 'Thread';
    const thread = this.content().threadList.find(t => t.id === threadId);
    return thread?.title ?? 'Thread';
  });

  onFileDragOver(event: DragEvent): void {
    if (this.activePane() !== 'thread') return;
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.fileDropActive.set(true);
  }

  onFileDragLeave(event: DragEvent): void {
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    const currentTarget = event.currentTarget as HTMLElement;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;
    this.fileDropActive.set(false);
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.fileDropActive.set(false);
    if (this.activePane() !== 'thread') return;

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    this.filesDropped.emit(Array.from(files));
  }
}