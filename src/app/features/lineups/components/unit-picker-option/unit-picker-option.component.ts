import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';

type UnitPickerTone = 'hero' | 'basic' | 'standard' | 'awakened';

@Component({
  selector: 'app-unit-picker-option',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule],
  template: `
    <button
      mat-button
      type="button"
      class="hero-pick"
      [class.owned]="selected()"
      [class.pet-pick--basic]="tone() === 'basic'"
      [class.pet-pick--regular]="tone() === 'standard'"
      [class.pet-pick--awakened]="tone() === 'awakened'"
      [style.--hero-faction-color]="factionColor()"
      [attr.title]="title() || null"
      [attr.aria-pressed]="selected()"
      [disabled]="disabled()"
      (click)="selectedChange.emit()"
    >
      <span class="unit-content">
        <span class="unit-icon">
          <app-hero-icon [name]="name()" [imageUrl]="imageUrl()" size="small" />
        </span>
        <span class="unit-name">{{ name() }}</span>
      </span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    .hero-pick.mat-mdc-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      height: 40px;
      min-width: 0;
      min-height: 40px;
      max-height: 40px;
      padding: 0 8px;
      overflow: hidden;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      color: var(--app-chip-ink);
      white-space: nowrap;
      line-height: normal;
    }

    .hero-pick ::ng-deep .mdc-button__label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 0;
      line-height: normal;
    }

    .unit-content {
      display: inline-flex;
      width: 100%;
      min-width: 0;
      align-items: center;
      justify-content: center;
      gap: var(--app-space-2);
      line-height: normal;
    }

    .unit-icon {
      display: inline-flex;
      width: 30px;
      height: 30px;
      flex: 0 0 30px;
      overflow: hidden;
      align-items: center;
      justify-content: center;
    }

    .unit-name {
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }

    .hero-pick.pet-pick--basic {
      background: color-mix(in srgb, #4d9d72 24%, var(--app-panel));
    }

    .hero-pick.pet-pick--regular {
      background: color-mix(in srgb, #4f82bf 24%, var(--app-panel));
    }

    .hero-pick.pet-pick--awakened {
      background: color-mix(in srgb, #9564c8 30%, var(--app-panel));
    }

    .hero-pick.owned {
      border-color: var(--app-success);
      font-weight: 600;
    }

    .hero-pick:disabled {
      opacity: 0.35;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitPickerOptionComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly selected = input(false);
  readonly disabled = input(false);
  readonly title = input('');
  readonly tone = input<UnitPickerTone>('hero');
  readonly factionColor = input<string | null>(null);
  readonly selectedChange = output<void>();
}
