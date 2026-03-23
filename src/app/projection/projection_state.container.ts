import { Injectable, inject } from '@angular/core';
import type { EventEntity, ProjectionState } from './projection.models';
import { ProjectionStore } from './projection.store';
import { selectEntityVersion } from '../../projection/selectors';

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
    return selectEntityVersion(this.store.state(), entityType, entityId);
  }
}