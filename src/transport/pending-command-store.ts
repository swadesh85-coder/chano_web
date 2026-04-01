import { Injectable, inject, signal } from '@angular/core';
import { validateEventEnvelope } from '../app/projection/projection_event_validation';
import type { MutationCommand, TransportEnvelope } from './index';
import { WebRelayClient } from './web-relay-client';

type PendingEntry = {
  readonly commandId: string;
  readonly entityId: string | null;
  readonly entityType: MutationCommand['entityType'];
  readonly operation: MutationCommand['operation'];
  readonly createFingerprint: string | null;
  readonly status: 'pending' | 'acknowledged';
};

@Injectable({ providedIn: 'root' })
export class PendingCommandStore {
  private readonly relay = inject(WebRelayClient);

  private readonly _pendingByCommandId = signal<Record<string, PendingEntry>>({});
  private readonly _pendingEntityIds = signal<Record<string, string>>({});
  private readonly _pendingCreateFingerprints = signal<Record<string, string>>({});

  readonly pendingByCommandId = this._pendingByCommandId.asReadonly();

  constructor() {
    this.relay.onCommandResultMessage((envelope) => {
      this.handleCommandResult(envelope);
    });
    this.relay.onProjectionMessage((envelope) => {
      void this.handleEventStream(envelope);
    });
  }

  setPending(command: MutationCommand): void {
    const entry: PendingEntry = {
      commandId: command.commandId,
      entityId: command.entityId,
      entityType: command.entityType,
      operation: command.operation,
      createFingerprint: this.buildCreateFingerprintFromCommand(command),
      status: 'pending',
    };

    const existing = this._pendingByCommandId()[command.commandId];
    if (existing) {
      return;
    }

    this._pendingByCommandId.update((current) => ({
      ...current,
      [command.commandId]: entry,
    }));
    if (command.entityId !== null) {
      const entityId = command.entityId;
      this._pendingEntityIds.update((current) => ({
        ...current,
        [entityId]: command.commandId,
      }));
    }

    if (entry.createFingerprint !== null) {
      const createFingerprint = entry.createFingerprint;
      this._pendingCreateFingerprints.update((current) => ({
        ...current,
        [createFingerprint]: command.commandId,
      }));
    }

    console.log(`PENDING_SET commandId=${command.commandId} entityId=${command.entityId}`);
  }

  clearPending(commandId: string): void {
    const entry = this._pendingByCommandId()[commandId];
    if (!entry) {
      return;
    }

    this._pendingByCommandId.update((current) => omitKey(current, commandId));
    if (entry.entityId !== null) {
      const entityId = entry.entityId;
      this._pendingEntityIds.update((current) => omitKey(current, entityId));
    }

    if (entry.createFingerprint !== null) {
      const createFingerprint = entry.createFingerprint;
      this._pendingCreateFingerprints.update((current) => omitKey(current, createFingerprint));
    }

    console.log(`PENDING_CLEAR commandId=${commandId} entityId=${entry.entityId}`);
  }

  isPending(entityId: string): boolean {
    return entityId in this._pendingEntityIds();
  }

  isCreatePending(entityType: MutationCommand['entityType']): boolean {
    return Object.keys(this._pendingCreateFingerprints()).some((fingerprint) => fingerprint.startsWith(`create:${entityType}:`));
  }

  private handleCommandResult(envelope: TransportEnvelope): void {
    if (envelope.type !== 'command_result') {
      return;
    }

    const payload = envelope.payload;
    const commandId = payload['commandId'];
    const status = payload['status'];
    if (typeof commandId !== 'string' || typeof status !== 'string') {
      return;
    }

    const entry = this._pendingByCommandId()[commandId];
    if (!entry) {
      return;
    }

    if (status === 'rejected' || status === 'conflict' || status === 'notFound' || status === 'forbidden') {
      this.clearPending(commandId);
      return;
    }

    if (entry.status === 'acknowledged') {
      return;
    }

    this._pendingByCommandId.update((current) => ({
      ...current,
      [commandId]: {
        ...entry,
        status: 'acknowledged',
      },
    }));
  }

  private async handleEventStream(envelope: TransportEnvelope): Promise<void> {
    if (envelope.type !== 'event_stream') {
      return;
    }

    const validationResult = await validateEventEnvelope(envelope);
    if (validationResult.status !== 'VALID') {
      return;
    }

    const commandId = this.resolvePendingCommandId(validationResult);
    if (!commandId) {
      return;
    }

    this.clearPending(commandId);
  }

