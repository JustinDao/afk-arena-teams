import { Routes } from '@angular/router';

export const MODE_PATHS: Readonly<Record<string, string>> = {
  'treasure-scramble': '/treasure-scramble',
  'cursed-realm': '/cursed-realm',
  'nightmare-corridor': '/nightmare-corridor',
  'heroes-of-esperia': '/heroes-of-esperia',
  'temporal-rift': '/temporal-rift',
  'hunting-fields-contract': '/hunting-fields-contract',
  'abyssal-expedition': '/abyssal-expedition',
};

export const MODE_SLUGS_BY_PATH: Readonly<Record<string, string>> = {
  ts: 'treasure-scramble',
  'treasure-scramble': 'treasure-scramble',
  cr: 'cursed-realm',
  'cursed-realm': 'cursed-realm',
  nc: 'nightmare-corridor',
  'nightmare-corridor': 'nightmare-corridor',
  hoe: 'heroes-of-esperia',
  'heroes-of-esperia': 'heroes-of-esperia',
  trift: 'temporal-rift',
  'temporal-rift': 'temporal-rift',
  hfc: 'hunting-fields-contract',
  'hunting-fields-contract': 'hunting-fields-contract',
  abex: 'abyssal-expedition',
  'abyssal-expedition': 'abyssal-expedition',
};

const lineupsPage = () => import('./features/lineups/pages/lineups-page.component').then((m) => m.LineupsPageComponent);

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'ts', pathMatch: 'full', redirectTo: 'treasure-scramble' },
  { path: 'cr', pathMatch: 'full', redirectTo: 'cursed-realm' },
  { path: 'nc', pathMatch: 'full', redirectTo: 'nightmare-corridor' },
  { path: 'hoe', pathMatch: 'full', redirectTo: 'heroes-of-esperia' },
  { path: 'trift', pathMatch: 'full', redirectTo: 'temporal-rift' },
  { path: 'hfc', pathMatch: 'full', redirectTo: 'hunting-fields-contract' },
  { path: 'abex', pathMatch: 'full', redirectTo: 'abyssal-expedition' },
  { path: 'treasure-scramble', loadComponent: lineupsPage, data: { mode: 'treasure-scramble' } },
  { path: 'cursed-realm', loadComponent: lineupsPage, data: { mode: 'cursed-realm' } },
  { path: 'nightmare-corridor', loadComponent: lineupsPage, data: { mode: 'nightmare-corridor' } },
  { path: 'heroes-of-esperia', loadComponent: lineupsPage, data: { mode: 'heroes-of-esperia' } },
  { path: 'temporal-rift', loadComponent: lineupsPage, data: { mode: 'temporal-rift' } },
  { path: 'hunting-fields-contract', loadComponent: lineupsPage, data: { mode: 'hunting-fields-contract' } },
  { path: 'abyssal-expedition', loadComponent: lineupsPage, data: { mode: 'abyssal-expedition' } },
  {
    path: 'lineup/:id',
    loadComponent: () => import('./features/lineups/pages/lineup-detail-page.component').then((m) => m.LineupDetailPageComponent),
  },
  {
    path: 'import-helper',
    redirectTo: 'submit/from-image',
    pathMatch: 'full',
  },
  {
    path: 'submit',
    loadComponent: () => import('./features/lineups/pages/submit-page.component').then((m) => m.SubmitPageComponent),
  },
  {
    path: 'submit/from-image',
    loadComponent: () =>
      import('./features/lineups/pages/submit-from-image-page.component').then((m) => m.SubmitFromImagePageComponent),
  },
  {
    path: 'recommendations',
    loadComponent: () => import('./features/lineups/pages/recommendations/recommendations-page.component').then((m) => m.RecommendationsPageComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'heroes' },
      {
        path: 'heroes',
        loadComponent: () => import('./features/lineups/pages/recommendations/recommendation-heroes.component').then((m) => m.RecommendationHeroesComponent),
      },
      {
        path: 'collections',
        loadComponent: () => import('./features/lineups/pages/recommendations/recommendation-collections.component').then((m) => m.RecommendationCollectionsComponent),
      },
      {
        path: 'pets',
        loadComponent: () => import('./features/lineups/pages/recommendations/recommendation-pets.component').then((m) => m.RecommendationPetsComponent),
      },
    ],
  },
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
