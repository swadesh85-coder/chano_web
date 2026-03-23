import { Injectable, computed, inject, signal } from '@angular/core';
import { WebRelayClient } from '../../transport/web-relay-client';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { ProjectionEngine } from './projection_engine';
import type {
  ProjectionSnapshotDocument,
  ProjectionUpdate,
} from './projection.models';
import { validateEventEnvelope, type EventValidationFailureReason } from './projection_event_validation';
import { SnapshotLoader, type SnapshotLoaderEvent } from './snapshot_loader';

export type SnapshotPhase = 'idle' | 'receiving' | 'ready';

@Injectable({ providedIn: 'root' })
export class ProjectionStore {
  private readonly relay = inject(WebRelayClient);
  private readonly snapshotLoader = inject(SnapshotLoader);
  private readonly projectionEngine = new ProjectionEngine({
    emitResyncRequired: (reason, details) => {
      console.error(
        `SNAPSHOT_RESYNC_REQUIRED reason=${reason} expected=${details.expectedEventVersion} received=${details.receivedEventVersion}`,
      );
    },
  });

  private authoritativeEventQueue: Promise<void> = Promise.resolve();
  private snapshotSessionId: string | null = null;
  private readonly _stateRevision = signal(0);
  private readonly _phase = signal<SnapshotPhase>('idle');
  private readonly _baseEventVersion = signal<number | null>(null);
  private readonly _lastAppliedEventVersion = signal<number | null>(null);
  private readonly _lastProjectionUpdate = signal<ProjectionUpdate | null>(null);

  readonly state = computed(() => {
    this._stateRevision();
    return this.projectionEngine.state;
  });
  readonly phase = this._phase.asReadonly();
  readonly baseEventVersion = this._baseEventVersion.asReadonly();
  readonly lastAppliedEventVersion = this._lastAppliedEventVersion.asReadonly();
  readonly lastProjectionUpdate = this._lastProjectionUpdate.asReadonly();

  constructor() {
    this.snapshotLoader.onEvent((event) => this.handleSnapshotLoaderEvent(event));
    this.relay.onProjectionMessage((message) => this.handleEnvelope(message));
  }

  private handleEnvelope(message: TransportEnvelope): void {
    let handled = false;

    if (message.type.startsWith('snapshot_')) {
      handled = true;
      switch (message.type) {
        case 'snapshot_start':
          this.onSnapshotStart(message);
          break;
        case 'snapshot_chunk':
          this.onSnapshotChunk(message);
          break;
        case 'snapshot_complete':
          void this.onSnapshotComplete(message);
          break;
      }

      console.log(
        `HANDLE_MESSAGE type=${message.type} sessionId=${this.formatSessionId(message.sessionId)} handled=true`,
      );
      return;
    }

    if (message.type === 'event_stream') {
      handled = true;
      this.onEventStream(message);
    }

    console.log(
      `HANDLE_MESSAGE type=${message.type} sessionId=${this.formatSessionId(message.sessionId)} handled=${String(handled)}`,
    );

    if (!handled) {
      console.log(
        `UNHANDLED_MESSAGE type=${message.type} sessionId=${this.formatSessionId(message.sessionId)}`,
      );
    }
  }

  private onSnapshotStart(message: TransportEnvelope): void {
    this.snapshotSessionId = message.sessionId;
    this.projectionEngine.onSnapshotStart(this.readSnapshotId(message.payload));
    this.snapshotLoader.handleSnapshotStart(message);
    this._phase.set('receiving');
  }

  private onSnapshotChunk(message: TransportEnvelope): void {
    this.snapshotSessionId = message.sessionId;
    if (this._phase() !== 'receiving') {
      return;
    }

    this.snapshotLoader.handleSnapshotChunk(message);
  }

  private async onSnapshotComplete(message: TransportEnvelope): Promise<void> {
    this.snapshotSessionId = message.sessionId;
    await this.snapshotLoader.handleSnapshotComplete(message);
  }

