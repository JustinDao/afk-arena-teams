# AFK Arena Team Lineups

An Angular app for browsing and sharing AFK Arena (classic server) team lineups. It currently includes Twisted Realm, Nightmare Corridor, Cursed Realm, and Treasure Scramble.

## Run locally

Requirements: Node.js 20.11+ (or 22+) and npm.

```sh
npm ci
npm start
```

Open the local URL printed by Angular CLI (usually `http://localhost:4200`). Create a production build with `npm run build`; run unit tests with `npm test`.

Each active mode, roster tab, and lineup submission has a named URL: `/twisted-realm`, `/treasure-scramble`, `/cursed-realm`, `/nightmare-corridor`, `/roster/heroes`, `/roster/pets`, `/roster/collections`, and `/submit`. `/roster` redirects to `/roster/heroes`, and the short aliases `/tr`, `/ts`, `/cr`, and `/nc` redirect to their named routes. Pages are lazy-loaded routed components under `src/app/features/lineups/pages/`; `AppComponent` is the shell for the header, mode navigation, and account dialog. The root URL redirects to `/nightmare-corridor`. When deploying, configure the host to serve `index.html` for these paths so direct links and refreshes work.

Without Supabase configuration the app uses sample lineups. Guest rosters and votes are saved in this browser; guest submissions are temporary. Configure Supabase to enable accounts, private hero/pet/collection inventories, shared lineups, and community votes.

## Supabase setup

Supabase migrations are kept in [`supabase/migrations/`](./supabase/migrations/), with a timestamped filename for each change. They are the canonical SQL history going forward. The root-level `schema.sql` and migration scripts are retained for reference and older manual setup instructions; `schema.sql` is destructive and should not be used with the migration workflow.

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then log in and link your project:
   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   ```
2. Apply the database migrations:
   - **New project:** run `supabase db push` to apply the schema and subsequent migrations. The migrations include the app's reference catalogs, but not the example lineups from `seed.sql`. Run [`seed.sql`](./seed.sql) separately only if you want those example lineups.
   - **Existing project already created from `schema.sql`:** first verify its schema matches the baseline migration, then record the baseline without reapplying it:
     ```sh
     supabase migration repair --status applied 20261012043000
     ```
   If `collection-catalog-migration.sql` was already run manually, also mark its migration version as applied (`20261012043100`) so the data conversion is not repeated. Leave `20261012043200` pending when you need its Nightmare Corridor cycle repair; then run `supabase db push`.

`migration repair` only updates Supabase's migration history; it does not execute SQL. Do not mark a migration as applied unless its changes are already present. For an existing database with a different schema history, inspect and reconcile the live schema before using `db push` rather than applying the baseline on top of existing tables.

3. Copy [`src/environments/environment.example.ts`](./src/environments/environment.example.ts) to `src/environments/environment.ts`. Fill `supabaseUrl` and `supabaseKey` with the project URL and **publishable/anon key** from Supabase Project Settings → API. This local file is git-ignored. Never put a service-role or secret key in browser code.
4. In Supabase Authentication → URL Configuration, set the local app URL (`http://localhost:4200`) as the Site URL and add it to Redirect URLs.
5. Email/password signup is available in the account dialog. If email confirmation is enabled, users confirm by email before signing in; the profile is created automatically after their first successful signup.
6. To enable Google sign-in/linking, create a Google OAuth web client. In Google Cloud, add Supabase's callback URL (shown in Supabase Authentication → Providers → Google) as an authorized redirect URI. Enable Google in that Supabase provider panel and enter its client ID/secret there. The browser app never needs the Google client secret. Google sign-in can create an account, and a signed-in email/password user can link Google from the account dialog.
7. Run `npm start`.

