import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { LineupCardComponent } from '../components/lineup-card/lineup-card.component';
import { LineupsStore } from '../lineups.store';
import { countLabel } from '../plural';

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
  readonly countLabel = countLabel;
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

  teamCounts(variable: { readonly min: number; readonly max: number }): readonly number[] {
    return Array.from({ length: variable.max - variable.min + 1 }, (_, index) => variable.min + index);
  }

  readonly hfcBosses = computed(() => {
    const bosses = new Set<string>();
    for (const target of this.store.activeMode().targets) {
      const [boss] = target.split(' — ');
      if (boss?.trim()) bosses.add(boss.trim());
    }
    return [...bosses].sort((a, b) => a.localeCompare(b));
  });

  readonly hfcBuffs = computed(() => {
    const selectedBoss = this.store.targetBoss();
    const buffs = new Set<string>();
    for (const target of this.store.activeMode().targets) {
      const [boss, buff] = target.split(' — ');
      if (selectedBoss && boss?.trim() !== selectedBoss) continue;
      if (buff?.trim()) buffs.add(buff.trim());
    }
    return [...buffs].sort((a, b) => a.localeCompare(b));
  });

  setTarget(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) this.store.setTarget(select.value || null);
  }

  setTargetBoss(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const boss = select.value || null;
    this.store.setTargetBoss(boss);
    const currentBuff = this.store.targetBuff();
    if (currentBuff && !this.hfcBuffs().includes(currentBuff)) {
      this.store.setTargetBuff(null);
    }
  }

  setTargetBuff(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) this.store.setTargetBuff(select.value || null);
  }

  hasActiveFilters(): boolean {
    return this.store.target() !== null
      || this.store.targetBoss() !== null
      || this.store.targetBuff() !== null
      || this.store.teamCount() !== null;
  }

  clearFilters(): void {
    this.store.setTarget(null);
    this.store.setTargetBoss(null);
    this.store.setTargetBuff(null);
    this.store.setTeamCount(null);
  }
}
