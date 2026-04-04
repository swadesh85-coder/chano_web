import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ContentPaneViewModel, FolderTreeViewModel, RecordViewModel } from '../viewmodels';
import type { NavigationPane } from './navigation.state';
import { ToolbarComponent } from './toolbar.component';
import { SplitPaneComponent } from './split_pane.component';
import { FolderTreePaneComponent } from './folder_tree.component';
import { ExplorerContentPaneShellComponent } from './content_pane.component';
import { StatusBarComponent } from './status-bar.component';
import { ContextMenuComponent } from './ui/context-menu/context_menu.component';
import { DialogComponent } from './ui/dialog/dialog.component';
import { ToastContainerComponent } from './ui/toast/toast.component';
import { DetailPanelComponent } from './explorer/detail_panel.component';
import { KeyboardShortcutService } from './keyboard_shortcuts.service';

const DEFAULT_SPLIT_RATIO = 0.3;
const MIN_PERSISTED_SPLIT_RATIO = 0.2;
const MAX_PERSISTED_SPLIT_RATIO = 0.5;
const SPLIT_RATIO_STORAGE_KEY = 'chano.layout.splitRatio';
const PERSISTENCE_DEBOUNCE_MS = 150;

@Component({
  selector: 'app-explorer-layout-container',
  standalone: true,
  imports: [
    ToolbarComponent,
    SplitPaneComponent,
    FolderTreePaneComponent,
    ExplorerContentPaneShellComponent,
    StatusBarComponent,
    ContextMenuComponent,
    DialogComponent,
    ToastContainerComponent,
    DetailPanelComponent,
  ],
  template: `
    <section class="chano-explorer explorer-layout-shell" role="main" aria-label="Vault explorer">
      <app-explorer-toolbar
        #toolbar
        (sidebarToggleRequested)="toggleSidebar()"
        (viewToggleRequested)="toggleSidebar()"
      ></app-explorer-toolbar>

      @if (showDisconnectionBanner()) {
        <div class="disconnection-banner" role="alert">
          <span class="material-symbols-outlined icon-sm disconnection-banner__icon" aria-hidden="true">warning</span>
          <span class="disconnection-banner__text">Connection to your phone was lost. Viewing last synced data. Edits will sync when reconnected.</span>
          <button type="button" class="disconnection-banner__dismiss" aria-label="Dismiss"
            (click)="dismissDisconnectionBanner()">
            <span class="material-symbols-outlined icon-sm" aria-hidden="true">close</span>
          </button>
        </div>
      }

      <div class="explorer-layout-shell__body">
        <app-split-pane
          [ratio]="splitRatio()"
          [collapsed]="sidebarCollapsed()"
          (ratioChanged)="updateSplitRatio($event)"
        >
          <app-folder-tree-pane
            pane-left
            [nodes]="folderTree()"
            [selectedFolderId]="selectedFolderId()"
            [selectedFolder]="selectedFolder()"
            [activePane]="activePane()"
            [createThreadDisabled]="createThreadDisabled()"
            (folderSelected)="folderSelected.emit($event)"
            (createThreadRequested)="createThreadRequested.emit($event)"
          ></app-folder-tree-pane>

          <app-explorer-content-pane
            pane-right
            [activePane]="activePane()"
            [content]="content()"
            [childFolders]="visibleFolders()"
            [selectedThreadId]="selectedThreadId()"
            [selectedFolderId]="selectedFolderId()"
            [selectedFolder]="selectedFolder()"
            [isThreadDisabled]="isThreadDisabled()"
            [isRecordDisabled]="isRecordDisabled()"
            [createRecordDisabled]="createRecordDisabled()"
            (folderSelected)="folderSelected.emit($event)"
            (threadSelected)="threadSelected.emit($event)"
            (threadRenameRequested)="threadRenameRequested.emit($event)"
            (threadMoveRequested)="threadMoveRequested.emit($event)"
            (threadDeleteRequested)="threadDeleteRequested.emit($event)"
            (createRecordRequested)="createRecordRequested.emit($event)"
            (recordEditRequested)="recordEditRequested.emit($event)"
            (recordRenameRequested)="recordRenameRequested.emit($event)"
            (recordMoveRequested)="recordMoveRequested.emit($event)"
            (recordDeleteRequested)="recordDeleteRequested.emit($event)"
            (detailPanelRequested)="toggleDetailPanel()"
          ></app-explorer-content-pane>
        </app-split-pane>

        <app-detail-panel
          [open]="detailPanelOpen()"
          [title]="detailPanelTitle()"
          [entityType]="detailPanelEntityType()"
          [location]="detailPanelLocation()"
          [itemCount]="detailPanelItemCount()"
          (closeRequested)="detailPanelOpen.set(false)"
        ></app-detail-panel>
      </div>

      <app-status-bar></app-status-bar>

      <app-context-menu></app-context-menu>
      <app-dialog></app-dialog>
      <app-toast-container></app-toast-container>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      height: 100dvh;
      min-height: 100dvh;
    }

    /* Tablet: sidebar becomes overlay (Doc 25 §2.3) */
    @media (max-width: 1023px) {
      .split-pane {
        grid-template-columns: 1fr;
        grid-template-rows:
          minmax(var(--explorer-mobile-sidebar-min-height), var(--explorer-mobile-sidebar-max-height))
          var(--explorer-split-divider-size)
          minmax(var(--explorer-mobile-content-min-height), 1fr);
      }

      .split-pane--collapsed {
        grid-template-columns: 1fr;
        grid-template-rows: 0 var(--explorer-split-divider-size) minmax(var(--explorer-mobile-content-min-height), 1fr);
      }

      .split-pane__divider {
        width: 100%;
        cursor: row-resize;
      }

      .split-pane__divider::before {
        inset: var(--explorer-split-divider-mobile-inset-block) var(--explorer-split-divider-mobile-inset-inline);
      }

      .split-pane__divider-handle {
        width: var(--explorer-mobile-divider-handle-width);
        height: var(--explorer-mobile-divider-handle-height);
      }
    }

    /* Desktop XL: detail panel inline (Doc 25 §2.3) */
    @media (min-width: 1440px) {
      :host {
        --explorer-detail-panel-mode: inline;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerLayoutContainerComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly shortcuts = inject(KeyboardShortcutService);

  @ViewChild('toolbar') private toolbarRef!: ToolbarComponent;

  readonly folderTree = input.required<readonly FolderTreeViewModel[]>();
  readonly selectedFolderId = input<string | null>(null);
  readonly selectedThreadId = input<string | null>(null);
  readonly selectedFolder = input<FolderTreeViewModel | null>(null);
  readonly activePane = input<NavigationPane>('empty');
  readonly content = input.required<ContentPaneViewModel>();
  readonly isThreadDisabled = input<(threadId: string) => boolean>(() => false);
  readonly isRecordDisabled = input<(recordId: string) => boolean>(() => false);
  readonly createThreadDisabled = input(false);
  readonly createRecordDisabled = input(false);
  readonly connectionStatus = input<'connected' | 'syncing' | 'reconnecting' | 'disconnected' | 'error'>('disconnected');

  readonly folderSelected = output<string | null>();
  readonly threadSelected = output<string>();
  readonly createThreadRequested = output<Event>();
  readonly threadRenameRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadMoveRequested = output<{ readonly id: string; readonly title: string; readonly event: Event }>();
  readonly threadDeleteRequested = output<{ readonly id: string; readonly event: Event }>();
  readonly createRecordRequested = output<Event>();
  readonly recordEditRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordRenameRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordMoveRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();
  readonly recordDeleteRequested = output<{ readonly record: RecordViewModel; readonly event: Event }>();

  readonly splitRatio = signal(DEFAULT_SPLIT_RATIO);
  readonly sidebarCollapsed = signal(false);
  readonly detailPanelOpen = signal(false);
  readonly bannerDismissed = signal(false);

  readonly showDisconnectionBanner = computed(() => {
    const status = this.connectionStatus();
    return (status === 'disconnected' || status === 'error') && !this.bannerDismissed();
  });

  readonly visibleFolders = computed(() => {
    if (this.selectedFolderId() === null) {
      return this.folderTree();
    }

    return this.selectedFolder()?.children ?? [];
  });

  readonly detailPanelTitle = computed(() => {
    if (this.activePane() === 'thread') {
      const threadId = this.selectedThreadId();
      if (threadId !== null) {
        const thread = this.content().threadList.find(t => t.id === threadId);
        return thread?.title ?? 'Thread';
      }
    }
    if (this.activePane() === 'folder') {
      return this.selectedFolder()?.name ?? 'My Vault';
    }
    return 'Details';
  });

  readonly detailPanelEntityType = computed(() => {
    if (this.activePane() === 'thread') return 'Thread';
    if (this.activePane() === 'folder') return 'Folder';
    return '';
  });

  readonly detailPanelLocation = computed(() => {
    return this.selectedFolder()?.name ?? 'My Vault';
  });

  readonly detailPanelItemCount = computed<number | null>(() => {
    if (this.activePane() === 'thread') {
      const threadId = this.selectedThreadId();
      if (threadId !== null) {
        const thread = this.content().threadList.find(t => t.id === threadId);
        return thread?.recordCount ?? null;
      }
    }
    if (this.activePane() === 'folder') {
      return this.visibleFolders().length + this.content().threadList.length;
    }
    return null;
  });

  private persistTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const initialRatio = this.loadPersistedSplitRatio();
    this.splitRatio.set(initialRatio);
    console.log(`LAYOUT_INIT ratio=${initialRatio.toFixed(3)}`);

    this.shortcuts.register('i', () => this.toggleDetailPanel());
    this.shortcuts.register('n', () => this.newItemRequested.emit());
    this.shortcuts.register('Escape', () => this.detailPanelOpen.set(false));
    this.shortcuts.registerSequence('g', 'h', () => this.folderSelected.emit('root'));

    this.destroyRef.onDestroy(() => {
      this.shortcuts.unregister('i');
      this.shortcuts.unregister('n');
      this.shortcuts.unregister('Escape');
      this.shortcuts.unregister('g+h');
      this.clearPendingPersistence();
    });
  }

  readonly newItemRequested = output<void>();

  toggleDetailPanel(): void {
    this.detailPanelOpen.update(open => !open);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  dismissDisconnectionBanner(): void {
    this.bannerDismissed.set(true);
  }

  updateSplitRatio(ratio: number): void {
    if (!isPersistableSplitRatio(ratio) || ratio === this.splitRatio()) {
      return;
    }

    this.splitRatio.set(ratio);
    console.log(`LAYOUT_RESIZE (throttled) ratio=${ratio.toFixed(3)}`);
    this.scheduleSplitRatioPersistence(ratio);
  }

  private loadPersistedSplitRatio(): number {
    const storage = getSafeStorage();
    if (storage === null) {
      console.log(`LAYOUT_PERSIST_LOAD ratio=${DEFAULT_SPLIT_RATIO.toFixed(3)}`);
      return DEFAULT_SPLIT_RATIO;
    }

    try {
      const storedValue = storage.getItem(SPLIT_RATIO_STORAGE_KEY);
      if (storedValue === null) {
        console.log(`LAYOUT_PERSIST_LOAD ratio=${DEFAULT_SPLIT_RATIO.toFixed(3)}`);
        return DEFAULT_SPLIT_RATIO;
      }

      const parsedValue = Number.parseFloat(storedValue);
      if (!isPersistableSplitRatio(parsedValue)) {
        console.log(`LAYOUT_PERSIST_LOAD ratio=${DEFAULT_SPLIT_RATIO.toFixed(3)}`);
        return DEFAULT_SPLIT_RATIO;
      }

      console.log(`LAYOUT_PERSIST_LOAD ratio=${parsedValue.toFixed(3)}`);
      return parsedValue;
    } catch {
      console.log(`LAYOUT_PERSIST_LOAD ratio=${DEFAULT_SPLIT_RATIO.toFixed(3)}`);
      return DEFAULT_SPLIT_RATIO;
    }
  }

  private scheduleSplitRatioPersistence(ratio: number): void {
    this.clearPendingPersistence();
    this.persistTimeoutId = setTimeout(() => {
      this.persistTimeoutId = null;
      this.persistSplitRatio(ratio);
    }, PERSISTENCE_DEBOUNCE_MS);
  }

  private persistSplitRatio(ratio: number): void {
    if (!isPersistableSplitRatio(ratio)) {
      return;
    }

    const storage = getSafeStorage();
    if (storage === null) {
      return;
    }

    try {
      storage.setItem(SPLIT_RATIO_STORAGE_KEY, ratio.toFixed(3));
      console.log(`LAYOUT_PERSIST_SAVE ratio=${ratio.toFixed(3)}`);
    } catch {
      // Intentionally ignore storage failures to keep layout state UI-only and fail-safe.
    }
  }

  private clearPendingPersistence(): void {
    if (this.persistTimeoutId === null) {
      return;
    }

    clearTimeout(this.persistTimeoutId);
    this.persistTimeoutId = null;
  }
}

function isPersistableSplitRatio(value: number): boolean {
  return Number.isFinite(value)
    && value >= MIN_PERSISTED_SPLIT_RATIO
    && value <= MAX_PERSISTED_SPLIT_RATIO;
}

function getSafeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}