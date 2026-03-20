import { Injectable, inject, signal } from '@angular/core';
import type { CommandResult, CommandResultStatus } from './mutation-command';
import type { TransportEnvelope } from './transport-envelope';
import { WebRelayClient } from './web-relay-client';

@Injectable({ providedIn: 'root' })
export class CommandResultHandler {
  private readonly relay = inject(WebRelayClient);
  private readonly _results = signal<Record<string, CommandResult>>({});

  readonly results = this._results.asReadonly();

  constructor() {
    this.relay.onEnvelope((envelope) => this.handleResult(envelope));
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
    if (previous && previous.status === result.status && previous.message === result.message) {
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
  if (!hasExactKeys(payload, ['commandId', 'status', 'message'])) {
    return null;
  }

  const commandId = payload['commandId'];
  const status = payload['status'];
  const message = payload['message'];

  if (
    typeof commandId !== 'string'
    || commandId.length === 0
    || typeof status !== 'string'
    || !isCommandResultStatus(status)
    || typeof message !== 'string'
  ) {
    return null;
  }

  return {
    commandId,
    status,
    message,
  };
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(obj).length === keys.length && keys.every((key) => key in obj);
}

function isCommandResultStatus(value: string): value is CommandResultStatus {
  return ['applied', 'rejected', 'conflict', 'alreadyApplied', 'notFound', 'forbidden'].includes(value);
}