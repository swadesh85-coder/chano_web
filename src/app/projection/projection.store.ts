import { Injectable, computed, inject, signal } from '@angular/core';
import { WebRelayClient } from '../../transport/web-relay-client';
import type { TransportEnvelope } from '../../transport/transport-envelope';
import { ProjectionEngine } from './projection_engine';
import type {
  ProjectionSnapshotDocument,
  ProjectionUpdate,
} from './projection.models';
import {
  buildSnapshotSchemaBaselines,
  diffSchemaFields,
  extractIncomingEventSchema,
  formatAuditJson,
  type ProjectionAuditEntity,
} from './projection_schema_audit';
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
  private readonly snapshotSchemaBaseline = new Map<ProjectionAuditEntity, readonly string[]>();
  private readonly _stateRevision = signal(0);
  private readonly _phase = signal<SnapshotPhase>('idle');
  private readonly _baseEventVersion = signal<number | null>(null);
  private readonly _lastAppliedEventVersion = signal<number | null>(null);
  private readonly _lastProjectionUpdate = signal<ProjectionUpdate | null>(null);
  private hasRecordedFirstSchemaMismatch = false;

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
    const started = this.snapshotLoader.handleSnapshotStart(message);
    if (!started) {
      this._phase.set('idle');
      this.emitSnapshotResyncRequired('SNAPSHOT_REJECTED', 'invalid snapshot_start payload');
      return;
    }

    this.snapshotSchemaBaseline.clear();
    this.hasRecordedFirstSchemaMismatch = false;
    this.projectionEngine.onSnapshotStart(this.readSnapshotLogId(message.payload));
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
      case 'SNAPSHOT_REJECTED':
        this.projectionEngine.abortSnapshot();
        this._phase.set('idle');
        this.emitSnapshotResyncRequired('SNAPSHOT_REJECTED', event.reason);
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
          const reason = error instanceof Error ? error.message : 'UNKNOWN_SNAPSHOT_REJECTION';
          console.error(`SNAPSHOT_REJECTED reason=${reason}`);
          this.emitSnapshotResyncRequired('SNAPSHOT_REJECTED', reason);
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
    this.captureSnapshotSchemaBaseline(result.state);

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
        this.reportSchemaValidationError(envelope);
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

  private readSnapshotLogId(payload: Record<string, unknown>): string | null {
    const snapshotId = typeof payload['snapshotId'] === 'string' && payload['snapshotId'].length > 0
      ? payload['snapshotId']
      : null;

    if (snapshotId !== null) {
      return snapshotId;
    }

    const checksum = typeof payload['checksum'] === 'string' && payload['checksum'].length > 0
      ? payload['checksum'].toLowerCase()
      : null;
    const baseEventVersion = typeof payload['baseEventVersion'] === 'number' && Number.isInteger(payload['baseEventVersion'])
      ? payload['baseEventVersion']
      : null;
    const totalChunks = typeof payload['totalChunks'] === 'number' && Number.isInteger(payload['totalChunks'])
      ? payload['totalChunks']
      : null;

    if (checksum !== null && baseEventVersion !== null) {
      return `base-${baseEventVersion}-sha-${checksum.slice(0, 12)}`;
    }

    if (baseEventVersion !== null && totalChunks !== null) {
      return `base-${baseEventVersion}-chunks-${totalChunks}`;
    }

    return null;
  }

  private formatSessionId(sessionId: string | null): string {
    return sessionId ?? 'null';
  }

  private emitValidationResyncRequired(reason: EventValidationFailureReason): void {
    console.error(`SNAPSHOT_RESYNC_REQUIRED reason=${reason}`);
  }

  private emitSnapshotResyncRequired(reason: 'SNAPSHOT_REJECTED', detail: string): void {
    console.error(`SNAPSHOT_RESYNC_REQUIRED reason=${reason} detail=${detail}`);
  }

  private captureSnapshotSchemaBaseline(state: ReturnType<ProjectionStore['state']>): void {
    this.snapshotSchemaBaseline.clear();

    for (const baseline of buildSnapshotSchemaBaselines(state)) {
      this.snapshotSchemaBaseline.set(baseline.entity, baseline.fields);
      console.log(formatAuditJson('SNAPSHOT_SCHEMA_BASELINE', baseline));
    }
  }

  private reportSchemaValidationError(envelope: TransportEnvelope): void {
    const incomingSchema = extractIncomingEventSchema(envelope);
    const snapshotFields = incomingSchema.entity === null
      ? []
      : [...(this.snapshotSchemaBaseline.get(incomingSchema.entity) ?? [])];
    const schemaDiff = diffSchemaFields(snapshotFields, incomingSchema.fields);
    const entity = incomingSchema.entity ?? 'unknown';
    const errorPayload = {
      entity,
      missingInEvent: schemaDiff.missingInEvent,
      extraInEvent: schemaDiff.extraInEvent,
      snapshotFields: schemaDiff.snapshotFields,
      eventFields: schemaDiff.eventFields,
      eventId: incomingSchema.eventId,
      sequence: incomingSchema.sequence,
    };

    console.error(formatAuditJson('SCHEMA_VALIDATION_ERROR', errorPayload));

    if (
      !this.hasRecordedFirstSchemaMismatch
      && incomingSchema.entity !== null
      && (schemaDiff.missingInEvent.length > 0 || schemaDiff.extraInEvent.length > 0)
    ) {
      this.hasRecordedFirstSchemaMismatch = true;
      console.error(formatAuditJson('SCHEMA_AUDIT_RESULT', {
        entity: incomingSchema.entity,
        snapshotFields: schemaDiff.snapshotFields,
        eventFields: schemaDiff.eventFields,
        missingInEvent: schemaDiff.missingInEvent,
        extraInEvent: schemaDiff.extraInEvent,
        verdict: 'SCHEMA_MISMATCH_CONFIRMED',
      }));
    }
  }

  private publishProjectionState(): void {
    this._stateRevision.update((revision) => revision + 1);
  }
}
