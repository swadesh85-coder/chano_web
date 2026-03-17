import { Injectable } from '@angular/core';
import type { TransportEnvelope } from '../../transport/transport-envelope';

type SnapshotLoaderEventHandler = (event: SnapshotLoaderEvent) => void;

type SnapshotAssembly = {
  readonly snapshotId: string;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly snapshotVersion: number;
  readonly protocolVersion: number;
  readonly schemaVersion: number;
  readonly baseEventVersion: number;
  readonly entityCount: number;
  readonly checksum: string;
  readonly chunkBytes: Uint8Array[];
  readonly nextChunkIndex: number;
  readonly receivedBytes: number;
};

type SnapshotStartPayload = {
  readonly snapshotId: string;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly snapshotVersion: number;
  readonly protocolVersion: number;
  readonly schemaVersion: number;
  readonly baseEventVersion: number;
  readonly entityCount: number;
  readonly checksum: string;
};

type SnapshotChunkPayload = {
  readonly index: number;
  readonly data: string;
  readonly checksum?: string;
};

type SnapshotCompletePayload = {
  readonly totalChunks: number;
};

export type SnapshotLoaderEvent =
  | {
      readonly type: 'SNAPSHOT_LOADED';
      readonly snapshotJson: string;
      readonly baseEventVersion: number;
    }
  | {
      readonly type: 'SNAPSHOT_ERROR';
      readonly reason: string;
    };

@Injectable({ providedIn: 'root' })
export class SnapshotLoader {
  private readonly eventHandlers = new Set<SnapshotLoaderEventHandler>();
  private assembly: SnapshotAssembly | null = null;

  onEvent(handler: SnapshotLoaderEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  handleSnapshotStart(envelope: TransportEnvelope): void {
    const payload = this.parseSnapshotStartPayload(envelope.payload);

    if (payload === null) {
      this.fail('invalid snapshot_start payload');
      return;
    }

    this.assembly = {
      snapshotId: payload.snapshotId,
      totalChunks: payload.totalChunks,
      totalBytes: payload.totalBytes,
      snapshotVersion: payload.snapshotVersion,
      protocolVersion: payload.protocolVersion,
      schemaVersion: payload.schemaVersion,
      baseEventVersion: payload.baseEventVersion,
      entityCount: payload.entityCount,
      checksum: payload.checksum.toLowerCase(),
      chunkBytes: [],
      nextChunkIndex: 0,
      receivedBytes: 0,
    };

    console.log(
      `SNAPSHOT_START snapshotId=${payload.snapshotId} totalChunks=${payload.totalChunks}`,
    );
  }

  handleSnapshotChunk(envelope: TransportEnvelope): void {
    if (this.assembly === null) {
      this.fail('snapshot_chunk received without active snapshot');
      return;
    }

    const payload = this.parseSnapshotChunkPayload(envelope.payload);
    if (payload === null) {
      this.fail('invalid snapshot_chunk payload');
      return;
    }

    if (payload.index !== this.assembly.nextChunkIndex) {
      this.fail(
        `invalid chunk order expected=${this.assembly.nextChunkIndex} actual=${payload.index}`,
      );
      return;
    }

    const chunkBytes = this.decodeBase64(payload.data);
    if (chunkBytes === null) {
      this.fail(`invalid base64 chunk index=${payload.index}`);
      return;
    }

    const receivedBytes = this.assembly.receivedBytes + chunkBytes.byteLength;
    if (receivedBytes > this.assembly.totalBytes) {
      this.fail(`snapshot byte overflow received=${receivedBytes}`);
      return;
    }

    this.assembly = {
      ...this.assembly,
      chunkBytes: [...this.assembly.chunkBytes, chunkBytes],
      nextChunkIndex: this.assembly.nextChunkIndex + 1,
      receivedBytes,
    };

    console.log(`SNAPSHOT_CHUNK_RECEIVED index=${payload.index}`);
  }

  async handleSnapshotComplete(envelope: TransportEnvelope): Promise<void> {
    if (this.assembly === null) {
      this.fail('snapshot_complete received without active snapshot');
      return;
    }

    const payload = this.parseSnapshotCompletePayload(envelope.payload);
    if (payload === null) {
      this.fail('invalid snapshot_complete payload');
      return;
    }

    if (payload.totalChunks !== this.assembly.totalChunks) {
      this.fail(
        `snapshot_complete chunk mismatch expected=${this.assembly.totalChunks} actual=${payload.totalChunks}`,
      );
      return;
    }

    if (this.assembly.chunkBytes.length !== this.assembly.totalChunks) {
      this.fail(
        `missing chunks expected=${this.assembly.totalChunks} actual=${this.assembly.chunkBytes.length}`,
      );
      return;
    }

    const snapshotBytes = this.concatBytes(this.assembly.chunkBytes);
    if (snapshotBytes.byteLength !== this.assembly.totalBytes) {
      this.fail(
        `snapshot byte mismatch expected=${this.assembly.totalBytes} actual=${snapshotBytes.byteLength}`,
      );
      return;
    }

    console.log(`SNAPSHOT_COMPLETE reconstructedBytes=${snapshotBytes.byteLength}`);

    const snapshotJson = this.decodeUtf8(snapshotBytes);
    if (snapshotJson === null) {
      this.fail('invalid utf8 snapshot payload');
      return;
    }

    try {
      JSON.parse(snapshotJson);
    } catch {
      this.fail('invalid snapshot json');
      return;
    }

    const checksum = await this.sha256Hex(snapshotBytes);
    if (checksum !== this.assembly.checksum) {
      this.fail('checksum mismatch');
      return;
    }

    const baseEventVersion = this.assembly.baseEventVersion;
    this.assembly = null;

    console.log('SNAPSHOT_CHECKSUM_VALID');
    this.emitEvent({
      type: 'SNAPSHOT_LOADED',
      snapshotJson,
      baseEventVersion,
    });
  }

  private parseSnapshotStartPayload(payload: Record<string, unknown>): SnapshotStartPayload | null {
    if (!this.hasExactKeys(payload, [
      'snapshotId',
      'totalChunks',
      'totalBytes',
      'snapshotVersion',
      'protocolVersion',
      'schemaVersion',
      'baseEventVersion',
      'entityCount',
      'checksum',
    ])) {
      return null;
    }

    const snapshotId = payload['snapshotId'];
    const totalChunks = payload['totalChunks'];
    const totalBytes = payload['totalBytes'];
    const snapshotVersion = payload['snapshotVersion'];
    const protocolVersion = payload['protocolVersion'];
    const schemaVersion = payload['schemaVersion'];
    const baseEventVersion = payload['baseEventVersion'];
    const entityCount = payload['entityCount'];
    const checksum = payload['checksum'];

    if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
      return null;
    }

    if (
      !this.isNonNegativeInteger(totalChunks)
      || !this.isNonNegativeInteger(totalBytes)
      || !this.isNonNegativeInteger(snapshotVersion)
      || !this.isNonNegativeInteger(protocolVersion)
      || !this.isNonNegativeInteger(schemaVersion)
      || !this.isNonNegativeInteger(baseEventVersion)
      || !this.isNonNegativeInteger(entityCount)
      || typeof checksum !== 'string'
      || checksum.length === 0
    ) {
      return null;
    }

    return {
      snapshotId,
      totalChunks,
      totalBytes,
      snapshotVersion,
      protocolVersion,
      schemaVersion,
      baseEventVersion,
      entityCount,
      checksum,
    };
  }

