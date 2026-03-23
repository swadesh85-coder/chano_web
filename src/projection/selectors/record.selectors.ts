import type { ProjectionState, RecordEntry } from '../../app/projection/projection.models';
import {
  deriveOrderedImageGroupsFromRecords,
  requireRecordLastEventVersion,
  sortRecordsForExplorer,
} from './explorer.ordering.selectors';

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
  return sortRecordsForExplorer(state.records);
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
    .filter((record) => record.threadId === threadId);
  const orderedRecords = sortRecordsForExplorer(records);

  return {
    recordIds: orderedRecords.map((record) => record.id),
    recordMap: buildRecordMap(orderedRecords),
  };
}

export function selectImageGroupRecords(
  state: ProjectionState,
  imageGroupId: string,
): readonly RecordEntry[] {
  return sortRecordsForExplorer(
    state.records.filter((record) => record.type === 'image' && record.imageGroupId === imageGroupId),
  );
}

export function selectImageGroupsForThread(
  state: ProjectionState,
  threadId: string,
): readonly ProjectionImageGroupView[] {
  return deriveOrderedImageGroupsFromRecords(
    selectRecordsByThread(state, threadId),
  ).map((imageGroup) => ({
    imageGroupId: imageGroup.imageGroupId,
    records: imageGroup.records,
    orderIndex: imageGroup.orderIndex,
    lastEventVersion: imageGroup.lastEventVersion,
  }));
}

export function selectRecordEventVersion(record: RecordEntry): number {
  return requireRecordLastEventVersion(record);
}

function buildRecordMap(records: readonly RecordEntry[]): Readonly<Record<string, RecordEntry>> {
  return Object.fromEntries(records.map((record) => [record.id, record]));
}
