import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MODE_PATHS } from '../../../app.routes';
import { AuthService } from '../../../core/auth/auth.service';
import { LineupCardComponent } from '../components/lineup-card/lineup-card.component';
import { LineupsStore } from '../lineups.store';

@Component({
  selector: 'app-lineup-detail-page',
  standalone: true,
  imports: [LineupCardComponent, MatButtonModule, RouterLink],
  template: `
    <main class="submit-page lineup-detail">
      @if (loading()) {
        <div class="empty">
          <p class="empty-message" role="status">Loading lineup…</p>
          <a mat-button class="btn" routerLink="/">Back to lineups</a>
        </div>
      } @else if (loadError()) {
        <div class="empty">
          <p class="empty-message" role="alert">{{ loadError() }}</p>
          <a mat-button class="btn" routerLink="/">Back to lineups</a>
        </div>
      } @else if (row()) {
        @let current = row()!;
        <div class="panel-header">
          <h2>{{ modeName() }} lineup</h2>
          <a mat-button class="btn" [routerLink]="modePath()">Back to lineups</a>
        </div>
        <div #capture class="export-frame" [class.exporting]="exporting()">
          <app-lineup-card
            [row]="current"
            scope="all"
            [detail]="true"
            [hideActions]="exporting()"
            [voted]="store.votes().has(current.submission.id)"
            [voteCount]="store.voteCount(current.submission)"
            (vote)="store.toggleVote($event)"
            (share)="store.shareLineup($event)"
          />
        </div>
        <div class="row-wrap modal-actions">
          <button mat-flat-button type="button" class="btn primary" [disabled]="exporting()" (click)="exportImage()">
            {{ exporting() ? 'Preparing image…' : 'Download image' }}
          </button>
        </div>
      } @else {
        <div class="empty">
          <p class="empty-message">That lineup could not be found. It may have been removed.</p>
          <a mat-button class="btn" routerLink="/">Back to lineups</a>
        </div>
      }
    </main>
  `,
  styles: `
    .export-frame { padding: 0; background: var(--app-bg); }
    .lineup-detail .modal-actions { display: flex; justify-content: flex-end; margin-top: var(--app-space-3); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupDetailPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly capture = viewChild<ElementRef<HTMLElement>>('capture');
  readonly exporting = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  private readonly fetchedRow = signal<ReturnType<LineupsStore['evaluatedSubmission']>>(null);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => Number(params.get('id')))), { initialValue: NaN });
  readonly row = computed(() => this.store.evaluatedSubmission(this.id()) ?? this.fetchedRow());
  readonly modeName = computed(() => {
    const slug = this.row()?.submission.mode;
    return this.store.modes().find((mode) => mode.slug === slug)?.name ?? '';
  });
  readonly modePath = computed(() => MODE_PATHS[this.row()?.submission.mode ?? ''] ?? '/');

  constructor() {
    effect((onCleanup) => {
      const id = this.id();
      const cached = this.store.evaluatedSubmission(id);
      this.fetchedRow.set(null);
      this.loadError.set(null);
      if (cached || !this.auth.configured || !Number.isInteger(id) || id <= 0) {
        this.loading.set(false);
        return;
      }
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      this.loading.set(true);
      void this.store.loadSubmissionById(id).then(
        (result) => {
          if (cancelled) return;
          this.fetchedRow.set(result);
          this.loading.set(false);
        },
        (err: unknown) => {
          if (cancelled) return;
          this.loadError.set(err instanceof Error ? err.message : 'Could not load this lineup.');
          this.loading.set(false);
        },
      );
    });

    effect(() => {
      const row = this.row();
      if (!row) return;
      this.title.setTitle(`${row.submission.target} lineup · AFK Arena Team Lineups`);
      this.meta.updateTag({
        name: 'description',
        content: `${this.modeName()} lineup for ${row.submission.target}, shared by ${row.submission.by}.`,
      });
    });
  }

  async exportImage(): Promise<void> {
    const node = this.capture()?.nativeElement;
    const row = this.row();
    if (!node || !row) return;
    this.exporting.set(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const { toPng } = await import('html-to-image');
      const background = getComputedStyle(document.body).backgroundColor;
      const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: background, cacheBust: true });
      const link = document.createElement('a');
      const slug = `${row.submission.mode}-${row.submission.target}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      link.download = `afk-${slug}-${row.submission.id}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      this.store.showToast('Could not create the image. Check that the CDN icons are available, then try again.');
    } finally {
      this.exporting.set(false);
    }
  }
}
