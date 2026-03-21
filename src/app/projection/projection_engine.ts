import type {
  EventEntity,
  EventEnvelope,
  ProjectionSnapshotDocument,
  ProjectionState,
} from './projection.models';
import { validateEventSequence, validateStartBoundary } from './projection_event_validation';
import { VaultDomainProjection } from './vault_domain_projection';

export type ProjectionResyncReason = 'EVENT_GAP';

type ProjectionEngineOptions = {
  readonly emitResyncRequired?: (
    reason: ProjectionResyncReason,
    details: { readonly expectedEventVersion: number; readonly receivedEventVersion: number },
  ) => void;
};

export type ProjectionEngineResult =
  | {
      readonly status: 'SNAPSHOT_APPLIED';
      readonly lastAppliedEventVersion: number;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_APPLIED';
      readonly lastAppliedEventVersion: number;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_IGNORED_DUPLICATE';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'EVENT_BUFFERED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
    }
  | {
      readonly status: 'SNAPSHOT_RESYNC_REQUIRED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
      readonly reason: ProjectionResyncReason;
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    };

export type SnapshotCompletionResult = {
  readonly status: 'SNAPSHOT_APPLIED';
  readonly lastAppliedEventVersion: number;
  readonly state: ProjectionState;
  readonly appliedBufferedEventVersions: readonly number[];
};

export type ProjectionEventValidationResult =
  | {
      readonly status: 'APPLY';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'IGNORE_DUPLICATE';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'RESYNC_REQUIRED';
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    }
  | {
      readonly status: 'IGNORE_SNAPSHOT_NOT_APPLIED';
      readonly expectedEventVersion: null;
      readonly receivedEventVersion: number;
    };

export type ProjectionEventSequenceResult = {
  readonly applyLog: readonly string[];
  readonly lastAppliedEventVersion: number | null;
  readonly resyncRequired: boolean;
  readonly state: ProjectionState;
};

const EMPTY_PROJECTION_STATE: ProjectionState = {
  folders: [],
  threads: [],
  records: [],
};

export class ProjectionEngine {
  private state: ProjectionState = EMPTY_PROJECTION_STATE;
  private baseEventVersion: number | null = null;
  private lastAppliedEventVersion: number | null = null;
  private hasSnapshot = false;
  private hasStartedEventStream = false;
  private isSnapshotInProgress = false;
  private resyncRequired = false;
  private bufferedEvents: EventEnvelope[] = [];
  private readonly vaultDomainProjection = new VaultDomainProjection();

  constructor(private readonly options: ProjectionEngineOptions = {}) {}

  reset(): void {
    this.vaultDomainProjection.reset();
    this.state = EMPTY_PROJECTION_STATE;
    this.baseEventVersion = null;
    this.lastAppliedEventVersion = null;
    this.hasSnapshot = false;
    this.hasStartedEventStream = false;
    this.isSnapshotInProgress = false;
    this.resyncRequired = false;
    this.bufferedEvents = [];
  }

  onSnapshotStart(snapshotId: string | null): void {
    this.isSnapshotInProgress = true;
    this.bufferedEvents = [];
    console.log(`SNAPSHOT_START snapshotId=${snapshotId ?? 'unknown'}`);
  }

  abortSnapshot(): void {
    this.isSnapshotInProgress = false;
    this.bufferedEvents = [];
  }

  onSnapshotComplete(snapshotJson: string, baseEventVersion: number): SnapshotCompletionResult {
    console.log('SNAPSHOT_COMPLETE');

    this.applySnapshot(snapshotJson, baseEventVersion);
    const bufferedResult = this.processBufferedEvents(baseEventVersion);
    const lastAppliedEventVersion = this.getLastAppliedEventVersion();

    if (lastAppliedEventVersion === null) {
      throw new Error('SNAPSHOT_COMPLETE_APPLY_FAILED');
    }

    return {
      status: 'SNAPSHOT_APPLIED',
      lastAppliedEventVersion,
      state: bufferedResult.state,
      appliedBufferedEventVersions: bufferedResult.appliedBufferedEventVersions,
    };
  }

  applySnapshot(snapshotJson: string, baseEventVersion: number): ProjectionEngineResult {
    const snapshot = JSON.parse(snapshotJson) as ProjectionSnapshotDocument;
    const entityCount = (snapshot.folders?.length ?? 0)
      + (snapshot.threads?.length ?? 0)
      + (snapshot.records?.length ?? 0);

    this.state = this.vaultDomainProjection.applySnapshot(snapshot);
    this.baseEventVersion = baseEventVersion;
    this.lastAppliedEventVersion = baseEventVersion;
    this.hasSnapshot = true;
    this.hasStartedEventStream = false;
    this.resyncRequired = false;

    console.log(`PROJECTION_SNAPSHOT_APPLIED baseEventVersion=${baseEventVersion}`);
    console.log(`PROJECTION_BUILD_COMPLETE entityCount=${entityCount}`);

    return {
      status: 'SNAPSHOT_APPLIED',
      lastAppliedEventVersion: baseEventVersion,
      state: this.getProjectionState(),
    };
  }

