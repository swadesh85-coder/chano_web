import { Injectable, inject, signal } from '@angular/core';
import { validateEventEnvelope } from '../projection/projection_event_validation';
import type { MutationCommand, TransportEnvelope } from '../../transport';
import { WebRelayClient } from '../../transport';

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
    this.relay.onEnvelope((envelope) => {
      this.handleCommandResult(envelope);
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
        const folderId = command.payload['folderId'];
        if (typeof title === 'string' && typeof folderId === 'string') {
          return `create:${command.entityType}:${JSON.stringify({ title, folderUuid: folderId })}`;
        }
        return null;
      }
      case 'record': {
        const threadUuid = command.payload['threadUuid'];
        const body = command.payload['body'];
        const createdAt = command.payload['createdAt'];
        const editedAt = command.payload['editedAt'];
        const orderIndex = command.payload['orderIndex'];
        const isStarred = command.payload['isStarred'];
        const imageGroupId = command.payload['imageGroupId'];
        const recordType = typeof command.payload['recordType'] === 'string'
          ? command.payload['recordType']
          : command.payload['type'];

        if (
          typeof threadUuid === 'string'
          && typeof body === 'string'
          && typeof createdAt === 'number'
          && typeof editedAt === 'number'
          && typeof orderIndex === 'number'
          && typeof isStarred === 'boolean'
          && (typeof imageGroupId === 'string' || imageGroupId === null)
          && typeof recordType === 'string'
        ) {
          return `create:${command.entityType}:${JSON.stringify({
            threadUuid,
            body,
            createdAt,
            editedAt,
            orderIndex,
            isStarred,
            imageGroupId,
            type: recordType,
          })}`;
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
        const folderUuid = eventEnvelope.payload['folderUuid'];
        if (typeof title === 'string' && (typeof folderUuid === 'string' || folderUuid === null)) {
          return `create:${eventEnvelope.entityType}:${JSON.stringify({ title, folderUuid })}`;
        }
        return null;
      }
      case 'record': {
        const threadUuid = eventEnvelope.payload['threadUuid'];
        const body = eventEnvelope.payload['body'];
        const createdAt = eventEnvelope.payload['createdAt'];
        const editedAt = eventEnvelope.payload['editedAt'];
        const orderIndex = eventEnvelope.payload['orderIndex'];
        const isStarred = eventEnvelope.payload['isStarred'];
        const imageGroupId = eventEnvelope.payload['imageGroupId'];
        const recordType = typeof eventEnvelope.payload['recordType'] === 'string'
          ? eventEnvelope.payload['recordType']
          : eventEnvelope.payload['type'];

        if (
          typeof threadUuid === 'string'
          && typeof body === 'string'
          && typeof createdAt === 'number'
          && typeof editedAt === 'number'
          && typeof orderIndex === 'number'
          && typeof isStarred === 'boolean'
          && (typeof imageGroupId === 'string' || imageGroupId === null)
          && typeof recordType === 'string'
        ) {
          return `create:${eventEnvelope.entityType}:${JSON.stringify({
            threadUuid,
            body,
            createdAt,
            editedAt,
            orderIndex,
            isStarred,
            imageGroupId,
            type: recordType,
          })}`;
        }

        return null;
      }
    }
  }
}

function omitKey<TValue>(input: Record<string, TValue>, key: string): Record<string, TValue> {
  const { [key]: _removed, ...rest } = input;
  return rest;
}