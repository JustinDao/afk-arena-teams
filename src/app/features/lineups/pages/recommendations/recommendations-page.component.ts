import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, inject, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { LineupsStore } from '../../lineups.store';
import { RecommendationsState } from './recommendations.state';

@Component({
  selector: 'app-recommendations-page',
  standalone: true,
  imports: [DatePipe, MatButtonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './recommendations-page.component.html',
  styleUrl: './recommendations-page.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationsPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  readonly state = inject(RecommendationsState);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      const ready = this.store.backendReady() || !this.auth.configured;
      if (!user || !ready) return;
      untracked(() => void this.state.initialize(user.id));
    });
  }
}
