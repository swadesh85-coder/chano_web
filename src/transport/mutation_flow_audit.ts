import type { ProjectionState } from '../app/projection/projection.models';
import {
  selectFolderById,
  selectRecordById,
  selectThreadById,
} from '../projection/selectors';
import type { CommandResult, MutationCommand } from './mutation-command';
import type { TransportEnvelope } from './transport-envelope';

export type MutationFlowAuditDependencies = {
  readonly triggerUiAction: () => TransportEnvelope<MutationCommand> | null;
  readonly readProjectionState: () => Readonly<ProjectionState>;
  readonly isPendingCommand: (commandId: string) => boolean;
  readonly getCommandResult: (commandId: string) => CommandResult | null;
  readonly dispatchEnvelope: (envelope: TransportEnvelope) => void | Promise<void>;
  readonly flushAsyncWork?: () => Promise<void>;
};

export type MutationFlowAuditInput = {
  readonly displayCommandId?: string;
  readonly commandResultEnvelope?: TransportEnvelope;
  readonly eventEnvelope: TransportEnvelope;
  readonly duplicateEventEnvelope?: TransportEnvelope;
};

export type MutationFlowAuditResult = {
  readonly sentEnvelope: TransportEnvelope<MutationCommand>;
  readonly sentCommand: MutationCommand;
  readonly commandSendLog: string;
  readonly eventApplyLog: string | null;
  readonly commandResultLog: string | null;
  readonly commandResultStateChange: 'unchanged' | 'changed';
  readonly noOptimisticMutationCheck: {
    readonly stateBeforeEvent: 'unchanged' | 'changed';
    readonly stateAfterEvent: 'updated' | 'unchanged';
  };
  readonly commandCorrelation: {
    readonly commandId: string;
    readonly pendingBeforeEvent: boolean;
    readonly pendingAfterEvent: boolean;
    readonly resolvedByCommandId: boolean;
  };
  readonly projectionEvidence: readonly string[];
  readonly duplicateEventIgnored: boolean;
  readonly finalState: ProjectionState;
};

export async function auditMutationFlow(
  dependencies: MutationFlowAuditDependencies,
  input: MutationFlowAuditInput,
): Promise<MutationFlowAuditResult> {
  const beforeSendState = cloneProjectionState(dependencies.readProjectionState());
  const sentEnvelope = dependencies.triggerUiAction();
  if (sentEnvelope === null) {
    throw new Error('UI_ACTION_DID_NOT_SEND_COMMAND');
  }

  const sentCommand = sentEnvelope.payload;
  const afterSendState = cloneProjectionState(dependencies.readProjectionState());
  const stateBeforeEvent = isSameProjectionState(beforeSendState, afterSendState)
    ? 'unchanged'
    : 'changed';

  let commandResultLog: string | null = null;
  let commandResultStateChange: 'unchanged' | 'changed' = 'unchanged';

  if (input.commandResultEnvelope) {
    const beforeCommandResultState = cloneProjectionState(dependencies.readProjectionState());
    await dependencies.dispatchEnvelope(input.commandResultEnvelope);
    await flushAsyncWork(dependencies);

    const afterCommandResultState = cloneProjectionState(dependencies.readProjectionState());
    commandResultStateChange = isSameProjectionState(beforeCommandResultState, afterCommandResultState)
      ? 'unchanged'
      : 'changed';
    commandResultLog = formatCommandResultLog(input.commandResultEnvelope, input.displayCommandId);
  }

  const pendingBeforeEvent = dependencies.isPendingCommand(sentCommand.commandId);
  const beforeEventState = cloneProjectionState(dependencies.readProjectionState());

  await dependencies.dispatchEnvelope(input.eventEnvelope);
  await flushAsyncWork(dependencies);

  const afterEventState = cloneProjectionState(dependencies.readProjectionState());
  const eventSummary = summarizeEventEnvelope(input.eventEnvelope);
  const stateAfterEvent = isSameProjectionState(beforeEventState, afterEventState)
    ? 'unchanged'
    : 'updated';
  const pendingAfterEvent = dependencies.isPendingCommand(sentCommand.commandId);

  let duplicateEventIgnored = false;
  if (input.duplicateEventEnvelope) {
    const beforeDuplicateState = cloneProjectionState(dependencies.readProjectionState());
    await dependencies.dispatchEnvelope(input.duplicateEventEnvelope);
    await flushAsyncWork(dependencies);

    const afterDuplicateState = cloneProjectionState(dependencies.readProjectionState());
    duplicateEventIgnored = isSameProjectionState(beforeDuplicateState, afterDuplicateState);
  }

  return {
    sentEnvelope,
    sentCommand,
    commandSendLog: `COMMAND_SEND id=${input.displayCommandId ?? sentCommand.commandId} op=${sentCommand.operation} entity=${sentCommand.entityType}`,
    eventApplyLog: stateAfterEvent === 'updated' && eventSummary !== null
      ? `APPLY eventVersion=${eventSummary.eventVersion} entity=${eventSummary.entityType}`
      : null,
    commandResultLog,
    commandResultStateChange,
    noOptimisticMutationCheck: {
      stateBeforeEvent,
      stateAfterEvent,
    },
    commandCorrelation: {
      commandId: sentCommand.commandId,
      pendingBeforeEvent,
      pendingAfterEvent,
      resolvedByCommandId: pendingBeforeEvent
        && !pendingAfterEvent
        && eventCarriesCommandId(input.eventEnvelope, sentCommand.commandId),
    },
    projectionEvidence: collectProjectionEvidence(afterEventState, sentCommand, eventSummary),
    duplicateEventIgnored,
    finalState: afterEventState,
  };
}

