import { CdkTrapFocus } from '@angular/cdk/a11y'
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, ViewEncapsulation, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { User } from '@supabase/supabase-js';
import { filter } from 'rxjs';
import { MODE_PATHS } from './app.routes';
import { AuthService } from './core/auth/auth.service'
import { HeroIconComponent } from './core/hero-icons/hero-icon.component'
import { HeroIconService } from './core/hero-icons/hero-icon.service'
import { LineupsStore } from './features/lineups/lineups.store'
import { DraftFormation, ModeConfig, UPCOMING_MODES } from './features/lineups/models'

type ThemeMode = 'system' | 'light' | 'dark';

// Styles are global (not emulated) so the routed page components share the same design tokens and classes.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CdkTrapFocus, HeroIconComponent, MatButtonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  private readonly heroIcons = inject(HeroIconService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly upcomingModes = UPCOMING_MODES;
  readonly theme = signal<ThemeMode>('system');
  readonly onRoster = signal(false);
  readonly accountOpen = signal(false);
  readonly accountMode = signal<'sign-in' | 'sign-up'>('sign-in');
  readonly accountBusy = signal(false);
  readonly accountMessage = signal<string | null>(null);

  readonly submissionForm = new FormGroup({
    target: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
    damage: new FormControl('', { nonNullable: true }),
    placementType: new FormControl<'rank' | 'percent'>('rank', { nonNullable: true }),
    placementValue: new FormControl('', { nonNullable: true }),
  });
  readonly accountForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });

  constructor() {
    void this.heroIcons.initialize();
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onRoster.set(this.routePath().startsWith('roster')));
    this.onRoster.set(this.routePath().startsWith('roster'));
    this.submissionForm.controls.target.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => this.store.updateDraftTarget(target));
    this.auth.onUserChange((user) => {
      void this.initializePageData(user);
      this.accountMessage.set(null);
      if (user) this.accountOpen.set(false);
    });
    void this.auth.initialize().then(() => this.initializePageData(this.auth.user()));
    this.readTheme();
  }

  openSubmission(): void {
    this.store.openDraft();
    this.resetSubmissionForm();
    void this.store.loadCollections();
  }

  openAccount(): void {
    this.accountOpen.set(true);
    this.accountMode.set('sign-in');
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  closeAccount(): void {
    this.accountOpen.set(false);
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  selectAccountMode(mode: 'sign-in' | 'sign-up'): void {
    this.accountMode.set(mode);
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  async submitAccount(): Promise<void> {
    this.accountBusy.set(true);
    this.accountMessage.set(null);
    this.auth.clearError();
    const { email, password } = this.accountForm.getRawValue();
    try {
      if (this.accountMode() === 'sign-up') {
        await this.auth.signUp(email.trim(), password);
        if (!this.auth.error()) {
          this.accountMessage.set(this.auth.user()
            ? 'Account created and signed in.'
            : 'Check your email to confirm your account, then sign in.');
        }
      } else {
        await this.auth.signIn(email.trim(), password);
      }
    } finally {
      this.accountBusy.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.accountBusy.set(true);
    try {
      await this.auth.signInWithGoogle();
    } finally {
      this.accountBusy.set(false);
    }
  }

  async linkGoogle(): Promise<void> {
    this.accountBusy.set(true);
    this.auth.clearError();
    try {
      await this.auth.linkGoogle();
    } finally {
      this.accountBusy.set(false);
    }
  }

  async signOut(): Promise<void> {
    if (await this.auth.signOut()) this.closeAccount();
  }

  closeDialog(): void {
    this.store.closeDraft();
  }

  navigateToMode(slug: string): void {
    this.store.setMode(slug);
    void this.router.navigateByUrl(this.modePath(slug));
  }

  changeDraftMode(slug: string): void {
    this.store.changeDraftMode(slug);
    this.resetSubmissionForm();
  }

  submitLineup(): void {
    this.store.submitDraft(this.submissionForm.getRawValue());
  }

  private async initializePageData(user: User | null): Promise<void> {
    await this.store.initializeBackend(user);
    const path = this.routePath();
    if (path.startsWith('roster')) await this.store.loadRosterDetails();
    if (path === 'roster/collections' || this.store.draft()) await this.store.loadCollections();
  }

  private routePath(): string {
    return this.router.url.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
  }

  private modePath(slug: string): string {
    const path = MODE_PATHS[slug];
    if (!path) throw new Error(`No route is configured for game mode "${slug}".`);
    return path;
  }

  nullableNumberValue(event: Event): number | null {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isInteger(value) ? value : null;
  }

  petIdValue(event: Event): number | null {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.value === '') return null;
    const petId = Number(select.value);
    return Number.isInteger(petId) && this.store.pets().some((pet) => pet.id === petId) ? petId : null;
  }

  inputValue(event: Event): string {
    const input = event.target;
    return input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input.value : '';
  }

  hasGoogleLinked(): boolean {
    return !!this.auth.user()?.identities?.some((identity) => identity.provider === 'google');
  }

  checkboxValue(event: Event): boolean {
    const input = event.target;
    return input instanceof HTMLInputElement && input.checked;
  }

  modeFor(slug: string): ModeConfig {
    const mode = this.store.modes().find((entry) => entry.slug === slug);
    if (!mode) throw new Error(`Unknown game mode: ${slug}`);
    return mode;
  }

  filledSlots(formation: DraftFormation): number {
    return formation.slots.filter((slot) => slot.hid !== null).length;
  }

  toggleTheme(): void {
    const nextTheme: ThemeMode = this.theme() === 'system' ? 'dark' : this.theme() === 'dark' ? 'light' : 'system';
    this.theme.set(nextTheme);
    this.applyTheme(nextTheme);
    try {
      localStorage.setItem('ll.theme', nextTheme);
    } catch (error) {
      console.warn('Could not save the selected theme.', error);
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeDialog();
      this.closeAccount();
    }
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.store.draft()) this.closeDialog();
    if (this.accountOpen()) this.closeAccount();
  }

  private resetSubmissionForm(): void {
    const draft = this.store.draft();
    if (!draft) return;
    this.submissionForm.reset({
      target: draft.target,
      notes: draft.notes,
      damage: '',
      placementType: 'rank',
      placementValue: '',
    });
  }

  private readTheme(): void {
    try {
      const savedTheme = localStorage.getItem('ll.theme');
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') {
        this.theme.set(savedTheme);
      }
    } catch (error) {
      console.warn('Could not read the saved theme.', error);
    }
    this.applyTheme(this.theme());
  }

  private applyTheme(theme: ThemeMode): void {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }
}
