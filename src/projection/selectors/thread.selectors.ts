import type { ProjectionState, Thread } from '../../app/projection/projection.models';
import { selectRecordsByThread, selectRecordsByThreadId, selectRecordEventVersion } from './record.selectors';
import { sortThreadsForExplorer } from './explorer.ordering.selectors';

export type ProjectionThreadSelectorResult = {
  readonly threadIds: readonly string[];
  readonly threadMap: Readonly<Record<string, Thread>>;
};

export function selectThreads(state: ProjectionState): readonly Thread[] {
  return sortThreadsForExplorer(state.threads);
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
  const threads = sortThreadsForExplorer(
    state.threads.filter((thread) => folderId === null ? thread.folderId === 'root' : thread.folderId === folderId),
  );

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

  if (typeof thread.lastEventVersion !== 'number' || Number.isNaN(thread.lastEventVersion)) {
    throw new Error(`Thread ${thread.id} missing authoritative lastEventVersion`);
  }

  return thread.lastEventVersion;
}

function buildThreadMap(threads: readonly Thread[]): Readonly<Record<string, Thread>> {
  return Object.fromEntries(threads.map((thread) => [thread.id, thread]));
}
