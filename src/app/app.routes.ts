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

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'tr', pathMatch: 'full', redirectTo: 'twisted-realm' },
  { path: 'ts', pathMatch: 'full', redirectTo: 'treasure-scramble' },
  { path: 'cr', pathMatch: 'full', redirectTo: 'cursed-realm' },
  { path: 'nc', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'twisted-realm', children: [] },
  { path: 'treasure-scramble', children: [] },
  { path: 'cursed-realm', children: [] },
  { path: 'nightmare-corridor', children: [] },
  { path: 'roster', children: [] },
  { path: '**', redirectTo: 'nightmare-corridor' },
];
