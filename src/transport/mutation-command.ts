export type MutationEntityType = 'folder' | 'thread' | 'record' | 'imageGroup';

export type MutationOperation = 'create' | 'update' | 'rename' | 'move' | 'softDelete' | 'restore';

export type MutationCommandPayload = Record<string, unknown>;

export interface MutationCommand {
  readonly commandId: string;
  readonly originDeviceId: string;
  readonly entityType: MutationEntityType;
  readonly entityId: string | null;
  readonly operation: MutationOperation;
  readonly expectedVersion: number;
  readonly timestamp: number;
  readonly payload: MutationCommandPayload;
}

export interface MutationCommandIntent {
  readonly entityType: MutationEntityType;
  readonly entityId?: string | null;
  readonly operation: MutationOperation;
  readonly payload: MutationCommandPayload;
}

export type CommandResultStatus = 'applied' | 'rejected' | 'conflict' | 'alreadyApplied' | 'notFound' | 'forbidden';

export interface CommandResult {
  readonly commandId: string;
  readonly status: CommandResultStatus;
  readonly message?: string;
  readonly entityType?: MutationEntityType;
  readonly entityId?: string;
  readonly operation?: MutationOperation;
  readonly expectedVersion?: number;
  readonly eventVersion?: number;
  readonly entityVersion?: number;
}