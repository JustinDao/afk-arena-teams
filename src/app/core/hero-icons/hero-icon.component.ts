import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HeroIconService } from './hero-icon.service';

@Component({
  selector: 'app-hero-icon',
  standalone: true,
  template: `
    <span class="hero-icon" [class.small]="size() === 'small'" [class.medium]="size() === 'medium'" aria-hidden="true">
      @if (imageSrc(); as src) {
        @if (failedUrl() !== src) {
          <img [src]="src" alt="" loading="lazy" decoding="async" (error)="failedUrl.set(src)">
        } @else {
          <span class="fallback">{{ initials() }}</span>
        }
      } @else {
        <span class="fallback">{{ initials() }}</span>
      }
    </span>
  `,
  styles: `
    :host { display: inline-flex; flex: 0 0 auto; vertical-align: middle; }
    .hero-icon {
      display: inline-grid;
      width: 42px;
      height: 42px;
      overflow: hidden;
      place-items: center;
      border: 1px solid var(--app-line);
      border-radius: 9px;
      background: var(--app-panel-variant);
      color: var(--app-ink);
    }
    .hero-icon.small { width: 30px; height: 30px; border-radius: 7px; }
    .hero-icon.medium { width: 38px; height: 38px; }
    img { width: 100%; height: 100%; object-fit: cover; }
    .fallback { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroIconComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>();
  readonly size = input<'small' | 'medium'>('small');
  readonly icons = inject(HeroIconService);
  readonly failedUrl = signal<string | null>(null);
  readonly iconId = computed(() => this.icons.unitIdFor(this.name()));
  readonly imageSrc = computed(() => {
    const id = this.iconId();
    return this.imageUrl() || (id === null ? null : this.icons.iconUrl(id));
  });
  readonly initials = computed(() =>
    this.name().split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase(),
  );
}
