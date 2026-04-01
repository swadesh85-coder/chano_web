import { Injectable, inject } from '@angular/core';
import type { EventEntity, ProjectionState } from './projection.models';
import { ProjectionStore } from './projection.store';

@Injectable({ providedIn: 'root' })
export class ProjectionStateContainer {
  private readonly store = inject(ProjectionStore);

  readonly state = this.store.state;
  readonly phase = this.store.phase;
  readonly projectionUpdate = this.store.lastProjectionUpdate;

  readState(): ProjectionState {
    return this.store.state();
  }

  getEntityVersion(entityType: EventEntity, entityId: string): number | null {
    const state = this.store.state();

    switch (entityType) {
      case 'folder':
        return state.folders.find((entity) => entity.id === entityId)?.entityVersion ?? null;
      case 'thread':
        return state.threads.find((entity) => entity.id === entityId)?.entityVersion ?? null;
      case 'record':
        return state.records.find((entity) => entity.id === entityId)?.entityVersion ?? null;
      case 'imageGroup': {
        const imageGroupVersions = state.records
          .filter((entity) => entity.imageGroupId === entityId)
          .map((entity) => entity.entityVersion);

        return imageGroupVersions.length === 0 ? null : Math.max(...imageGroupVersions);
      }
    }
  }
}