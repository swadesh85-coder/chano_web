import { Injectable, inject } from '@angular/core';
import {
  MutationCommandSender,
  type MutationCommand,
  type TransportEnvelope,
} from '../../transport';
import { PendingCommandStore } from './pending_command_store';

@Injectable({ providedIn: 'root' })
export class RecordEditor {
  private readonly sender = inject(MutationCommandSender);
  private readonly pending = inject(PendingCommandStore);

  createRecord(threadId: string, body: string): TransportEnvelope<MutationCommand> | null {
    const normalizedBody = normalizeRequiredText(body, 'INVALID_RECORD_BODY');

    if (this.pending.isCreatePending('record')) {
      return null;
    }

    console.log(`UI_ACTION create_record thread=${threadId}`);

    const envelope = this.sender.sendCommand({
      entityType: 'record',
      operation: 'create',
      payload: {
        threadId,
        body: normalizedBody,
        recordType: 'text',
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  updateRecord(recordId: string, body: string): TransportEnvelope<MutationCommand> | null {
    const normalizedBody = normalizeRequiredText(body, 'INVALID_RECORD_BODY');

    if (this.pending.isPending(recordId)) {
      return null;
    }

    console.log(`UI_ACTION update_record id=${recordId}`);

    const envelope = this.sender.sendCommand({
      entityType: 'record',
      entityId: recordId,
      operation: 'update',
      payload: {
        body: normalizedBody,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  renameRecord(recordId: string, newTitle: string): TransportEnvelope<MutationCommand> | null {
    const normalizedTitle = normalizeRequiredText(newTitle, 'INVALID_RECORD_TITLE');

    if (this.pending.isPending(recordId)) {
      return null;
    }

    console.log(`UI_ACTION rename_record id=${recordId}`);

    const envelope = this.sender.sendCommand({
      entityType: 'record',
      entityId: recordId,
      operation: 'rename',
      payload: {
        newTitle: normalizedTitle,
      },
    });

    this.trackPending(envelope);
    return envelope;
  }

  isPending(recordId: string): boolean {
    return this.pending.isPending(recordId);
  }

  isCreatePending(): boolean {
    return this.pending.isCreatePending('record');
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