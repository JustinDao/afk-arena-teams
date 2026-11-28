import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LineupsStore } from '../../lineups.store';

@Component({
  selector: 'app-recommender-v2-page',
  standalone: true,
  imports: [MatButtonModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <main class="recommender-v2-page">
      <section class="panel" aria-labelledby="recommender-v2-title">
        <div class="panel-header">
          <div>
            <h2 id="recommender-v2-title">Recommendations</h2>
            <p class="rules">
              Personalized investment priorities and conflict-free team lineups modeled from community submissions.
            </p>
          </div>
        </div>

        <nav class="v2-tabs" aria-label="Recommender V2 sections">
          <a
            mat-button
            routerLink="investments"
            routerLinkActive
            #investmentsLink="routerLinkActive"
            [attr.aria-current]="investmentsLink.isActive ? 'page' : null"
          >Investments</a>
          <a
            mat-button
            routerLink="lineups"
            routerLinkActive
            #lineupsLink="routerLinkActive"
            [attr.aria-current]="lineupsLink.isActive ? 'page' : null"
          >Lineups</a>
        </nav>

        <router-outlet />
      </section>
    </main>
  `,
  styles: `
    .recommender-v2-page {
      max-width: 1120px;
      margin-inline: auto;
    }

    .recommender-v2-page .panel {
      width: 100%;
      border: 0;
      border-radius: 0;
    }

    .v2-title-row {
      display: flex;
      align-items: center;
      gap: var(--app-space-2);
    }

    .v2-badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--app-primary) 16%, transparent);
      color: var(--app-primary);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .v2-tabs {
      display: flex;
      gap: var(--app-space-1);
      margin-block: var(--app-space-3);
      border-bottom: 1px solid var(--app-line);
    }

    .v2-tabs a {
      border-bottom: 3px solid transparent;
      border-radius: 0;
      color: var(--app-muted);
      font-weight: 600;
    }

    .v2-tabs a[aria-current='page'] {
      border-bottom-color: var(--app-primary);
      color: var(--app-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommenderV2PageComponent {
  readonly store = inject(LineupsStore);

  constructor() {
    effect(() => {
      if (this.store.backendReady()) {
        void this.store.loadRosterDetails();
        void this.store.loadCollections();
      }
    });
  }
}
