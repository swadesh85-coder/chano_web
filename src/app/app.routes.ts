import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { ProjectionStateContainer } from './projection/projection_state.container';

export const routes: Routes = [
  { path: '', redirectTo: 'pair', pathMatch: 'full' },
  {
    path: 'pair',
    loadComponent: () =>
      import('./pairing/pairing').then((m) => m.PairingComponent),
  },
  {
    path: 'explorer',
    loadComponent: () =>
      import('./explorer/explorer').then((m) => m.ExplorerComponent),
    canActivate: [
      () => {
        const projection = inject(ProjectionStateContainer);
        const router = inject(Router);
        return projection.phase() === 'ready' || router.createUrlTree(['/pair']);
      },
    ],
  },
];
