import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ProjectionStore } from '../projection/projection.store';
import type { ExplorerNode } from '../projection/projection.models';
import { ExplorerActions } from './explorer_actions';
import type { MutationEntityType } from '../../transport';

@Component({
  selector: 'app-explorer',
  imports: [NgTemplateOutlet],
  templateUrl: './explorer.html',
  styleUrl: './explorer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorerComponent {
  private readonly projection = inject(ProjectionStore);
  private readonly actions = inject(ExplorerActions);

  readonly tree = this.projection.explorerTree;
  readonly expandedIds = signal(new Set<string>());

  toggle(nodeId: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  isExpanded(nodeId: string): boolean {
    return this.expandedIds().has(nodeId);
  }

  trackNode(_index: number, node: ExplorerNode): string {
    return node.id;
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

  isActionDisabled(node: ExplorerNode): boolean {
    return this.actions.isPending(node.id);
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

  promptRenameEntity(node: ExplorerNode, event: Event): void {
    event.stopPropagation();

    const newTitle = globalThis.prompt('Rename item', node.name);
    if (typeof newTitle !== 'string') {
      return;
    }

    this.onRenameEntity(this.toMutationEntityType(node), node.id, newTitle);
  }

  promptMoveEntity(node: ExplorerNode, event: Event): void {
    event.stopPropagation();

    const targetLabel = node.type === 'thread' ? 'target folder id' : 'target thread id';
    const targetId = globalThis.prompt(`Move ${node.name} to ${targetLabel}`);
    if (typeof targetId !== 'string') {
      return;
    }

    this.onMoveEntity(this.toMutationEntityType(node), node.id, targetId);
  }

  triggerSoftDelete(node: ExplorerNode, event: Event): void {
    event.stopPropagation();
    this.onSoftDelete(this.toMutationEntityType(node), node.id);
  }

  private toMutationEntityType(node: ExplorerNode): MutationEntityType {
    return node.type;
  }
}
