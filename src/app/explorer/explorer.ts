import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { WebRelayClient } from '../../transport/web-relay-client';
import { ContentPaneComponent } from './content_pane';
import { FolderTreeComponent } from './folder_tree';
import type { ProjectionUpdate } from '../projection/projection.models';
import { ExplorerActions } from './explorer_actions';
import { RecordEditor } from './record_editor';
import { ExplorerContentPaneContainer } from '../explorer_content_pane.container';
import { ExplorerFolderTreeContainer } from '../explorer_folder_tree.container';
import { NavigationContainer } from '../navigation.container';
import type { MutationEntityType } from '../../transport';
import {
  type FolderTreeViewModel,
  type RecordViewModel,
  type ThreadListViewModel,
} from '../../viewmodels';

@Component({
  selector: 'app-explorer',
  imports: [ContentPaneComponent, FolderTreeComponent],
  templateUrl: './explorer.html',
  styleUrl: './explorer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerComponent {
  private readonly actions = inject(ExplorerActions);
  private readonly recordEditor = inject(RecordEditor);
  private readonly relay = inject(WebRelayClient);
  private readonly contentPaneContainer = inject(ExplorerContentPaneContainer);
  private readonly folderTreeContainer = inject(ExplorerFolderTreeContainer);
  private readonly navigation = inject(NavigationContainer);

  readonly rootFolderId: null = null;
  readonly selectedFolderId = this.navigation.selectedFolderId;
  readonly selectedThreadId = this.navigation.selectedThreadId;
  readonly activePane = this.navigation.activePane;
  readonly folderTree = this.folderTreeContainer.folderTree;
  readonly threadList = computed(() =>
    this.activePane() !== 'empty'
      ? this.contentPaneContainer.threadList(this.selectedFolderId())
      : [],
  );
  readonly recordList = computed(() =>
    this.activePane() === 'thread' && this.selectedThreadId() !== null
      ? this.contentPaneContainer.recordList(this.selectedThreadId())
      : [],
  );
  readonly contentPane = computed(() =>
    this.contentPaneContainer.contentPane(
      this.selectedFolderId(),
      this.selectedThreadId(),
      this.activePane(),
    ),
  );
  readonly selectedFolder = computed(() =>
    this.activePane() === 'empty'
      ? null
      : this.folderTreeContainer.findFolder(this.selectedFolderId()),
  );
  readonly disabledThreadIds = computed<Readonly<Record<string, boolean>>>(() => {
    return Object.fromEntries(
      this.threadList().map((thread) => [thread.id, this.isActionDisabled(thread.id)]),
    );
  });
  readonly disabledRecordIds = computed<Readonly<Record<string, boolean>>>(() => {
    return Object.fromEntries(
      this.recordList().map((record) => [record.id, this.isRecordActionDisabled(record.id)]),
    );
  });

  constructor() {
    effect(() => {
      const folderCount = this.countFolderNodes(this.folderTree());
      const threads = this.threadList();
      const records = this.recordList();
      console.log(
        `EXPLORER_RENDER folders=${folderCount} threads=${threads.length} records=${records.length}`,
      );
      console.log(
        `EXPLORER_RENDER folders=${folderCount} threads=${threads.length} records=${records.length} type=projection_render sessionId=${this.relay.sessionId() ?? 'null'}`,
      );
    });
  }

  handleSelection(entityType: 'folder' | 'thread', entityId: string | null): void {
    if (entityType === 'folder') {
      this.selectFolder(entityId);
      return;
    }

    if (entityId !== null) {
      this.selectThread(entityId);
    }
  }

  selectFolder(folderId: string | null): void {
    if (this.activePane() === 'folder' && this.selectedFolderId() === folderId) {
      return;
    }

    this.navigation.selectFolder(folderId);
  }

  selectThread(threadId: string): void {
    const thread = this.threadList().find((candidate) => candidate.id === threadId);
    if (thread === undefined) {
      return;
    }

    this.navigation.selectThread(threadId);
  }

  onCreateThread(folderId: string, title: string): void {
    this.actions.onCreateThread(folderId, title);
  }

  onRenameEntity(entityType: MutationEntityType, entityId: string, newTitle: string): void {
    this.actions.onRenameEntity(entityType, entityId, newTitle);
  }

  onMoveEntity(entityType: MutationEntityType, entityId: string, targetId: string): void {
    this.actions.onMoveEntity(entityType, entityId, targetId);
  }

  onSoftDelete(entityType: MutationEntityType, entityId: string): void {
    this.actions.onSoftDelete(entityType, entityId);
  }

  onRestore(entityType: MutationEntityType, entityId: string): void {
    this.actions.onRestore(entityType, entityId);
  }

  isActionDisabled(entityId: string): boolean {
    return this.actions.isPending(entityId);
  }

  isCreateThreadDisabled(): boolean {
    return this.actions.isCreatePending('thread');
  }

  isCreateRecordDisabled(): boolean {
    return this.recordEditor.isCreatePending();
  }

  promptCreateThread(folderId: string, event: Event): void {
    event.stopPropagation();

    const title = globalThis.prompt('Thread title');
    if (typeof title !== 'string') {
      return;
    }

    this.onCreateThread(folderId, title);
  }

  promptCreateRecord(event: Event): void {
    event.stopPropagation();

    const threadId = this.selectedThreadId();
    if (threadId === null) {
      return;
    }

    const body = globalThis.prompt('New text record body', '');
    if (typeof body !== 'string') {
      return;
    }

    this.recordEditor.createRecord(threadId, body);
  }

  promptRenameEntity(entityType: MutationEntityType, entityId: string, currentTitle: string, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', currentTitle);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.onRenameEntity(entityType, entityId, newTitle);
  }

  promptEditRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const currentBody = typeof record.content === 'string' ? record.content : '';
    const body = globalThis.prompt('Edit record body', currentBody);
    if (typeof body !== 'string') {
      return;
    }

    this.recordEditor.updateRecord(record.id, body);
  }

  promptRenameRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', record.displayLabel);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.recordEditor.renameRecord(record.id, newTitle);
  }

  promptMoveEntity(entityType: Extract<MutationEntityType, 'thread' | 'record'>, entityId: string, currentName: string, event: Event): void {
    event.stopPropagation();

    const targetLabel = entityType === 'thread' ? 'target folder id' : 'target thread id';
    const targetId = globalThis.prompt(`Move ${currentName} to ${targetLabel}`);
    if (typeof targetId !== 'string') {
      return;
    }

    this.onMoveEntity(entityType, entityId, targetId);
  }

  promptMoveRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();

    const targetId = globalThis.prompt(`Move ${record.displayLabel} to target thread id`);
    if (typeof targetId !== 'string') {
      return;
    }

    this.actions.onMoveEntity('record', record.id, targetId);
  }

  triggerSoftDelete(entityType: MutationEntityType, entityId: string, event: Event): void {
    event.stopPropagation();
    this.onSoftDelete(entityType, entityId);
  }

  triggerSoftDeleteRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();
    this.actions.onSoftDelete('record', record.id);
  }

  isRecordActionDisabled(entityId: string): boolean {
    return this.actions.isPending(entityId) || this.recordEditor.isPending(entityId);
  }

  trackFolder(_index: number, node: FolderTreeViewModel): string {
    return node.id;
  }

  trackThread(_index: number, thread: ThreadListViewModel): string {
    return thread.id;
  }

  trackRecord(_index: number, record: RecordViewModel): string {
    return record.id;
  }

  private readonly projectionEffect = effect(() => {
    this.folderTree();
    this.threadList();
    this.recordList();
    const projectionUpdate = this.contentPaneContainer.projectionUpdate();

    this.refreshOnSnapshotAndEvents(projectionUpdate);
  });

  private refreshOnSnapshotAndEvents(projectionUpdate: ProjectionUpdate | null): void {
    if (projectionUpdate === null) {
      return;
    }

    if (projectionUpdate.reason === 'snapshot_loaded') {
      console.log('EXPLORER_RENDER snapshot_loaded');
      return;
    }

    if (projectionUpdate.entityType !== null) {
      console.log(`EXPLORER_RENDER event_applied entity=${projectionUpdate.entityType}`);
    }
  }

  private countFolderNodes(nodes: readonly FolderTreeViewModel[]): number {
    let count = 0;
    for (const node of nodes) {
      count += 1;
      count += this.countFolderNodes(node.children);
    }

    return count;
  }
}
