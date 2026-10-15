import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HeroIconService } from './hero-icon.service';
import { AscensionRank, Investment } from '../../features/lineups/models';

@Component({
  selector: 'app-hero-icon',
  standalone: true,
  template: `
    <span
      class="hero-icon"
      [class.small]="size() === 'small'"
      [class.medium]="size() === 'medium'"
      [class.large]="size() === 'large'"
      [class.framed]="isFramed()"
      aria-hidden="true"
    >
      @if (imageSrc(); as src) {
        <img [src]="src" alt="" loading="lazy" decoding="async" (error)="markImageFailed(src)">
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
      position: relative;
      box-sizing: border-box;
    }
    .hero-icon.small { width: 30px; height: 30px; border-radius: 7px; }
    .hero-icon.medium { width: 48px; height: 48px; border-radius: 9px; }
    .hero-icon.large { width: 64px; height: 64px; border-radius: 11px; }
    .hero-icon.framed { overflow: visible; border: 0; border-radius: 0; background: transparent; }
    img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
    .fallback { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroIconComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>();
  readonly size = input<'small' | 'medium' | 'large'>('small');
  readonly ascension = input<AscensionRank | null>(null);
  readonly investment = input<Investment | null>(null);
  readonly icons = inject(HeroIconService);
  readonly failedUrls = signal<ReadonlySet<string>>(new Set());
  readonly iconId = computed(() => this.icons.unitIdFor(this.name()));
  readonly framedImageUrl = computed(() => {
    const id = this.iconId();
    const ascension = this.ascension();
    return id !== null && ascension
      ? this.icons.framedIconUrl(id, ascension, this.investment())
      : null;
  });
  readonly imageCandidates = computed(() => {
    const id = this.iconId();
    const candidates = [
      this.framedImageUrl(),
      this.imageUrl(),
      id === null ? null : this.icons.iconUrl(id),
    ];
    return [...new Set(candidates.filter((url): url is string => !!url))];
  });
  readonly imageSrc = computed(() => {
    const failed = this.failedUrls();
    return this.imageCandidates().find((url) => !failed.has(url)) ?? null;
  });
  readonly isFramed = computed(() => this.imageSrc() !== null && this.imageSrc() === this.framedImageUrl());
  readonly initials = computed(() =>
    this.name().split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase(),
  );

  markImageFailed(url: string): void {
    this.failedUrls.update((failed) => new Set(failed).add(url));
  }
}