  applyEvent(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    const validationResult = this.validateEvent(eventEnvelope);

    if (validationResult.status === 'IGNORE_SNAPSHOT_NOT_APPLIED') {
      return {
        status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    if (!this.hasStartedEventStream) {
      if (validationResult.status === 'IGNORE_DUPLICATE') {
        console.log(`EVENT_IGNORED duplicate eventVersion=${eventEnvelope.eventVersion}`);
        return {
          status: 'EVENT_IGNORED_DUPLICATE',
          lastAppliedEventVersion: this.lastAppliedEventVersion,
          state: this.getProjectionState(),
        };
      }

      return this.onFirstEventAfterSnapshot(eventEnvelope);
    }

    if (validationResult.status === 'IGNORE_DUPLICATE') {
      console.log(`EVENT_IGNORED duplicate eventVersion=${eventEnvelope.eventVersion}`);
      return {
        status: 'EVENT_IGNORED_DUPLICATE',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    if (validationResult.status === 'RESYNC_REQUIRED') {
      this.resyncRequired = true;
      this.emitResyncRequired(
        'EVENT_GAP',
        validationResult.expectedEventVersion,
        validationResult.receivedEventVersion,
      );

      return {
        status: 'SNAPSHOT_RESYNC_REQUIRED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
        reason: 'EVENT_GAP',
        expectedEventVersion: validationResult.expectedEventVersion,
        receivedEventVersion: validationResult.receivedEventVersion,
      };
    }

    return this.applyValidatedEvent(eventEnvelope);
  }

  private onFirstEventAfterSnapshot(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    if (this.baseEventVersion === null || this.lastAppliedEventVersion === null) {
      return {
        status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    const boundaryValidation = validateStartBoundary(this.baseEventVersion, eventEnvelope);
    if (boundaryValidation.status === 'INVALID') {
      this.resyncRequired = true;
      console.error('RESYNC_TRIGGERED');
      this.emitResyncRequired(
        'EVENT_GAP',
        boundaryValidation.expectedEventVersion,
        boundaryValidation.receivedEventVersion,
      );

      return {
        status: 'SNAPSHOT_RESYNC_REQUIRED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
        reason: 'EVENT_GAP',
        expectedEventVersion: boundaryValidation.expectedEventVersion,
        receivedEventVersion: boundaryValidation.receivedEventVersion,
      };
    }

    this.hasStartedEventStream = true;

    return this.applyValidatedEvent(eventEnvelope);
  }

  validateEvent(eventEnvelope: EventEnvelope): ProjectionEventValidationResult {
    if (!this.hasSnapshot || this.baseEventVersion === null || this.lastAppliedEventVersion === null) {
      return {
        status: 'IGNORE_SNAPSHOT_NOT_APPLIED',
        expectedEventVersion: null,
        receivedEventVersion: eventEnvelope.eventVersion,
      };
    }

    if (this.resyncRequired) {
      return {
        status: 'RESYNC_REQUIRED',
        expectedEventVersion: this.lastAppliedEventVersion + 1,
        receivedEventVersion: eventEnvelope.eventVersion,
      };
    }

    if (!this.hasStartedEventStream) {
      if (eventEnvelope.eventVersion <= this.baseEventVersion) {
        return {
          status: 'IGNORE_DUPLICATE',
          expectedEventVersion: this.baseEventVersion + 1,
          receivedEventVersion: eventEnvelope.eventVersion,
        };
      }

      const boundaryValidation = validateStartBoundary(this.baseEventVersion, eventEnvelope);

      return boundaryValidation.status === 'VALID'
        ? {
            status: 'APPLY',
            expectedEventVersion: boundaryValidation.expectedEventVersion,
            receivedEventVersion: boundaryValidation.receivedEventVersion,
          }
        : {
            status: 'RESYNC_REQUIRED',
            expectedEventVersion: boundaryValidation.expectedEventVersion,
            receivedEventVersion: boundaryValidation.receivedEventVersion,
          };
    }

    return validateEventSequence(this.lastAppliedEventVersion, eventEnvelope);
  }

  applyEventSequence(events: readonly EventEnvelope[]): ProjectionEventSequenceResult {
    const applyLog: string[] = [];

    for (const eventEnvelope of events) {
      const result = this.applyEvent(eventEnvelope);

      switch (result.status) {
        case 'EVENT_APPLIED':
          applyLog.push(`APPLY eventVersion=${eventEnvelope.eventVersion}`);
          break;
        case 'EVENT_IGNORED_DUPLICATE':
          applyLog.push(`IGNORE duplicate eventVersion=${eventEnvelope.eventVersion}`);
          break;
        case 'SNAPSHOT_RESYNC_REQUIRED':
          applyLog.push(`RESYNC_TRIGGER eventVersion=${eventEnvelope.eventVersion}`);
          return {
            applyLog,
            lastAppliedEventVersion: this.lastAppliedEventVersion,
            resyncRequired: this.resyncRequired,
            state: this.getProjectionState(),
          };
        case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
        case 'EVENT_BUFFERED':
        case 'SNAPSHOT_APPLIED':
          break;
      }
    }

    return {
      applyLog,
      lastAppliedEventVersion: this.lastAppliedEventVersion,
      resyncRequired: this.resyncRequired,
      state: this.getProjectionState(),
    };
  }

  private applyValidatedEvent(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    if (this.lastAppliedEventVersion === null) {
      return {
        status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    console.log(
      `EVENT_APPLY eventVersion=${eventEnvelope.eventVersion} lastApplied=${this.lastAppliedEventVersion}`,
    );

    this.state = this.vaultDomainProjection.applyEvent(eventEnvelope);
    this.lastAppliedEventVersion = eventEnvelope.eventVersion;

    return {
      status: 'EVENT_APPLIED',
      lastAppliedEventVersion: eventEnvelope.eventVersion,
      state: this.getProjectionState(),
    };
  }

  onEvent(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    if (this.isSnapshotInProgress) {
      this.bufferedEvents = [...this.bufferedEvents, eventEnvelope];
      console.log(`EVENT_BUFFERED version=${eventEnvelope.eventVersion}`);

      return {
        status: 'EVENT_BUFFERED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    return this.applyEvent(eventEnvelope);
  }

  getProjectionState(): ProjectionState {
    return {
      folders: this.state.folders.map((folder) => ({ ...folder })),
      threads: this.state.threads.map((thread) => ({ ...thread })),
      records: this.state.records.map((record) => ({ ...record })),
    };
  }

  getLastAppliedEventVersion(): number | null {
    return this.lastAppliedEventVersion;
  }

  trackLastAppliedVersion(): number | null {
    return this.lastAppliedEventVersion;
  }

  isResyncRequired(): boolean {
    return this.resyncRequired;
  }

  serializeProjectionState(): string {
    return this.vaultDomainProjection.serializeSnapshotDocument();
  }

  async computeProjectionChecksum(): Promise<string> {
    const encoded = new TextEncoder().encode(this.serializeProjectionState());
    const copy = new Uint8Array(encoded.byteLength);
    copy.set(encoded);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);

    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  getEntityVersion(entityType: EventEntity, entityId: string): number | null {
    return this.vaultDomainProjection.getEntityVersion(entityType, entityId);
  }

  getRecordLastEventVersion(entityId: string): number | null {
    return this.vaultDomainProjection.getRecordLastEventVersion(entityId);
  }

  hasEntityId(entityId: string): boolean {
    return this.vaultDomainProjection.hasEntityId(entityId);
  }

  private processBufferedEvents(baseEventVersion: number): {
    readonly lastAppliedEventVersion: number | null;
    readonly state: ProjectionState;
    readonly appliedBufferedEventVersions: readonly number[];
  } {
    const bufferedEvents = [...this.bufferedEvents].sort(
      (left, right) => left.eventVersion - right.eventVersion,
    );

    this.isSnapshotInProgress = false;
    this.bufferedEvents = [];

    console.log('BUFFER_PROCESS_START');

    const appliedBufferedEventVersions: number[] = [];
    let lastAppliedEventVersion = this.lastAppliedEventVersion;

    for (const eventEnvelope of bufferedEvents) {
      if (eventEnvelope.eventVersion <= baseEventVersion) {
        continue;
      }

      const result = this.applyEvent(eventEnvelope);
      lastAppliedEventVersion = result.lastAppliedEventVersion;

      if (result.status === 'EVENT_APPLIED') {
        appliedBufferedEventVersions.push(eventEnvelope.eventVersion);
      }
    }

    return {
      lastAppliedEventVersion,
      state: this.getProjectionState(),
      appliedBufferedEventVersions,
    };
  }

  private emitResyncRequired(
    reason: ProjectionResyncReason,
    expectedEventVersion: number,
    receivedEventVersion: number,
  ): void {
    console.error(
      `SNAPSHOT_RESYNC_REQUIRED reason=${reason} expected=${expectedEventVersion} received=${receivedEventVersion}`,
    );
    this.options.emitResyncRequired?.(reason, {
      expectedEventVersion,
      receivedEventVersion,
    });
  }
}