The schema seeds four active modes, starter targets, all 227 unique playable elite/legendary hero entries from the AFK Mine CDN snapshot (including awakened variants), and 30 pets. Hero class, attribute type (Strength/Agility/Intelligence), and role follow the AFK Arena Wiki Heroes list and individual crossover hero pages; the separate `hero_type` database column is not inferred from class. Hero and pet IDs match CDN unit IDs; each row exposes an `icon_url` generated from that ID. The seed excludes rare/common/unknown-rarity unit metadata that is not part of the playable hero catalog. `seed.sql` adds one illustrative example lineup for each active mode; these are explicitly labeled as examples and are safe to run more than once.

The schema and migration seed the 20 named collection types and 26 stat-node types from the AFK Mine CDN catalog. The roster editor reads the collection and stat-node lists from these database tables when Supabase is configured; the CDN snapshot is used offline. Actual collection builds (the optional stat and tier for each of eight fixed slots) are private account data.

Update the reference data in Supabase Table Editor:

- `heroes`: add or rename heroes, and maintain each hero's faction, class, `hero_type` (strength, agility, or intelligence), and role.
- `pets`: add or rename pets; `is_awakened` supports catalog entries identified as awakened.
- `targets`: add or change boss/debuff names and rotation dates. Nightmare Corridor cycle anchors use `active_from`/`active_to` for their cycle window.
- `nightmare_corridor_cycle_bosses`: map each Nightmare Corridor cycle anchor to its six ordered boss targets; the sixth boss must be the selected anchor.
- `game_modes`: enable modes and adjust their `config` JSON, including displayed rules, formation layout, collection availability, and duplicate-hero rules.
- `collection_catalog`: named collections and their classes.
- `collection_node_types` and `collection_node_tiers`: available stat nodes and Elite/Legendary/Mythic node tiers. Stat-node codes must use lowercase letters, digits, and underscores; the app displays labels from the codes and loads the list from this table.

The initial Twisted Realm and Cursed Realm target names are starter data and can be maintained as the in-game rotation changes. Nightmare Corridor replaces one boss slot at a time rather than refreshing all six together, so each cycle is identified by its sixth-boss anchor and its dates, and `nightmare_corridor_cycle_bosses` supplies the six ordered boss teams with separate kill times. Lineup submission is available on its own `/submit` route. Treasure Scramble is configured for exactly seven teams by default.

The `search_submissions` RPC can rank public lineups by missing heroes, under-invested heroes, missing pets, pet levels, and (for Twisted Realm) Resonating Crystal level. It accepts hero and pet CDN-ID arrays; `p_pet_levels` is a JSON object keyed by pet ID, for example `{"6001":18}`, and `p_hero_investments` can map hero IDs to `si`, `furniture`, and `engraving` values. Set `p_strict` to `false` to include near matches. The app currently performs equivalent roster matching in the client so guests can search without uploading their private roster; signed-in rosters remain private.

## Rules and collections

