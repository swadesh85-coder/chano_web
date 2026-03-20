import { Injectable, inject } from '@angular/core';
import { ProjectionStore } from '../app/projection/projection.store';
import type {
  MutationCommand,
  MutationCommandIntent,
  MutationCommandPayload,
  MutationEntityType,
  MutationOperation,
} from './mutation-command';
import type { TransportEnvelope } from './transport-envelope';
import { CommandResultHandler } from './command-result-handler';
import { WebDeviceIdentity } from './web-device-identity';
import { WebRelayClient } from './web-relay-client';

@Injectable({ providedIn: 'root' })
export class MutationCommandSender {
  private readonly relay = inject(WebRelayClient);
  private readonly projection = inject(ProjectionStore);
  private readonly deviceIdentity = inject(WebDeviceIdentity);
  private readonly commandResultHandler = inject(CommandResultHandler);

  sendCommand(command: MutationCommandIntent): TransportEnvelope<MutationCommand> | null {
    void this.commandResultHandler;

    if (!isValidMutationIntent(command)) {
      throw new Error('INVALID_MUTATION_COMMAND_SCHEMA');
    }

    const entityId = command.operation === 'create'
      ? null
      : this.requireExistingEntityId(command.entityId);
    const expectedVersion = this.resolveExpectedVersion(command);
    const mutationCommand: MutationCommand = {
      commandId: globalThis.crypto.randomUUID(),
      originDeviceId: this.deviceIdentity.deviceId,
      entityType: command.entityType,
      entityId,
      operation: command.operation,
      expectedVersion,
      timestamp: Date.now(),
      payload: clonePayload(command.payload),
    };

    console.log(
      `MUTATION_SEND commandId=${mutationCommand.commandId} entity=${mutationCommand.entityType} op=${mutationCommand.operation} entityId=${mutationCommand.entityId}`,
    );

    return this.relay.sendEnvelope<MutationCommand>('mutation_command', mutationCommand);
  }

  private resolveExpectedVersion(command: MutationCommandIntent): number {
    if (command.operation === 'create') {
      return 0;
    }

    const entityId = this.requireExistingEntityId(command.entityId);
    const currentVersion = this.projection.getEntityVersion(command.entityType, entityId);

    if (currentVersion === null) {
      throw new Error('ENTITY_VERSION_UNKNOWN');
    }

    return currentVersion;
  }

  private requireExistingEntityId(entityId: string | null | undefined): string {
    if (typeof entityId !== 'string' || entityId.length === 0) {
      throw new Error('ENTITY_ID_REQUIRED');
    }

    return entityId;
  }
}

function isValidMutationIntent(command: MutationCommandIntent): boolean {
  return isMutationEntityType(command.entityType)
    && isMutationOperation(command.operation)
    && hasValidIntentEntityId(command)
    && isValidMutationPayload(command.entityType, command.operation, command.payload);
}

function hasValidIntentEntityId(command: MutationCommandIntent): boolean {
  if (command.operation === 'create') {
    return command.entityId === undefined || command.entityId === null;
  }

  return typeof command.entityId === 'string' && command.entityId.length > 0;
}

function isValidMutationPayload(
  entityType: MutationEntityType,
  operation: MutationOperation,
  payload: MutationCommandPayload,
): boolean {
  switch (entityType) {
    case 'folder':
    case 'imageGroup':
      return isValidFolderPayload(operation, payload);
    case 'thread':
      return isValidThreadPayload(operation, payload);
    case 'record':
      return isValidRecordPayload(operation, payload);
  }
}

function isValidFolderPayload(operation: MutationOperation, payload: MutationCommandPayload): boolean {
  switch (operation) {
    case 'create':
      return hasExactKeys(payload, ['name', 'parentFolderUuid'])
        && typeof payload['name'] === 'string'
        && isNullableString(payload['parentFolderUuid']);
    case 'update':
      return hasAllowedKeys(payload, ['name', 'parentFolderUuid'])
        && hasAtLeastOneKey(payload, ['name', 'parentFolderUuid'])
        && isOptionalString(payload['name'])
        && isOptionalNullableString(payload['parentFolderUuid']);
    case 'rename':
      return hasExactKeys(payload, ['newTitle']) && typeof payload['newTitle'] === 'string';
    case 'move':
      return false;
    case 'softDelete':
    case 'restore':
      return hasExactKeys(payload, []);
  }
}

