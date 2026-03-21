import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ProjectionStore } from '../projection/projection.store';
import { WebRelayClient } from '../../transport/web-relay-client';
import { ThreadViewComponent } from './thread_view';
import type {
  FolderProjectionEntity,
  ProjectionSnapshotState,
  ProjectionUpdate,
  RecordProjectionEntity,
  ThreadProjectionEntity,
} from '../projection/projection.models';
import { ExplorerActions } from './explorer_actions';
import type { MutationEntityType } from '../../transport';

type FolderTreeNode = {
  readonly entity: FolderProjectionEntity;
  readonly children: readonly FolderTreeNode[];
};

type ExplorerView = {
  readonly folderTree: readonly FolderTreeNode[];
  readonly threadList: readonly ThreadProjectionEntity[];
  readonly recordList: readonly RecordProjectionEntity[];
};

@Component({
  selector: 'app-explorer',
  imports: [NgTemplateOutlet, ThreadViewComponent],
  templateUrl: './explorer.html',
  styleUrl: './explorer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerComponent {
  private readonly projection = inject(ProjectionStore);
  private readonly actions = inject(ExplorerActions);
  private readonly relay = inject(WebRelayClient);

  readonly rootFolderId: null = null;
  readonly selectedFolderId = signal<string | null>(this.rootFolderId);
  readonly selectedThreadId = signal<string | null>(null);
  readonly projectionState = computed(() => this.projection.getProjectionState());
  readonly explorerView = computed(() => this.renderExplorer(this.projectionState()));
  readonly folderTree = computed(() => this.explorerView().folderTree);
  readonly threadList = computed(() => this.explorerView().threadList);
  readonly recordList = computed(() => this.explorerView().recordList);
  readonly selectedFolder = computed(() => {
    const selectedFolderId = this.selectedFolderId();
    if (selectedFolderId === null) {
      return null;
    }

    return this.projectionState().folders.get(selectedFolderId) ?? null;
  });

  constructor() {
    this.subscribeToProjection();

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
    if (this.selectedFolderId() === folderId) {
      return;
    }

    this.selectedFolderId.set(folderId);
    this.selectedThreadId.set(null);
    console.log(`SELECT folder=${folderId}`);
  }

  selectThread(threadId: string): void {
    if (!this.threadList().some((thread) => thread.entityUuid === threadId)) {
      return;
    }

    this.selectedThreadId.set(threadId);
    console.log(`SELECT thread=${threadId}`);
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

  promptCreateThread(folderId: string, event: Event): void {
    event.stopPropagation();

    const title = globalThis.prompt('Thread title');
    if (typeof title !== 'string') {
      return;
    }

    this.onCreateThread(folderId, title);
  }

  promptRenameEntity(entityType: MutationEntityType, entityId: string, currentTitle: string, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', currentTitle);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.onRenameEntity(entityType, entityId, newTitle);
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

  triggerSoftDelete(entityType: MutationEntityType, entityId: string, event: Event): void {
    event.stopPropagation();
    this.onSoftDelete(entityType, entityId);
  }

  trackFolder(_index: number, node: FolderTreeNode): string {
    return node.entity.entityUuid;
  }

  trackThread(_index: number, thread: ThreadProjectionEntity): string {
    return thread.entityUuid;
  }

  trackRecord(_index: number, record: RecordProjectionEntity): string {
    return record.entityUuid;
  }

  private reconcileSelection(projectionState: ProjectionSnapshotState): void {
    const selectedFolderId = untracked(() => this.selectedFolderId());
    const selectedThreadId = untracked(() => this.selectedThreadId());
    const folderExists = selectedFolderId === null || projectionState.folders.has(selectedFolderId);

    if (!folderExists) {
      this.selectedFolderId.set(this.rootFolderId);
      console.log('SELECT folder=null');
    }

    if (selectedThreadId === null) {
      return;
    }

    const effectiveSelectedFolderId = folderExists ? selectedFolderId : this.rootFolderId;
    const visibleThreads = this.getVisibleThreads(projectionState, effectiveSelectedFolderId);
    const threadStillVisible = visibleThreads.some((thread) => thread.entityUuid === selectedThreadId);
    if (!threadStillVisible) {
      this.selectedThreadId.set(null);
      console.log('THREAD_REMOVED selection cleared');
    }
  }

  private subscribeToProjection(): void {
    effect(() => {
      const projectionState = this.projectionState();
      const projectionUpdate = this.projection.lastProjectionUpdate();

      this.reconcileSelection(projectionState);
      this.refreshOnSnapshotAndEvents(projectionUpdate);
    });
  }

  private renderExplorer(projectionState: ProjectionSnapshotState): ExplorerView {
    const folderTree = this.buildFolderTree(projectionState.folders);
    const threadList = this.getVisibleThreads(projectionState, this.selectedFolderId());
    const selectedThreadId = this.selectedThreadId();
    const recordList = selectedThreadId === null
      ? []
      : [...projectionState.records.values()].filter((record) => record.data.threadUuid === selectedThreadId);

    return {
      folderTree,
      threadList,
      recordList,
    };
  }

  private buildFolderTree(folders: ReadonlyMap<string, FolderProjectionEntity>): readonly FolderTreeNode[] {
    const childrenByParent = new Map<string | null, FolderProjectionEntity[]>();

    for (const folder of folders.values()) {
      const key = folder.data.parentFolderUuid;
      const siblings = childrenByParent.get(key) ?? [];
      siblings.push(folder);
      childrenByParent.set(key, siblings);
    }

    const buildNode = (entity: FolderProjectionEntity): FolderTreeNode => ({
      entity,
      children: (childrenByParent.get(entity.entityUuid) ?? []).map((child) => buildNode(child)),
    });

    return (childrenByParent.get(this.rootFolderId) ?? []).map((folder) => buildNode(folder));
  }

  private getVisibleThreads(
    projectionState: ProjectionSnapshotState,
    selectedFolderId: string | null,
  ): readonly ThreadProjectionEntity[] {
    return [...projectionState.threads.values()].filter((thread) => thread.data.folderUuid === selectedFolderId);
  }

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

  private countFolderNodes(nodes: readonly FolderTreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      count += 1;
      count += this.countFolderNodes(node.children);
    }

    return count;
  }
}