  private resolvePendingCommandId(validationResult: Extract<Awaited<ReturnType<typeof validateEventEnvelope>>, { status: 'VALID' }>): string | null {
    const preferredCommandId = validationResult.correlationCommandId;
    if (preferredCommandId !== null && this._pendingByCommandId()[preferredCommandId]) {
      return preferredCommandId;
    }

    if (validationResult.eventEnvelope.operation !== 'create') {
      return this._pendingEntityIds()[validationResult.eventEnvelope.entityId] ?? null;
    }

    const createFingerprint = this.buildCreateFingerprintFromEvent(validationResult.eventEnvelope);
    if (createFingerprint === null) {
      return null;
    }

    return this._pendingCreateFingerprints()[createFingerprint] ?? null;
  }

  private buildCreateFingerprintFromCommand(command: MutationCommand): string | null {
    if (command.operation !== 'create') {
      return null;
    }

    switch (command.entityType) {
      case 'folder':
      case 'imageGroup': {
        const name = command.payload['name'];
        const parentFolderUuid = command.payload['parentFolderUuid'];
        if (typeof name === 'string' && (typeof parentFolderUuid === 'string' || parentFolderUuid === null)) {
          return `create:${command.entityType}:${JSON.stringify({ name, parentFolderUuid })}`;
        }
        return null;
      }
      case 'thread': {
        const title = command.payload['title'];
        const folderId = resolveThreadFolderId(command.payload);
        if (typeof title === 'string' && typeof folderId === 'string') {
          return `create:${command.entityType}:${JSON.stringify({ title, folderId })}`;
        }
        return null;
      }
      case 'record': {
        const threadId = resolveRecordThreadId(command.payload);
        const name = resolveRecordName(command.payload);
        const recordType = resolveRecordType(command.payload);

        if (typeof threadId === 'string' && typeof name === 'string' && typeof recordType === 'string') {
          return `create:${command.entityType}:${JSON.stringify({ threadId, name, type: recordType })}`;
        }

        return null;
      }
    }
  }

  private buildCreateFingerprintFromEvent(eventEnvelope: Awaited<ReturnType<typeof validateEventEnvelope>> extends infer TResult
    ? TResult extends { status: 'VALID'; eventEnvelope: infer TEventEnvelope } ? TEventEnvelope : never
    : never): string | null {
    if (eventEnvelope.operation !== 'create') {
      return null;
    }

    switch (eventEnvelope.entityType) {
      case 'folder':
      case 'imageGroup': {
        const name = eventEnvelope.payload['name'];
        const parentFolderUuid = eventEnvelope.payload['parentFolderUuid'];
        if (typeof name === 'string' && (typeof parentFolderUuid === 'string' || parentFolderUuid === null)) {
          return `create:${eventEnvelope.entityType}:${JSON.stringify({ name, parentFolderUuid })}`;
        }
        return null;
      }
      case 'thread': {
        const title = eventEnvelope.payload['title'];
        const folderId = resolveThreadFolderId(eventEnvelope.payload);
        if (typeof title === 'string' && (typeof folderId === 'string' || folderId === null)) {
          return `create:${eventEnvelope.entityType}:${JSON.stringify({ title, folderId })}`;
        }
        return null;
      }
      case 'record': {
        const threadId = resolveRecordThreadId(eventEnvelope.payload);
        const name = resolveRecordName(eventEnvelope.payload);
        const recordType = resolveRecordType(eventEnvelope.payload);

        if (typeof threadId === 'string' && typeof name === 'string' && typeof recordType === 'string') {
          return `create:${eventEnvelope.entityType}:${JSON.stringify({ threadId, name, type: recordType })}`;
        }

        return null;
      }
    }
  }
}

function resolveThreadFolderId(payload: Record<string, unknown>): string | null {
  if (typeof payload['folderId'] === 'string') {
    return payload['folderId'];
  }

  return typeof payload['folderUuid'] === 'string' ? payload['folderUuid'] : null;
}

function resolveRecordThreadId(payload: Record<string, unknown>): string | null {
  if (typeof payload['threadId'] === 'string') {
    return payload['threadId'];
  }

  return typeof payload['threadUuid'] === 'string' ? payload['threadUuid'] : null;
}

function resolveRecordName(payload: Record<string, unknown>): string | null {
  if (typeof payload['name'] === 'string') {
    return payload['name'];
  }

  return typeof payload['body'] === 'string' ? payload['body'] : null;
}

function resolveRecordType(payload: Record<string, unknown>): string | null {
  if (typeof payload['recordType'] === 'string') {
    return payload['recordType'];
  }

  return typeof payload['type'] === 'string' ? payload['type'] : null;
}

function omitKey<TValue>(input: Record<string, TValue>, key: string): Record<string, TValue> {
  const { [key]: _removed, ...rest } = input;
  return rest;
}