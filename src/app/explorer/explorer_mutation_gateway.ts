import { Injectable, inject } from '@angular/core';
import {
  MutationCommandSender,
  PendingCommandStore,
  type MutationCommand,
  type TransportEnvelope,
} from '../../transport';

export type ExplorerMutationEntityType = 'folder' | 'thread' | 'record' | 'imageGroup';
export type ExplorerMutationEnvelope = TransportEnvelope<MutationCommand>;

@Injectable({ providedIn: 'root' })
export class ExplorerMutationGateway {
  private readonly sender = inject(MutationCommandSender);
  private readonly pending = inject(PendingCommandStore);

  createThread(folderId: string, title: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType: 'thread',
      operation: 'create',
      payload: {
        title,
        kind: 'manual',
        folderUuid: folderId,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  renameEntity(entityType: ExplorerMutationEntityType, entityId: string, newTitle: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'rename',
      payload: {
        newTitle,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  moveEntity(entityType: Extract<ExplorerMutationEntityType, 'thread' | 'record'>, entityId: string, targetId: string): ExplorerMutationEnvelope | null {
    switch (entityType) {
      case 'thread': {
        const envelope = this.sender.sendCommand({
          entityType,
          entityId,
          operation: 'move',
          payload: {
            targetFolderUuid: targetId,
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
            targetThreadUuid: targetId,
          },
        });
        this.trackPending(envelope);
        return envelope;
      }
    }
  }

  softDelete(entityType: ExplorerMutationEntityType, entityId: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'softDelete',
      payload: {},
    });

    this.trackPending(envelope);
    return envelope;
  }

  restore(entityType: ExplorerMutationEntityType, entityId: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType,
      entityId,
      operation: 'restore',
      payload: {},
    });

    this.trackPending(envelope);
    return envelope;
  }

  createRecord(threadId: string, body: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType: 'record',
      operation: 'create',
      payload: {
        threadUuid: threadId,
        body,
        recordType: 'text',
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  updateRecord(recordId: string, body: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType: 'record',
      entityId: recordId,
      operation: 'update',
      payload: {
        body,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  renameRecord(recordId: string, newTitle: string): ExplorerMutationEnvelope | null {
    const envelope = this.sender.sendCommand({
      entityType: 'record',
      entityId: recordId,
      operation: 'rename',
      payload: {
        newTitle,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  isPending(entityId: string): boolean {
    return this.pending.isPending(entityId);
  }

  isCreatePending(entityType: ExplorerMutationEntityType): boolean {
    return this.pending.isCreatePending(entityType);
  }

  private trackPending(envelope: TransportEnvelope<MutationCommand> | null): void {
    if (envelope === null) {
      return;
    }

    this.pending.setPending(envelope.payload);
  }
}