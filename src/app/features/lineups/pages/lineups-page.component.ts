import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { LineupCardComponent } from '../components/lineup-card/lineup-card.component';
import { LineupsStore } from '../lineups.store';

@Component({
  selector: 'app-lineups-page',
  standalone: true,
  imports: [LineupCardComponent, MatButtonModule, RouterLink],
  templateUrl: './lineups-page.component.html',
  styleUrl: './lineups-page.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupsPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);

  constructor() {
    inject(ActivatedRoute).data
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(({ mode }) => {
        if (typeof mode === 'string' && this.store.mode() !== mode) this.store.setMode(mode);
      });
  }

  checkboxValue(event: Event): boolean {
    const input = event.target;
    return input instanceof HTMLInputElement && input.checked;
  }

  selectValue(event: Event): 'votes' | 'fewest' | 'new' {
    const select = event.target;
    if (select instanceof HTMLSelectElement && (select.value === 'fewest' || select.value === 'new')) {
      return select.value;
    }
    return 'votes';
  }

  setTarget(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) this.store.setTarget(select.value || null);
  }
}
