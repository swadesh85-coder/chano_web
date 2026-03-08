import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { ProjectionStore } from './projection/projection.store';

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
        const store = inject(ProjectionStore);
        const router = inject(Router);
        return store.phase() === 'ready' || router.createUrlTree(['/pair']);
      },
    ],
  },
];