- Formation positions render as two front-row and three back-row heroes.
- Heroes cannot repeat within one Cursed Realm or Treasure Scramble lineup. The same hero may still be used in both modes.
- A lineup has one mode-specific result: damage for Twisted Realm and Cursed Realm, a kill time for each Nightmare Corridor boss team, or a Treasure Scramble placement (rank 1–100 or top percentage).
- Twisted Realm submissions require the account's shared Resonating Crystal hero level.
- Nightmare Corridor and Cursed Realm allow at most one mercenary per lineup. Twisted Realm does not track a mercenary flag, and Treasure Scramble does not allow mercenaries.
- Nightmare Corridor cycle filters use a dropdown of the boss names listed on the [AFK Arena Wiki](https://afk-arena.fandom.com/wiki/Nightmare_Corridor); the selected target is still the cycle anchor (6th boss).
- Treasure Scramble starts with seven teams per lineup and records placement as either rank 1–100 or a top percentage.
- Collection inventory is private to each account and can be assigned to a hero separately in each submitted lineup. Existing lineup assignments are snapshots, so changes to inventory do not rewrite old submissions.
- Collection inventory uses the 20 named AFK Arena collections from the [CDN collection catalog](https://github.com/afk-mine/cdn/blob/main/collection.json), including each collection's class. Each build has three optional Attack nodes, three optional Defense nodes, and two optional Flex nodes; every node has a stat type and Elite/Legendary/Mythic tier, but no per-node level. Only Flex nodes may be the Level stat, and Level nodes are always Mythic. The CDN's collection stat icons include: armor, atk, buffer, cbr, cda, cdr, crit, def, diss, dmg_resist, erosion, err, full_atk, full_buffer, full_def, full_erosion, full_hp, heal, hp, is, ll, mp, pp, prf, skill_level, and ty. The roster and lineup views display the corresponding [collection](https://github.com/afk-mine/cdn/tree/main/collection_icon) and [stat](https://github.com/afk-mine/cdn/tree/main/collection_stats_icon) icons.
- Collection assignments are enabled for Twisted Realm and Nightmare Corridor, and disabled for Cursed Realm and Treasure Scramble.

## Roster levels and pets

- The roster stores one shared hero level for the account, matching the common Resonating Crystal level, rather than duplicating it on every hero. Hero investments can be entered as a compact code (`309e60`) or as separate SI, furniture, and engraving values. Compact codes support SI 0–40 and furniture 0–12, so `303` means SI 30 / furniture 3 / engraving 0 and `3012e60` means SI 30 / furniture 12 / engraving 60.
- The roster editor is a dedicated full-page view with Heroes, Pets, and Collections tabs. Heroes can be filtered by faction, all five classes, and their Strength/Agility/Intelligence attribute type using game-style circular filters with game-aligned colors; collections can be filtered by class. Hero investments include quick sets for 40/9/60, 30/9/60, and 30/9/30; pet levels can be quick-set to 12, 15, or 18. Pet selection buttons use distinct background colors for basic, regular, and awakened pets; the awakened pets are Blazefang, Count Snickerfang, Nightfall Pegasus, and Twinlum Spirit. Bulk clears and pet-level quick sets that overwrite existing levels ask for confirmation. The lineup page loads only the signed-in user's owned heroes (needed for lineup matching) and votes; pet ownership/levels and Resonating Crystal level load when the roster page is opened, and collections load only when needed for collection management or lineup submission.
- Collection choices and saved inventory are alphabetically ordered. The collection lists can be filtered by class; each collection's class appears centered below its name, and saved rows retain styled Edit/Delete buttons.
- Pet ownership and levels are tracked separately for every pet; current levels are stored from 1–18.
- Formations can select a pet and record its level. Submitted lineups retain the selected pet/level and shared hero level as snapshots; roster matching checks pet ownership and, when level/investment checks are enabled, whether the account hero level and owned pet level meet the submitted levels.
- The seeded pet catalog follows the current `afk-mine/cdn` unit metadata (IDs 6001–6030). Those entries are not marked awakened by that metadata; the catalog includes an `is_awakened` field for later entries if identified.

## Hero icons and attribution

Hero icons are loaded at runtime from the public [AFK Arena CDN project](https://github.com/afk-mine/cdn); this app does not bundle or copy its image files. With Supabase enabled, catalog image URLs come from the seeded `icon_url` columns. Without it, the app reads CDN `unit.json` metadata to match sample hero names to unit IDs. If a name or icon is unavailable, the UI displays initials instead. Icons need an internet connection and the CDN repository to remain available.

AFK Arena names and game assets belong to Lilith Games. This fan-made project is not affiliated with or endorsed by Lilith Games. The icon files are served by the third-party CDN project, not owned by this app.

## App architecture

The app uses Angular 19 standalone components, strict TypeScript templates, OnPush change detection, signals for feature state, typed reactive forms, Angular Material, and Material 3 design tokens. The theme button cycles between system, dark, and light themes. Feature state, models, and sample data are under `src/app/features/lineups/`.
