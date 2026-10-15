import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';

export type PetTone = 'basic' | 'standard' | 'awakened';

@Component({
  selector: 'app-pet-badge',
  standalone: true,
  imports: [HeroIconComponent],
  template: `
    <span
      class="pet-badge"
      [class.pet-badge--basic]="tone() === 'basic'"
      [class.pet-badge--regular]="tone() === 'standard'"
      [class.pet-badge--awakened]="tone() === 'awakened'"
      [attr.title]="title() || null"
    >
      <span class="pet-icon-container">
        <app-hero-icon [name]="name()" [imageUrl]="imageUrl()" size="small" />
      </span>
      <span class="pet-label">
        <span class="pet-name">{{ name() }}</span>
        @if (level() !== null) {
          <span class="pet-level"> · Lv. {{ level() }}</span>
        }
      </span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
      max-width: 100%;
    }

    .pet-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--app-space-2);
      min-width: 0;
      max-width: 100%;
      height: 36px;
      padding: 2px 10px 2px 4px;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      background: var(--app-panel);
      color: var(--app-chip-ink);
      font-size: 0.8rem;
      line-height: normal;
      box-sizing: border-box;
    }

    .pet-badge--basic {
      background: color-mix(in srgb, #4d9d72 24%, var(--app-panel));
    }

    .pet-badge--regular {
      background: color-mix(in srgb, #4f82bf 24%, var(--app-panel));
    }

    .pet-badge--awakened {
      background: color-mix(in srgb, #9564c8 30%, var(--app-panel));
    }

    .pet-icon-container {
      display: inline-flex;
      width: 30px;
      height: 30px;
      flex: 0 0 30px;
      overflow: hidden;
      border-radius: 7px;
      align-items: center;
      justify-content: center;
    }

    .pet-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pet-name {
      font-weight: 600;
    }

    .pet-level {
      color: var(--app-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PetBadgeComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly level = input<number | null>(null);
  readonly tone = input<PetTone | null>(null);
  readonly title = input<string>('');
}
