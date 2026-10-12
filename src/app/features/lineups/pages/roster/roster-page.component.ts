import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MODE_PATHS } from '../../../../app.routes';
import { AuthService } from '../../../../core/auth/auth.service';
import { LineupsStore } from '../../lineups.store';

@Component({
  selector: 'app-roster-page',
  standalone: true,
  imports: [MatButtonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './roster-page.component.html',
  styleUrl: './roster-page.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    this.store.closeDraft();
    void this.store.loadRosterDetails();
  }

  backToLineups(): void {
    void this.router.navigateByUrl(MODE_PATHS[this.store.mode()] ?? '/');
  }
}