function flushAsyncWork(dependencies: MutationFlowAuditDependencies): Promise<void> {
  return dependencies.flushAsyncWork?.() ?? Promise.resolve();
}

function cloneProjectionState(state: ProjectionState): ProjectionState {
  return structuredClone(state);
}

function isSameProjectionState(left: ProjectionState, right: ProjectionState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatCommandResultLog(envelope: TransportEnvelope, displayCommandId?: string): string | null {
  if (envelope.type !== 'command_result') {
    return null;
  }

  const payload = envelope.payload as Record<string, unknown>;
  const commandId = payload['commandId'];
  const status = payload['status'];
  if (typeof commandId !== 'string' || typeof status !== 'string') {
    return null;
  }

  return `COMMAND_RESULT id=${displayCommandId ?? commandId} status=${status}`;
}

function summarizeEventEnvelope(envelope: TransportEnvelope): {
  readonly entityType: MutationCommand['entityType'];
  readonly entityId: string;
  readonly eventVersion: number;
} | null {
  if (envelope.type !== 'event_stream') {
    return null;
  }

  const payload = envelope.payload as Record<string, unknown>;
  const entityType = payload['entityType'];
  const entityId = payload['entityId'];
  const eventVersion = payload['eventVersion'];

  if (
    (entityType !== 'folder' && entityType !== 'thread' && entityType !== 'record' && entityType !== 'imageGroup')
    || typeof entityId !== 'string'
    || typeof eventVersion !== 'number'
  ) {
    return null;
  }

  return {
    entityType,
    entityId,
    eventVersion,
  };
}

function eventCarriesCommandId(envelope: TransportEnvelope, commandId: string): boolean {
  if (envelope.type !== 'event_stream') {
    return false;
  }

  const payload = envelope.payload as Record<string, unknown>;
  const eventPayload = payload['payload'];
  if (eventPayload === null || typeof eventPayload !== 'object' || Array.isArray(eventPayload)) {
    return false;
  }

  return (eventPayload as Record<string, unknown>)['commandId'] === commandId;
}

function collectProjectionEvidence(
  state: ProjectionState,
  command: MutationCommand,
  eventSummary: {
    readonly entityType: MutationCommand['entityType'];
    readonly entityId: string;
    readonly eventVersion: number;
  } | null,
): readonly string[] {
  if (eventSummary === null) {
    return [];
  }

  const entityPresent = hasEntity(state, eventSummary.entityType, eventSummary.entityId);
  const evidence: string[] = [];

  if (command.operation === 'create' && command.entityId === null && entityPresent) {
    evidence.push(`${eventSummary.entityType}:generated-id-present`);
  }

  evidence.push(`${eventSummary.entityType}:${entityPresent ? eventSummary.entityId : 'missing'}`);
  return evidence;
}

function hasEntity(state: ProjectionState, entityType: MutationCommand['entityType'], entityId: string): boolean {
  switch (entityType) {
    case 'folder':
    case 'imageGroup':
      return selectFolderById(state, entityId) !== null;
    case 'thread':
      return selectThreadById(state, entityId) !== null;
    case 'record':
      return selectRecordById(state, entityId) !== null;
  }
}