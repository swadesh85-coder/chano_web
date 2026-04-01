import { Injectable, inject } from '@angular/core';
import {
  ExplorerMutationGateway,
  type ExplorerMutationEntityType,
  type ExplorerMutationEnvelope,
} from './explorer_mutation_gateway';

@Injectable({ providedIn: 'root' })
export class ExplorerActions {
  private readonly mutations = inject(ExplorerMutationGateway);

  onCreateThread(folderId: string, title: string): ExplorerMutationEnvelope | null {
    const normalizedTitle = normalizeRequiredText(title, 'INVALID_THREAD_TITLE');

    if (this.mutations.isCreatePending('thread')) {
      return null;
    }

    console.log(`UI_ACTION create_thread folder=${folderId}`);
    return this.mutations.createThread(folderId, normalizedTitle);
  }

  onRenameEntity(
    entityType: ExplorerMutationEntityType,
    entityId: string,
    newTitle: string,
  ): ExplorerMutationEnvelope | null {
    const normalizedTitle = normalizeRequiredText(newTitle, 'INVALID_ENTITY_TITLE');

    if (this.mutations.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION rename entity=${entityType} id=${entityId}`);
    return this.mutations.renameEntity(entityType, entityId, normalizedTitle);
  }

  onMoveEntity(
    entityType: ExplorerMutationEntityType,
    entityId: string,
    targetId: string,
  ): ExplorerMutationEnvelope | null {
    const normalizedTargetId = normalizeRequiredText(targetId, 'INVALID_MOVE_TARGET');

    if (this.mutations.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION move entity=${entityType} id=${entityId} target=${normalizedTargetId}`);

    switch (entityType) {
      case 'thread':
      case 'record':
        return this.mutations.moveEntity(entityType, entityId, normalizedTargetId);
      default:
        throw new Error('UNSUPPORTED_MOVE_ENTITY');
    }
  }

  onSoftDelete(
    entityType: ExplorerMutationEntityType,
    entityId: string,
  ): ExplorerMutationEnvelope | null {
    if (this.mutations.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION soft_delete entity=${entityType} id=${entityId}`);
    return this.mutations.softDelete(entityType, entityId);
  }

  onRestore(
    entityType: ExplorerMutationEntityType,
    entityId: string,
  ): ExplorerMutationEnvelope | null {
    if (this.mutations.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION restore entity=${entityType} id=${entityId}`);
    return this.mutations.restore(entityType, entityId);
  }

  isPending(entityId: string): boolean {
    return this.mutations.isPending(entityId);
  }

  isCreatePending(entityType: ExplorerMutationEntityType): boolean {
    return this.mutations.isCreatePending(entityType);
  }
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(errorCode);
  }

  return normalizedValue;
}