  private handleSnapshotLoaderEvent(event: SnapshotLoaderEvent): void {
    switch (event.type) {
      case 'SNAPSHOT_ERROR':
        this.projectionEngine.abortSnapshot();
        this._phase.set('idle');
        return;
      case 'SNAPSHOT_LOADED':
        console.log(
          `PROJECTION_BUILD_TRIGGERED type=snapshot_complete sessionId=${this.formatSessionId(this.snapshotSessionId)}`,
        );
        try {
          this.applyLoadedSnapshot(event.parsedSnapshot, event.baseEventVersion, event.entityCount);
        } catch (error: unknown) {
          this.projectionEngine.abortSnapshot();
          this._phase.set('idle');
          console.error(
            `SNAPSHOT_ERROR ${error instanceof Error ? error.message : 'UNKNOWN_SNAPSHOT_REJECTION'}`,
          );
        }
        return;
    }
  }

  private applyLoadedSnapshot(
    snapshot: ProjectionSnapshotDocument,
    baseEventVersion: number,
    entityCount: number,
  ): void {
    const result = this.projectionEngine.applySnapshot(snapshot, baseEventVersion);

    this.publishProjectionState();
    this._lastProjectionUpdate.set({
      reason: 'snapshot_loaded',
      entityType: null,
      eventVersion: result.lastAppliedEventVersion,
    });
    console.log(
      `PROJECTION_APPLY entityCount=${entityCount} type=snapshot_apply sessionId=${this.formatSessionId(this.snapshotSessionId)}`,
    );
    this._baseEventVersion.set(baseEventVersion);
    this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
    this._phase.set('ready');
  }

  private onEventStream(envelope: TransportEnvelope): void {
    this.authoritativeEventQueue = this.authoritativeEventQueue
      .then(async () => this.onValidatedEventStream(envelope))
      .catch((error: unknown) => {
        console.error('EVENT_REJECTED reason=INVALID_SCHEMA');
        this.emitValidationResyncRequired('INVALID_SCHEMA');
        if (error instanceof Error) {
          console.error(error.message);
        }
      });
  }

  private async onValidatedEventStream(envelope: TransportEnvelope): Promise<void> {
    const validationResult = await validateEventEnvelope(envelope);
    if (validationResult.status === 'INVALID') {
      if (validationResult.reason === 'INVALID_SCHEMA') {
        this.reportSchemaValidationError();
      }

      this.emitValidationResyncRequired(validationResult.reason);
      return;
    }

    console.log(`EVENT_FORWARDED_TO_ENGINE eventVersion=${validationResult.eventEnvelope.eventVersion}`);

    const result = this.projectionEngine.onEvent(validationResult.eventEnvelope);

    switch (result.status) {
      case 'EVENT_APPLIED':
        this.publishProjectionState();
        this._lastProjectionUpdate.set({
          reason: 'event_applied',
          entityType: validationResult.eventEnvelope.entityType,
          eventVersion: validationResult.eventEnvelope.eventVersion,
        });
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
      case 'EVENT_IGNORED_DUPLICATE':
      case 'EVENT_BUFFERED':
      case 'EVENT_IGNORED_SNAPSHOT_NOT_APPLIED':
      case 'SNAPSHOT_RESYNC_REQUIRED':
        this._lastAppliedEventVersion.set(result.lastAppliedEventVersion);
        break;
    }
  }

  private readSnapshotId(payload: Record<string, unknown>): string | null {
    return typeof payload['snapshotId'] === 'string' ? payload['snapshotId'] : null;
  }

  private formatSessionId(sessionId: string | null): string {
    return sessionId ?? 'null';
  }

  private emitValidationResyncRequired(reason: EventValidationFailureReason): void {
    console.error(`SNAPSHOT_RESYNC_REQUIRED reason=${reason}`);
  }

  private reportSchemaValidationError(): void {
    console.error('SCHEMA_VALIDATION_ERROR entity field mismatch');
  }

  private publishProjectionState(): void {
    this._stateRevision.update((revision) => revision + 1);
  }
}
