import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component'
import { formatInvestment, parseInvestment, sanitizeInvestmentForAscension } from '../../investment'
import { ASCENSION_RANK_LABELS, ASCENSION_RANKS, AscensionRank, displayHeroName, Hero, Investment } from '../../models'

type InvestmentPart = 'si' | 'furn' | 'eng';

@Component({
  selector: 'app-hero-investment-editor',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule],
  template: `
    <div class="investment-editor">
      <div class="hero-heading">
        <app-hero-icon [name]="displayName()" [imageUrl]="hero().iconUrl ?? null" size="large" [ascension]="ascension()" [investment]="parsedInvestment()" />
        <strong>{{ displayName() }}</strong>
      </div>
      <label class="rank-field">
        <span>Ascension</span>
        <select [disabled]="disabled()" [attr.aria-label]="'Ascension for ' + displayName()" (change)="updateAscension($event)">
          <option value="" [selected]="ascension() === null">Not set</option>
          @for (rank of ascensionRanks; track rank) {
            <option [value]="rank" [selected]="ascension() === rank">{{ ascensionLabels[rank] }}</option>
          }
        </select>
        <span class="quick-set-label">Quick set ascension</span>
        <span class="quick-set">
          <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="setAscension('mythic')">M</button>
          <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="setAscension('ascended_1')">A1★</button>
          <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="setAscension('ascended_5')">A5★</button>
        </span>
      </label>
      <section class="investment-field" [attr.aria-label]="'Investment for ' + displayName()">
        <h4>Investment</h4>
        <div class="investment-controls">
          <div class="seg" role="group" [attr.aria-label]="'Investment input format for ' + displayName()">
            <button mat-button type="button" [attr.aria-pressed]="activeMode() === 'short'" (click)="setMode('short')">Short form</button>
            <button mat-button type="button" [attr.aria-pressed]="activeMode() === 'long'" (click)="setMode('long')">Long form</button>
          </div>
          @if (activeMode() === 'short') {
            <label class="investment-row">
              <span class="investment-hint">SI at Mythic · furniture at Ascended · engraving at A1★</span>
              <input
                [value]="investment()"
                placeholder="309e60"
                [disabled]="disabled()"
                [attr.aria-label]="'Investment for ' + displayName()"
                [attr.aria-invalid]="error() ? 'true' : null"
                (change)="updateShort($event)"
              >
            </label>
          } @else {
            <div class="investment-columns" aria-hidden="true">
              <span>SI</span><span>Furniture</span><span>Engraving</span>
            </div>
            <div class="investment-long-row">
              <input type="number" min="0" max="50" step="1" [disabled]="disabled() || !canSetSi()" [value]="part('si')" [attr.aria-label]="'SI for ' + displayName()" [attr.title]="canSetSi() ? 'SI level' : 'SI is available at Mythic and above'" (change)="updatePart('si', $event)">
              <input type="number" min="0" max="36" step="1" [disabled]="disabled() || !canSetFurniture()" [value]="part('furn')" [attr.aria-label]="'Furniture for ' + displayName()" [attr.title]="canSetFurniture() ? 'Furniture level' : 'Furniture is available at Ascended and above'" (change)="updatePart('furn', $event)">
              <input type="number" min="0" max="100" step="1" [disabled]="disabled() || !canSetEngraving()" [value]="part('eng')" [attr.aria-label]="'Engraving for ' + displayName()" [attr.title]="canSetEngraving() ? 'Engraving level' : 'Engraving is available at Ascended 1 star and above'" (change)="updatePart('eng', $event)">
            </div>
            <p class="investment-hint">SI requires Mythic; furniture requires Ascended; engraving requires Ascended 1★.</p>
          }
          <span class="quick-set-label">Quick set investment</span>
          <div class="quick-set" role="group" [attr.aria-label]="'Quick set investment for ' + displayName()">
            <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="quickSet('409e60')">409e60</button>
            <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="quickSet('309e60')">309e60</button>
            <button mat-button type="button" class="btn" [disabled]="disabled()" (click)="quickSet('309e30')">309e30</button>
          </div>
        </div>
      </section>
      @if (error()) { <span class="field-hint" role="alert">{{ error() }}</span> }
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; grid-column: 1 / -1; }
    .investment-editor { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); grid-template-areas: 'hero hero' 'rank investment'; gap: 10px 16px; padding-block: 12px; border-bottom: 1px solid var(--app-line); }
    .hero-heading { grid-area: hero; display: flex; min-width: 0; align-items: center; gap: 10px; }
    .rank-field { grid-area: rank; display: grid; align-content: start; gap: 8px; color: var(--app-muted); font-size: 0.8rem; }
    .rank-field select { min-width: 0; width: 100%; }
    .quick-set-label { margin-top: 4px; }
    .investment-field { grid-area: investment; min-width: 0; }
    .investment-field h4 { margin: 0 0 8px; color: var(--app-muted); font-size: 0.8rem; font-weight: 600; }
    .investment-controls { display: grid; min-width: 0; gap: 8px; }
    .investment-controls .seg { display: flex; width: 100%; min-width: 0; }
    .investment-controls .seg button { flex: 1 1 0; min-width: 0; }
    .investment-long-row, .investment-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: center;
      gap: 8px;
    }
    .investment-long-row input { min-width: 0; width: 100%; }
    .investment-columns { color: var(--app-muted); font-size: 0.75rem; text-align: center; }
    .investment-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(90px, 130px); align-items: center; gap: 8px; }
    .investment-row input { min-width: 0; }
    .quick-set { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 4px; }
    .quick-set button.btn { width: 100%; min-width: 0; padding-inline: 6px; border: 1px solid var(--app-line); border-radius: 6px; background: var(--app-panel); color: var(--app-ink); }
    .quick-set button.btn:hover:not(:disabled) { border-color: var(--app-primary); background: var(--app-panel-variant); }
    .investment-hint { color: var(--app-muted); font-size: 0.75rem; }
    .field-hint { grid-column: 1 / -1; color: var(--app-error); font-size: 0.75rem; }
    @media (max-width: 430px) {
      .investment-long-row, .investment-columns { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
      .investment-row { grid-template-columns: minmax(0, 1fr) 95px; }
    }
    @media (max-width: 560px) {
      .investment-editor { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'hero' 'rank' 'investment'; }
      .rank-field { grid-template-columns: auto minmax(0, 1fr); align-items: center; }
      .rank-field > span:first-child { grid-column: 1; }
      .rank-field select { grid-column: 2; }
      .quick-set-label { grid-column: 1; }
      .quick-set { grid-column: 2; margin-top: 0; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroInvestmentEditorComponent {
  readonly ascensionRanks = ASCENSION_RANKS;
  readonly ascensionLabels = ASCENSION_RANK_LABELS;
  readonly hero = input.required<Hero>();
  readonly displayName = computed(() => displayHeroName(this.hero()));
  readonly investment = input('');
  readonly ascension = input<AscensionRank | null>(null);
  readonly disabled = input(false);
  readonly investmentChange = output<string>();
  readonly ascensionChange = output<AscensionRank | null>();
  readonly mode = input<'short' | 'long' | null>(null);
  readonly modeChange = output<'short' | 'long'>();
  private readonly localMode = signal<'short' | 'long'>('short');
  readonly activeMode = computed(() => this.mode() ?? this.localMode());
  readonly error = signal('');
  readonly parsedInvestment = computed(() => parseInvestment(this.investment()));
  readonly canSetSi = computed(() => this.rankIndex() >= ASCENSION_RANKS.indexOf('mythic'));
  readonly canSetFurniture = computed(() => this.rankIndex() >= ASCENSION_RANKS.indexOf('ascended'));
  readonly canSetEngraving = computed(() => this.rankIndex() >= ASCENSION_RANKS.indexOf('ascended_1'));

  private rankIndex(): number {
    const rank = this.ascension();
    return rank ? ASCENSION_RANKS.indexOf(rank) : -1;
  }

  updateAscension(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const selected = this.ascensionRanks.find((rank) => rank === value) ?? null;
    this.handleAscensionChange(selected);
  }

  setAscension(rank: AscensionRank): void {
    this.handleAscensionChange(rank);
  }

  private handleAscensionChange(selected: AscensionRank | null): void {
    this.error.set('');
    this.ascensionChange.emit(selected);
    const parsed = parseInvestment(this.investment());
    if (parsed) {
      const sanitized = sanitizeInvestmentForAscension(parsed, selected);
      if (
        sanitized &&
        (sanitized.si !== parsed.si ||
          sanitized.furn !== parsed.furn ||
          sanitized.eng !== parsed.eng)
      ) {
        this.investmentChange.emit(formatInvestment(sanitized));
      }
    }
  }

  setMode(mode: 'short' | 'long'): void {
    this.localMode.set(mode);
    this.modeChange.emit(mode);
  }

  part(part: InvestmentPart): number | '' {
    const parsed = parseInvestment(this.investment());
    return parsed?.[part] ?? '';
  }

  updateShort(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const parsed = parseInvestment(event.target.value);
    if (parsed?.si !== null && parsed?.si !== undefined && !this.canSetSi()) {
      this.setError(event.target, 'Signature item investment requires Mythic or higher.');
      return;
    }
    if ((parsed?.furn ?? 0) > 0 && !this.canSetFurniture()) {
      this.setError(event.target, 'Furniture investment requires Ascended or higher.');
      return;
    }
    if ((parsed?.eng ?? 0) > 0 && !this.canSetEngraving()) {
      this.setError(event.target, 'Engraving requires Ascended 1 star or higher.');
      return;
    }
    this.update(event.target.value, event.target);
  }

  updatePart(part: InvestmentPart, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (part === 'si' && !this.canSetSi()) {
      this.setError(event.target, 'Signature item investment requires Mythic or higher.');
      return;
    }
    if (part === 'furn' && !this.canSetFurniture()) {
      this.setError(event.target, 'Furniture investment requires Ascended or higher.');
      return;
    }
    if (part === 'eng' && !this.canSetEngraving()) {
      this.setError(event.target, 'Engraving requires Ascended 1 star or higher.');
      return;
    }
    const raw = event.target.value.trim();
    const value = raw === '' ? null : Number(raw);
    const ranges: Record<InvestmentPart, readonly [number, number]> = {
      si: [0, 50],
      furn: [0, 36],
      eng: [0, 100],
    };
    const [min, max] = ranges[part];
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
      this.setError(
        event.target,
        `${part === 'furn' ? 'Furniture' : part === 'si' ? 'SI' : 'Engraving'} must be a whole number from ${min}–${max}.`,
        String(this.part(part)),
      );
      return;
    }
    const current = parseInvestment(this.investment()) ?? { si: null, furn: null, eng: null };
    const next: Investment = { ...current, [part]: value };
    this.update(formatInvestment(next), event.target);
  }

  quickSet(value: string): void {
    this.error.set('');
    if (!this.canSetEngraving()) {
      this.ascensionChange.emit('ascended_1');
    }
    this.investmentChange.emit(value);
  }

  private update(value: string, input: HTMLInputElement): void {
    if (value.trim() && !parseInvestment(value)) {
      this.setError(input, 'Use a valid code, such as 303e0 or 309e60 (SI 0–50, furniture 0–36, engraving 0–100).');
      return;
    }
    this.error.set('');
    this.investmentChange.emit(value);
  }

  private setError(input: HTMLInputElement, message: string, value = this.investment()): void {
    this.error.set(message);
    input.value = value;
  }
}
