import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  ],
  templateUrl: './explorer.layout.html',
  styleUrl: './explorer.layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerLayoutContainerComponent {
  private readonly destroyRef = inject(DestroyRef);

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
  readonly visibleFolders = computed(() => {
    if (this.selectedFolderId() === null) {
      return this.folderTree();
    }

    return this.selectedFolder()?.children ?? [];
  });

  private persistTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const initialRatio = this.loadPersistedSplitRatio();
    this.splitRatio.set(initialRatio);
    console.log(`LAYOUT_INIT ratio=${initialRatio.toFixed(3)}`);

    this.destroyRef.onDestroy(() => {
      this.clearPendingPersistence();
    });
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
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