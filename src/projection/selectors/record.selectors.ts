import type { EventEntity, ProjectionState, RecordEntry } from '../../app/projection/projection.models';
import { selectFolderById } from './folder.selectors';
import { selectThreadById } from './thread.selectors';

export type ProjectionRecordSelectorResult = {
  readonly recordIds: readonly string[];
  readonly recordMap: Readonly<Record<string, RecordEntry>>;
};

export type ProjectionImageGroupView = {
  readonly imageGroupId: string;
  readonly records: readonly RecordEntry[];
  readonly orderIndex: number | null;
  readonly lastEventVersion: number | null;
};

export function selectRecords(state: ProjectionState): readonly RecordEntry[] {
  return [...state.records].sort(compareRecordsDeterministically);
}

export function selectRecordMap(state: ProjectionState): Readonly<Record<string, RecordEntry>> {
  return buildRecordMap(state.records);
}

export function selectRecordById(state: ProjectionState, recordId: string | null): RecordEntry | null {
  if (recordId === null) {
    return null;
  }

  const record = state.records.find((candidate) => candidate.id === recordId);
  return record ?? null;
}

export function selectRecordsByThread(
  state: ProjectionState,
  threadId: string | null,
): readonly RecordEntry[] {
  const selection = selectRecordsByThreadId(state, threadId);
  return selection.recordIds.map((recordId) => selection.recordMap[recordId]!);
}

export function selectRecordsByThreadId(
  state: ProjectionState,
  threadId: string | null,
): ProjectionRecordSelectorResult {
  if (threadId === null) {
    return {
      recordIds: [],
      recordMap: {},
    };
  }

  const records = state.records
    .filter((record) => record.threadId === threadId)
    .sort(compareRecordsDeterministically);

  return {
    recordIds: records.map((record) => record.id),
    recordMap: buildRecordMap(records),
  };
}

export function selectImageGroupRecords(
  state: ProjectionState,
  imageGroupId: string,
): readonly RecordEntry[] {
  return state.records
    .filter((record) => record.type === 'image' && record.imageGroupId === imageGroupId)
    .sort(compareRecordsDeterministically);
}

export function selectImageGroupsForThread(
  state: ProjectionState,
  threadId: string,
): readonly ProjectionImageGroupView[] {
  const imageRecords = selectRecordsByThread(state, threadId)
    .filter((record) => record.type === 'image' && record.imageGroupId !== null);

  const groupIds = imageRecords.reduce<string[]>((ids, record) => {
    if (record.imageGroupId === null || ids.includes(record.imageGroupId)) {
      return ids;
    }

    return [...ids, record.imageGroupId];
  }, []).sort((left, right) => left.localeCompare(right));

  return groupIds.map((imageGroupId) => {
    const records = imageRecords
      .filter((record) => record.imageGroupId === imageGroupId)
      .sort(compareRecordsDeterministically);
    const leadRecord = records[0] ?? null;

    return {
      imageGroupId,
      records,
      orderIndex: leadRecord?.orderIndex ?? null,
      lastEventVersion: leadRecord === null ? null : selectRecordEventVersion(leadRecord),
    };
  });
}

export function selectRecordEventVersion(record: RecordEntry): number {
  if (record.lastEventVersion == null) {
    throw new Error('Record missing authoritative eventVersion');
  }

  return record.lastEventVersion;
}

export function selectEntityVersion(
  state: ProjectionState,
  entityType: EventEntity,
  entityId: string,
): number | null {
  switch (entityType) {
    case 'folder':
      return selectFolderById(state, entityId)?.entityVersion ?? null;
    case 'thread':
      return selectThreadById(state, entityId)?.entityVersion ?? null;
    case 'record':
      return selectRecordById(state, entityId)?.entityVersion ?? null;
    case 'imageGroup':
      return null;
  }
}

function compareRecordsByEventVersion(left: RecordEntry, right: RecordEntry): number {
  return compareRecordsDeterministically(left, right);
}

function buildRecordMap(records: readonly RecordEntry[]): Readonly<Record<string, RecordEntry>> {
  return Object.fromEntries(records.map((record) => [record.id, record]));
}

function compareRecordsDeterministically(left: RecordEntry, right: RecordEntry): number {
  const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftEventVersion = selectRecordEventVersion(left);
  const rightEventVersion = selectRecordEventVersion(right);
  if (leftEventVersion !== rightEventVersion) {
    return leftEventVersion - rightEventVersion;
  }

  return left.id.localeCompare(right.id);
}

function compareRecordsByImageOrder(left: RecordEntry, right: RecordEntry): number {
  return compareRecordsDeterministically(left, right);
}