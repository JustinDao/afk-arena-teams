import { Routes } from '@angular/router';

export const MODE_PATHS: Readonly<Record<string, string>> = {
  'twisted-realm': '/twisted-realm',
  'treasure-scramble': '/treasure-scramble',
  'cursed-realm': '/cursed-realm',
  'nightmare-corridor': '/nightmare-corridor',
};

export const MODE_SLUGS_BY_PATH: Readonly<Record<string, string>> = {
  tr: 'twisted-realm',
  'twisted-realm': 'twisted-realm',
  ts: 'treasure-scramble',
  'treasure-scramble': 'treasure-scramble',
  cr: 'cursed-realm',
  'cursed-realm': 'cursed-realm',
  nc: 'nightmare-corridor',
  'nightmare-corridor': 'nightmare-corridor',
};

const lineupsPage = () => import('./features/lineups/pages/lineups-page.component').then((m) => m.LineupsPageComponent);

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'tr', pathMatch: 'full', redirectTo: 'twisted-realm' },
  { path: 'ts', pathMatch: 'full', redirectTo: 'treasure-scramble' },
  { path: 'cr', pathMatch: 'full', redirectTo: 'cursed-realm' },
  { path: 'nc', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'twisted-realm', loadComponent: lineupsPage, data: { mode: 'twisted-realm' } },
  { path: 'treasure-scramble', loadComponent: lineupsPage, data: { mode: 'treasure-scramble' } },
  { path: 'cursed-realm', loadComponent: lineupsPage, data: { mode: 'cursed-realm' } },
  { path: 'nightmare-corridor', loadComponent: lineupsPage, data: { mode: 'nightmare-corridor' } },
  {
    path: 'roster',
    loadComponent: () => import('./features/lineups/pages/roster/roster-page.component').then((m) => m.RosterPageComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'heroes' },
      {
        path: 'heroes',
        loadComponent: () => import('./features/lineups/pages/roster/roster-heroes.component').then((m) => m.RosterHeroesComponent),
      },
      {
        path: 'pets',
        loadComponent: () => import('./features/lineups/pages/roster/roster-pets.component').then((m) => m.RosterPetsComponent),
      },
      {
        path: 'collections',
        loadComponent: () => import('./features/lineups/pages/roster/roster-collections.component').then((m) => m.RosterCollectionsComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'nightmare-corridor' },
];
