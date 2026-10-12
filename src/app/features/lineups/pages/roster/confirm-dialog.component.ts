import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CdkTrapFocus, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="presentation" (click)="cancelled.emit()">
      <section class="panel confirmation-panel" role="alertdialog" aria-modal="true" aria-labelledby="roster-confirmation-title" aria-describedby="roster-confirmation-message" cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (click)="$event.stopPropagation()">
        <h2 id="roster-confirmation-title">{{ title() }}</h2>
        <p id="roster-confirmation-message">{{ message() }}</p>
        <div class="row-wrap">
          <button mat-button type="button" class="btn" (click)="cancelled.emit()">Cancel</button>
          <button mat-flat-button type="button" class="btn primary" (click)="confirmed.emit()">Yes, continue</button>
        </div>
      </section>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancelled.emit();
  }
}
