import type { ProjectionState, Thread } from '../../app/projection/projection.models';
import { selectRecordsByThread, selectRecordsByThreadId, selectRecordEventVersion } from './record.selectors';

export type ProjectionThreadSelectorResult = {
  readonly threadIds: readonly string[];
  readonly threadMap: Readonly<Record<string, Thread>>;
};

export function selectThreads(state: ProjectionState): readonly Thread[] {
  return [...state.threads].sort(compareThreadsDeterministically);
}

export function selectThreadMap(state: ProjectionState): Readonly<Record<string, Thread>> {
  return buildThreadMap(state.threads);
}

export function selectThreadById(state: ProjectionState, threadId: string | null): Thread | null {
  if (threadId === null) {
    return null;
  }

  const thread = state.threads.find((candidate) => candidate.id === threadId);
  return thread ?? null;
}

export function selectThreadsByFolder(
  state: ProjectionState,
  folderId: string | null,
): readonly Thread[] {
  const selection = selectThreadsByFolderId(state, folderId);
  return selection.threadIds.map((threadId) => selection.threadMap[threadId]!);
}

export function selectThreadsByFolderId(
  state: ProjectionState,
  folderId: string | null,
): ProjectionThreadSelectorResult {
  const threads = state.threads
    .filter((thread) => folderId === null ? thread.folderId === 'root' : thread.folderId === folderId)
    .sort(compareThreadsDeterministically);

  return {
    threadIds: threads.map((thread) => thread.id),
    threadMap: buildThreadMap(threads),
  };
}

export function selectThreadRecordCount(state: ProjectionState, threadId: string): number {
  return selectRecordsByThreadId(state, threadId).recordIds.length;
}

export function selectThreadLastEventVersion(state: ProjectionState, threadId: string): number | null {
  const thread = selectThreadById(state, threadId);
  if (thread === null) {
    return null;
  }

  let lastEventVersion = thread.entityVersion;
  for (const record of selectRecordsByThread(state, thread.id)) {
    const eventVersion = selectRecordEventVersion(record);
    if (eventVersion > lastEventVersion) {
      lastEventVersion = eventVersion;
    }
  }

  return lastEventVersion;
}

function buildThreadMap(threads: readonly Thread[]): Readonly<Record<string, Thread>> {
  return Object.fromEntries(threads.map((thread) => [thread.id, thread]));
}

function compareThreadsDeterministically(left: Thread, right: Thread): number {
  const leftOrderIndex = readOptionalOrderIndex(left);
  const rightOrderIndex = readOptionalOrderIndex(right);
  if (leftOrderIndex !== rightOrderIndex) {
    return leftOrderIndex - rightOrderIndex;
  }

  if (left.entityVersion !== right.entityVersion) {
    return left.entityVersion - right.entityVersion;
  }

  return left.id.localeCompare(right.id);
}

function readOptionalOrderIndex(thread: Thread): number {
  const orderIndex = (thread as Thread & { readonly orderIndex?: number | null }).orderIndex;
  return typeof orderIndex === 'number' ? orderIndex : Number.MAX_SAFE_INTEGER;
}