  private parseSnapshotChunkPayload(payload: Record<string, unknown>): SnapshotChunkPayload | null {
    if (!this.hasAllowedKeys(payload, ['index', 'data', 'checksum']) || !('index' in payload) || !('data' in payload)) {
      return null;
    }

    const index = payload['index'];
    const data = payload['data'];
    const checksum = payload['checksum'];

    if (!this.isNonNegativeInteger(index) || typeof data !== 'string') {
      return null;
    }

    if (checksum !== undefined && typeof checksum !== 'string') {
      return null;
    }

    return { index, data, checksum };
  }

  private parseSnapshotCompletePayload(payload: Record<string, unknown>): SnapshotCompletePayload | null {
    if (!this.hasExactKeys(payload, ['totalChunks'])) {
      return null;
    }

    const totalChunks = payload['totalChunks'];
    if (!this.isNonNegativeInteger(totalChunks)) {
      return null;
    }

    return { totalChunks };
  }

  private decodeBase64(value: string): Uint8Array | null {
    try {
      if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
      }

      const bufferCtor = (globalThis as typeof globalThis & {
        Buffer?: { from(input: string, encoding: string): Uint8Array };
      }).Buffer;

      return bufferCtor ? new Uint8Array(bufferCtor.from(value, 'base64')) : null;
    } catch {
      return null;
    }
  }

  private decodeUtf8(bytes: Uint8Array): string | null {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  private async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', this.toArrayBuffer(bytes));
    const hex = new Uint8Array(digest)
      .reduce((result, value) => `${result}${value.toString(16).padStart(2, '0')}`, '');

    return hex.toLowerCase();
  }

  private concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return combined;
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  private fail(reason: string): void {
    this.assembly = null;
    console.error(`SNAPSHOT_ERROR ${reason}`);
    this.emitEvent({ type: 'SNAPSHOT_ERROR', reason });
  }

  private emitEvent(event: SnapshotLoaderEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return this.hasAllowedKeys(obj, keys) && keys.every((key) => key in obj);
  }

  private hasAllowedKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(obj).every((key) => keys.includes(key));
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }
}