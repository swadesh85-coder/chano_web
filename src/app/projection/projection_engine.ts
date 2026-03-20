import type {
  EventEntity,
  EventEnvelope,
  ProjectionSnapshotDocument,
  ProjectionState,
} from './projection.models';
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
      readonly status: 'SNAPSHOT_RESYNC_REQUIRED';
      readonly lastAppliedEventVersion: number | null;
      readonly state: ProjectionState;
      readonly reason: ProjectionResyncReason;
      readonly expectedEventVersion: number;
      readonly receivedEventVersion: number;
    };

const EMPTY_PROJECTION_STATE: ProjectionState = {
  folders: [],
  threads: [],
  records: [],
};

export class ProjectionEngine {
  private state: ProjectionState = EMPTY_PROJECTION_STATE;
  private lastAppliedEventVersion: number | null = null;
  private hasSnapshot = false;
  private readonly vaultDomainProjection = new VaultDomainProjection();

  constructor(private readonly options: ProjectionEngineOptions = {}) {}

  reset(): void {
    this.vaultDomainProjection.reset();
    this.state = EMPTY_PROJECTION_STATE;
    this.lastAppliedEventVersion = null;
    this.hasSnapshot = false;
  }

  applySnapshot(snapshotJson: string, baseEventVersion: number): ProjectionEngineResult {
    const snapshot = JSON.parse(snapshotJson) as ProjectionSnapshotDocument;

    this.state = this.vaultDomainProjection.applySnapshot(snapshot);
    this.lastAppliedEventVersion = baseEventVersion;
    this.hasSnapshot = true;

    console.log(`PROJECTION_SNAPSHOT_APPLIED baseEventVersion=${baseEventVersion}`);

    return {
      status: 'SNAPSHOT_APPLIED',
      lastAppliedEventVersion: baseEventVersion,
      state: this.getProjectionState(),
    };
  }

  applyEvent(eventEnvelope: EventEnvelope): ProjectionEngineResult {
    if (!this.hasSnapshot || this.lastAppliedEventVersion === null) {
      return {
        status: 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    if (eventEnvelope.eventVersion <= this.lastAppliedEventVersion) {
      console.log(`EVENT_IGNORED duplicate eventVersion=${eventEnvelope.eventVersion}`);
      return {
        status: 'EVENT_IGNORED_DUPLICATE',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
      };
    }

    const expectedEventVersion = this.lastAppliedEventVersion + 1;
    if (eventEnvelope.eventVersion > expectedEventVersion) {
      this.emitResyncRequired('EVENT_GAP', expectedEventVersion, eventEnvelope.eventVersion);

      return {
        status: 'SNAPSHOT_RESYNC_REQUIRED',
        lastAppliedEventVersion: this.lastAppliedEventVersion,
        state: this.getProjectionState(),
        reason: 'EVENT_GAP',
        expectedEventVersion,
        receivedEventVersion: eventEnvelope.eventVersion,
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

  getEntityVersion(entityType: EventEntity, entityId: string): number | null {
    return this.vaultDomainProjection.getEntityVersion(entityType, entityId);
  }

  hasEntityId(entityId: string): boolean {
    return this.vaultDomainProjection.hasEntityId(entityId);
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