function isValidThreadPayload(operation: MutationOperation, payload: MutationCommandPayload): boolean {
  switch (operation) {
    case 'create':
      return hasExactKeys(payload, ['title', 'kind', 'folderId'])
        && typeof payload['title'] === 'string'
        && payload['kind'] === 'manual'
        && typeof payload['folderId'] === 'string';
    case 'update':
      return hasAllowedKeys(payload, ['folderUuid', 'title'])
        && hasAtLeastOneKey(payload, ['folderUuid', 'title'])
        && isOptionalNullableString(payload['folderUuid'])
        && isOptionalString(payload['title']);
    case 'rename':
      return hasExactKeys(payload, ['newTitle']) && typeof payload['newTitle'] === 'string';
    case 'move':
      return hasExactKeys(payload, ['targetFolderId']) && typeof payload['targetFolderId'] === 'string';
    case 'softDelete':
    case 'restore':
      return hasExactKeys(payload, []);
  }
}

function isValidRecordPayload(operation: MutationOperation, payload: MutationCommandPayload): boolean {
  switch (operation) {
    case 'create':
      return hasAllowedKeys(payload, [
        'threadUuid',
        'type',
        'recordType',
        'body',
        'createdAt',
        'editedAt',
        'orderIndex',
        'isStarred',
        'imageGroupId',
      ])
        && hasRequiredKeys(payload, [
          'threadUuid',
          'body',
          'createdAt',
          'editedAt',
          'orderIndex',
          'isStarred',
          'imageGroupId',
        ])
        && typeof payload['threadUuid'] === 'string'
        && isRecordTypePayload(payload)
        && typeof payload['body'] === 'string'
        && typeof payload['createdAt'] === 'number'
        && typeof payload['editedAt'] === 'number'
        && typeof payload['orderIndex'] === 'number'
        && typeof payload['isStarred'] === 'boolean'
        && isNullableString(payload['imageGroupId']);
    case 'update':
      return hasAllowedKeys(payload, [
        'threadUuid',
        'type',
        'recordType',
        'body',
        'createdAt',
        'editedAt',
        'orderIndex',
        'isStarred',
        'imageGroupId',
      ])
        && hasAtLeastOneKey(payload, [
          'threadUuid',
          'type',
          'recordType',
          'body',
          'createdAt',
          'editedAt',
          'orderIndex',
          'isStarred',
          'imageGroupId',
        ])
        && isOptionalString(payload['threadUuid'])
        && isOptionalRecordTypePayload(payload)
        && isOptionalString(payload['body'])
        && isOptionalNumber(payload['createdAt'])
        && isOptionalNumber(payload['editedAt'])
        && isOptionalNumber(payload['orderIndex'])
        && isOptionalBoolean(payload['isStarred'])
        && isOptionalNullableString(payload['imageGroupId']);
    case 'rename':
      return hasExactKeys(payload, ['newTitle']) && typeof payload['newTitle'] === 'string';
    case 'move':
      return hasExactKeys(payload, ['targetThreadId']) && typeof payload['targetThreadId'] === 'string';
    case 'softDelete':
    case 'restore':
      return hasExactKeys(payload, []);
  }
}

function clonePayload(payload: MutationCommandPayload): MutationCommandPayload {
  return JSON.parse(JSON.stringify(payload)) as MutationCommandPayload;
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasAllowedKeys(obj, keys) && hasRequiredKeys(obj, keys);
}

function hasAllowedKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(obj).every((key) => keys.includes(key));
}

function hasRequiredKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in obj);
}

function hasAtLeastOneKey(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => key in obj);
}

function isMutationEntityType(value: string): value is MutationEntityType {
  return ['folder', 'thread', 'record', 'imageGroup'].includes(value);
}

function isMutationOperation(value: string): value is MutationOperation {
  return ['create', 'update', 'rename', 'move', 'softDelete', 'restore'].includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalRecordTypePayload(payload: MutationCommandPayload): boolean {
  const hasType = 'type' in payload;
  const hasRecordType = 'recordType' in payload;

  if (hasType && hasRecordType) {
    return typeof payload['type'] === 'string' && typeof payload['recordType'] === 'string';
  }

  if (hasType) {
    return typeof payload['type'] === 'string';
  }

  if (hasRecordType) {
    return typeof payload['recordType'] === 'string';
  }

  return true;
}

function isRecordTypePayload(payload: MutationCommandPayload): boolean {
  return ('type' in payload && typeof payload['type'] === 'string')
    || ('recordType' in payload && typeof payload['recordType'] === 'string');
}

