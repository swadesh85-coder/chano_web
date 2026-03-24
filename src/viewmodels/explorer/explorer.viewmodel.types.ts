export interface FolderTreeViewModel {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly children: readonly FolderTreeViewModel[];
}

export interface ThreadListItemSelectorView {
  readonly entityId: string;
  readonly title: string;
  readonly folderId: string;
  readonly lastEventVersion: number;
  readonly recordCount: number;
}

export interface ThreadListViewModel {
  readonly id: string;
  readonly title: string;
  readonly folderId: string;
  readonly lastEventVersion: number;
  readonly recordCount: number;
}

export interface RecordListViewModel {
  readonly id: string;
  readonly threadId: string;
  readonly type: string;
  readonly content: unknown;
  readonly title: string | null;
  readonly displayLabel: string;
  readonly isAiGenerated: boolean;
  readonly eventVersion: number;
  readonly imageGroupId: string | null;
  readonly mediaId: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
}

export type RecordViewModel = RecordListViewModel;

export type ContentPaneViewModel =
  | {
      readonly mode: 'empty';
      readonly threadList: readonly ThreadListViewModel[];
      readonly recordList: readonly RecordListViewModel[];
      readonly recordNodes: readonly ThreadRecordNodeViewModel[];
    }
  | {
      readonly mode: 'threads';
      readonly threadList: readonly ThreadListViewModel[];
      readonly recordList: readonly RecordListViewModel[];
      readonly recordNodes: readonly ThreadRecordNodeViewModel[];
    }
  | {
      readonly mode: 'records';
      readonly threadList: readonly ThreadListViewModel[];
      readonly recordList: readonly RecordListViewModel[];
      readonly recordNodes: readonly ThreadRecordNodeViewModel[];
    };

export interface MediaViewerViewModel {
  readonly type: 'image' | 'file' | 'audio';
  readonly recordId: string;
  readonly title: string;
  readonly mediaId: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly imageGroupId: string | null;
  readonly groupRecordIds: readonly string[];
  readonly currentIndex: number;
}

export type ThreadRecordNodeViewModel =
  | {
      readonly kind: 'record';
      readonly key: string;
      readonly record: RecordViewModel;
    }
  | {
      readonly kind: 'imageGroup';
      readonly key: string;
      readonly imageGroupId: string;
      readonly leadRecordId: string | null;
      readonly recordIdsSummary: string;
      readonly records: readonly RecordViewModel[];
    };