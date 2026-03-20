import { Injectable, inject } from '@angular/core';
import {
  MutationCommandSender,
  type MutationCommand,
  type MutationEntityType,
  type TransportEnvelope,
} from '../../transport';
import { PendingCommandStore } from './pending_command_store';

@Injectable({ providedIn: 'root' })
export class ExplorerActions {
  private readonly sender = inject(MutationCommandSender);
  private readonly pending = inject(PendingCommandStore);

  onCreateThread(folderId: string, title: string): TransportEnvelope<MutationCommand> | null {
    const normalizedTitle = normalizeRequiredText(title, 'INVALID_THREAD_TITLE');

    if (this.pending.isCreatePending('thread')) {
      return null;
    }

    console.log(`UI_ACTION create_thread folder=${folderId}`);

    const envelope = this.sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title: normalizedTitle,
        kind: 'manual',
        folderId,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  onRenameEntity(
    entityType: MutationEntityType,
    entityId: string,
    newTitle: string,
  ): TransportEnvelope<MutationCommand> | null {
    const normalizedTitle = normalizeRequiredText(newTitle, 'INVALID_ENTITY_TITLE');

    if (this.pending.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION rename entity=${entityType} id=${entityId}`);

    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'rename',
      payload: {
        newTitle: normalizedTitle,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  onMoveEntity(
    entityType: MutationEntityType,
    entityId: string,
    targetId: string,
  ): TransportEnvelope<MutationCommand> | null {
    const normalizedTargetId = normalizeRequiredText(targetId, 'INVALID_MOVE_TARGET');

    if (this.pending.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION move entity=${entityType} id=${entityId} target=${normalizedTargetId}`);

    switch (entityType) {
      case 'thread': {
        const envelope = this.sender.sendCommand({
          entityType,
          entityId,
          operation: 'move',
          payload: {
            targetFolderId: normalizedTargetId,
          },
        });
        this.trackPending(envelope);
        return envelope;
      }
      case 'record': {
        const envelope = this.sender.sendCommand({
          entityType,
          entityId,
          operation: 'move',
          payload: {
            targetThreadId: normalizedTargetId,
          },
        });
        this.trackPending(envelope);
        return envelope;
      }
      default:
        throw new Error('UNSUPPORTED_MOVE_ENTITY');
    }
  }

  onSoftDelete(
    entityType: MutationEntityType,
    entityId: string,
  ): TransportEnvelope<MutationCommand> | null {
    if (this.pending.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION soft_delete entity=${entityType} id=${entityId}`);

    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'softDelete',
      payload: {},
    });

    this.trackPending(envelope);
    return envelope;
  }

  onRestore(
    entityType: MutationEntityType,
    entityId: string,
  ): TransportEnvelope<MutationCommand> | null {
    if (this.pending.isPending(entityId)) {
      return null;
    }

    console.log(`UI_ACTION restore entity=${entityType} id=${entityId}`);

    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'restore',
      payload: {},
    });

    this.trackPending(envelope);
    return envelope;
  }

  isPending(entityId: string): boolean {
    return this.pending.isPending(entityId);
  }

  isCreatePending(entityType: MutationEntityType): boolean {
    return this.pending.isCreatePending(entityType);
  }

  private trackPending(envelope: TransportEnvelope<MutationCommand> | null): void {
    if (envelope === null) {
      return;
    }

    this.pending.setPending(envelope.payload);
  }
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(errorCode);
  }

  return normalizedValue;
}