import { Injectable, inject, signal } from '@angular/core';
import type {
  CommandResult,
  CommandResultStatus,
  MutationEntityType,
  MutationOperation,
} from './mutation-command';
import type { TransportEnvelope } from './transport-envelope';
import { WebRelayClient } from './web-relay-client';

@Injectable({ providedIn: 'root' })
export class CommandResultHandler {
  private readonly relay = inject(WebRelayClient);
  private readonly _results = signal<Record<string, CommandResult>>({});

  readonly results = this._results.asReadonly();

  constructor() {
    this.relay.onCommandResultMessage((envelope) => this.handleResult(envelope));
  }

  getResult(commandId: string): CommandResult | null {
    return this._results()[commandId] ?? null;
  }

  getStatus(commandId: string): CommandResultStatus | null {
    return this.getResult(commandId)?.status ?? null;
  }

  handleResult(envelope: TransportEnvelope): void {
    if (envelope.type !== 'command_result') {
      return;
    }

    const result = parseCommandResult(envelope.payload);
    if (result === null) {
      console.error('COMMAND_RESULT_REJECTED reason=INVALID_SCHEMA');
      return;
    }

    const previous = this._results()[result.commandId];
    if (previous && areCommandResultsEqual(previous, result)) {
      return;
    }

    this._results.update((current) => ({
      ...current,
      [result.commandId]: result,
    }));
    console.log(`COMMAND_RESULT_RECEIVED commandId=${result.commandId} status=${result.status}`);
  }
}

function parseCommandResult(payload: Record<string, unknown>): CommandResult | null {
  if (!hasOnlyAllowedKeys(payload, [
    'commandId',
    'status',
    'message',
    'entityType',
    'entityId',
    'operation',
    'expectedVersion',
    'eventVersion',
    'entityVersion',
  ])) {
    return null;
  }

  const commandId = payload['commandId'];
  const status = payload['status'];
  const message = payload['message'];
  const entityType = payload['entityType'];
  const entityId = payload['entityId'];
  const operation = payload['operation'];
  const expectedVersion = payload['expectedVersion'];
  const eventVersion = payload['eventVersion'];
  const entityVersion = payload['entityVersion'];

  if (
    typeof commandId !== 'string'
    || commandId.length === 0
    || typeof status !== 'string'
    || !isCommandResultStatus(status)
    || (message !== undefined && typeof message !== 'string')
    || (entityType !== undefined && !isMutationEntityType(entityType))
    || (entityId !== undefined && typeof entityId !== 'string')
    || (operation !== undefined && !isMutationOperation(operation))
    || (expectedVersion !== undefined && !isIntegerNumber(expectedVersion))
    || (eventVersion !== undefined && !isIntegerNumber(eventVersion))
    || (entityVersion !== undefined && !isIntegerNumber(entityVersion))
  ) {
    return null;
  }

  return {
    commandId,
    status,
    ...(message !== undefined ? { message } : {}),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(operation !== undefined ? { operation } : {}),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    ...(eventVersion !== undefined ? { eventVersion } : {}),
    ...(entityVersion !== undefined ? { entityVersion } : {}),
  };
}

function hasOnlyAllowedKeys(obj: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(obj).every((key) => allowedKeys.includes(key));
}

function isCommandResultStatus(value: unknown): value is CommandResultStatus {
  return typeof value === 'string'
    && ['applied', 'rejected', 'conflict', 'alreadyApplied', 'notFound', 'forbidden'].includes(value);
}

function isMutationEntityType(value: unknown): value is MutationEntityType {
  return typeof value === 'string'
    && ['folder', 'thread', 'record', 'imageGroup'].includes(value);
}

function isMutationOperation(value: unknown): value is MutationOperation {
  return typeof value === 'string'
    && ['create', 'update', 'rename', 'move', 'softDelete', 'restore'].includes(value);
}

function isIntegerNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function areCommandResultsEqual(left: CommandResult, right: CommandResult): boolean {
  return left.commandId === right.commandId
    && left.status === right.status
    && left.message === right.message
    && left.entityType === right.entityType
    && left.entityId === right.entityId
    && left.operation === right.operation
    && left.expectedVersion === right.expectedVersion
    && left.eventVersion === right.eventVersion
    && left.entityVersion === right.entityVersion;
}