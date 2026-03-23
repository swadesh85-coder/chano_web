import type {
  ProjectionState,
  RecordEntry,
} from '../../app/projection/projection.models';
import {
  selectImageGroupsForThread,
  selectImageGroupRecords,
  selectRecordById,
  selectRecordEventVersion,
  selectRecordsByThread,
  selectRecordsByThreadId,
} from '../../projection/selectors';
import type {
  MediaViewerViewModel,
  RecordListViewModel,
  RecordViewModel,
  ThreadRecordNodeViewModel,
} from './explorer.viewmodel.types';

export function selectRecordListViewModel(
  state: ProjectionState,
  threadId: string | null,
): readonly RecordListViewModel[] {
  const selection = selectRecordsByThreadId(state, threadId);
  return buildRecordListViewModel(selection.recordIds.map((recordId) => selection.recordMap[recordId]!));
}

export function buildRecordListViewModel(records: readonly RecordEntry[]): readonly RecordListViewModel[] {
  return records.map((record) => buildRecordViewModel(record));
}

export function buildRecordViewModel(record: RecordEntry): RecordListViewModel {
  const title = record.title ?? null;
  const content = record.name;
  const eventVersion = selectRecordEventVersion(record);

  return {
    id: record.id,
    threadId: record.threadId,
    type: record.type,
    content,
    title,
    displayLabel: title ?? (content || record.type),
    isAiGenerated: false,
    eventVersion,
    imageGroupId: record.imageGroupId,
    mediaId: typeof record.mediaId === 'string' ? record.mediaId : null,
    mimeType: typeof record.mimeType === 'string' ? record.mimeType : null,
    size: record.size ?? null,
  };
}

export function selectRecordViewModel(
  state: ProjectionState,
  recordId: string | null,
): RecordListViewModel | null {
  const record = selectRecordById(state, recordId);
  return record === null ? null : buildRecordViewModel(record);
}

export function selectThreadRecordNodeViewModel(
  state: ProjectionState,
  threadId: string | null,
): readonly ThreadRecordNodeViewModel[] {
  if (threadId === null) {
    return [];
  }

  const records = selectRecordsByThread(state, threadId);
  const imageGroups = selectImageGroupsForThread(state, threadId);
  const groupedRecordIds = new Set(
    imageGroups.flatMap((imageGroup) => imageGroup.records.map((record) => record.id)),
  );

  const groupNodes = imageGroups.map((imageGroup) => buildImageGroupNode(imageGroup.imageGroupId, imageGroup.records));
  const recordNodes = records
    .filter((record) => !groupedRecordIds.has(record.id))
    .map((record) => ({
      kind: 'record' as const,
      key: `record:${record.id}`,
      record: buildRecordViewModel(record),
    }));

  return [...groupNodes, ...recordNodes].sort(compareThreadRecordNodeViewModel);
}

export function selectMediaViewerViewModel(
  state: ProjectionState,
  recordId: string | null,
): MediaViewerViewModel | null {
  const record = selectRecordById(state, recordId);
  if (record === null || !isSupportedMediaType(record.type)) {
    return null;
  }

  const groupRecords = record.imageGroupId === null
    ? [record]
    : selectImageGroupRecords(state, record.imageGroupId).filter((entry) => entry.threadId === record.threadId);
  const orderedRecords = groupRecords.length === 0 ? [record] : groupRecords;

  return {
    type: record.type,
    recordId: record.id,
    title: record.title ?? (record.name || record.id),
    mediaId: typeof record.mediaId === 'string' ? record.mediaId : null,
    mimeType: typeof record.mimeType === 'string' ? record.mimeType : null,
    size: record.size ?? null,
    imageGroupId: record.type === 'image' ? record.imageGroupId : null,
    groupRecordIds: record.type === 'image'
      ? orderedRecords.map((groupRecord) => groupRecord.id)
      : [record.id],
    currentIndex: record.type === 'image'
      ? Math.max(0, orderedRecords.findIndex((groupRecord) => groupRecord.id === record.id))
      : 0,
  };
}

export function selectMediaRecordViewModel(
  state: ProjectionState,
  threadId: string | null,
  recordId: string | null,
): RecordViewModel | null {
  if (threadId === null || recordId === null) {
    return null;
  }

  return findRecordViewModel(selectThreadRecordNodeViewModel(state, threadId), recordId);
}

function buildImageGroupNode(
  imageGroupId: string,
  records: readonly RecordEntry[],
): Extract<ThreadRecordNodeViewModel, { readonly kind: 'imageGroup' }> {
  const recordViewModels = records.map((record) => buildRecordViewModel(record));

  return {
    kind: 'imageGroup',
    key: `imageGroup:${imageGroupId}`,
    imageGroupId,
    records: recordViewModels,
    leadRecordId: recordViewModels[0]?.id ?? null,
    recordIdsSummary: `[${recordViewModels.map((record) => record.id).join(', ')}]`,
  };
}

function compareThreadRecordNodeViewModel(
  left: ThreadRecordNodeViewModel,
  right: ThreadRecordNodeViewModel,
): number {
  const leftEventVersion = getThreadRecordNodeEventVersion(left);
  const rightEventVersion = getThreadRecordNodeEventVersion(right);

  if (leftEventVersion !== rightEventVersion) {
    return leftEventVersion - rightEventVersion;
  }

  return left.key.localeCompare(right.key);
}

function getThreadRecordNodeEventVersion(node: ThreadRecordNodeViewModel): number {
  if (node.kind === 'record') {
    return node.record.eventVersion;
  }

  const leadRecord = node.records[0];
  if (leadRecord === undefined) {
    throw new Error('Image group missing authoritative eventVersion');
  }

  return leadRecord.eventVersion;
}

function findRecordViewModel(
  nodes: readonly ThreadRecordNodeViewModel[],
  recordId: string,
): RecordViewModel | null {
  for (const node of nodes) {
    if (node.kind === 'record' && node.record.id === recordId) {
      return node.record;
    }

    if (node.kind === 'imageGroup') {
      const match = node.records.find((record) => record.id === recordId) ?? null;
      if (match !== null) {
        return match;
      }
    }
  }

  return null;
}

function isSupportedMediaType(type: string): type is MediaViewerViewModel['type'] {
  return type === 'image' || type === 'file' || type === 'audio';
}