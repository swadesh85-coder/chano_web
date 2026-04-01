import {
  Component,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ExplorerLayoutContainerComponent } from '../explorer.layout.container';
import type { ProjectionUpdate } from '../projection/projection.models';
import { ExplorerActions } from './explorer_actions';
import { RecordEditor } from './record_editor';
import type { ExplorerMutationEntityType } from './explorer_mutation_gateway';
import { ExplorerContentPaneContainer } from '../explorer_content_pane.container';
import { ExplorerFolderTreeContainer } from '../explorer_folder_tree.container';
import { NavigationContainer } from '../navigation.container';
import {
  type RecordViewModel,
} from '../../viewmodels';

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [ExplorerLayoutContainerComponent],
  host: {
    class: 'explorer-shell-host',
  },
  template: `
    <app-explorer-layout-container
      [folderTree]="folderTree()"
      [selectedFolderId]="selectedFolderId()"
      [selectedThreadId]="selectedThreadId()"
      [selectedFolder]="selectedFolder()"
      [activePane]="activePane()"
      [content]="contentPane()"
      [isThreadDisabled]="isThreadActionDisabled"
      [isRecordDisabled]="isRecordActionDisabledFn"
      [createThreadDisabled]="isCreateThreadDisabled()"
      [createRecordDisabled]="isCreateRecordDisabled()"
      (folderSelected)="selectFolder($event)"
      (threadSelected)="selectThread($event)"
      (createThreadRequested)="promptCreateThread($event)"
      (threadRenameRequested)="promptRenameEntity('thread', $event.id, $event.title, $event.event)"
      (threadMoveRequested)="promptMoveEntity('thread', $event.id, $event.title, $event.event)"
      (threadDeleteRequested)="triggerSoftDelete('thread', $event.id, $event.event)"
      (createRecordRequested)="promptCreateRecord($event)"
      (recordEditRequested)="promptEditRecord($event.record, $event.event)"
      (recordRenameRequested)="promptRenameRecord($event.record, $event.event)"
      (recordMoveRequested)="promptMoveRecord($event.record, $event.event)"
      (recordDeleteRequested)="triggerSoftDeleteRecord($event.record, $event.event)"
    ></app-explorer-layout-container>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerComponent {
  private readonly actions = inject(ExplorerActions);
  private readonly recordEditor = inject(RecordEditor);
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
  readonly isThreadActionDisabled = (entityId: string): boolean => this.actions.isPending(entityId);
  readonly isRecordActionDisabledFn = (entityId: string): boolean =>
    this.actions.isPending(entityId) || this.recordEditor.isPending(entityId);

  constructor() {
    effect(() => {
      console.log('EXPLORER_RENDER type=projection_render');
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

  onRenameEntity(entityType: ExplorerMutationEntityType, entityId: string, newTitle: string): void {
    this.actions.onRenameEntity(entityType, entityId, newTitle);
  }

  onMoveEntity(entityType: ExplorerMutationEntityType, entityId: string, targetId: string): void {
    this.actions.onMoveEntity(entityType, entityId, targetId);
  }

  onSoftDelete(entityType: ExplorerMutationEntityType, entityId: string): void {
    this.actions.onSoftDelete(entityType, entityId);
  }

  onRestore(entityType: ExplorerMutationEntityType, entityId: string): void {
    this.actions.onRestore(entityType, entityId);
  }

  isCreateThreadDisabled(): boolean {
    return this.actions.isCreatePending('thread');
  }

  isCreateRecordDisabled(): boolean {
    return this.recordEditor.isCreatePending();
  }

  promptCreateThread(event: Event): void {
    event.stopPropagation();

    const folderId = this.selectedFolderId();
    if (folderId === null) {
      return;
    }

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

  promptRenameEntity(entityType: ExplorerMutationEntityType, entityId: string, currentTitle: string, event: Event): void {
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

  promptMoveEntity(entityType: Extract<ExplorerMutationEntityType, 'thread' | 'record'>, entityId: string, currentName: string, event: Event): void {
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

  triggerSoftDelete(entityType: ExplorerMutationEntityType, entityId: string, event: Event): void {
    event.stopPropagation();
    this.onSoftDelete(entityType, entityId);
  }

  triggerSoftDeleteRecord(record: RecordViewModel, event: Event): void {
    event.stopPropagation();
    this.actions.onSoftDelete('record', record.id);
  }

  private readonly projectionEffect = effect(() => {
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
}
