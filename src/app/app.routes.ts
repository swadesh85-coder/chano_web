import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'pair', pathMatch: 'full' },
  {
    path: 'pair',
    loadComponent: () =>
      import('./pairing/pairing').then((m) => m.PairingComponent),
  },
];
