export interface MutationCommand {
  readonly commandId: string;
  readonly commandType: string;
  readonly entityType: string;
  readonly payload: Record<string, unknown>;
}