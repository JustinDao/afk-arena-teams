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
import { HeroIconService } from './core/hero-icons/hero-icon.service'
import { LineupsStore } from './features/lineups/lineups.store'
import { UPCOMING_MODES } from './features/lineups/models'

type ThemeMode = 'system' | 'light' | 'dark';

// Styles are global (not emulated) so the routed page components share the same design tokens and classes.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CdkTrapFocus, MatButtonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
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

  readonly accountForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });

  constructor() {
    void this.heroIcons.initialize();
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const path = this.routePath();
        this.onRoster.set(path.startsWith('roster'));
        if (path === 'submit') void this.store.loadCollections();
      });
    this.onRoster.set(this.routePath().startsWith('roster'));
    this.auth.onUserChange((user) => {
      void this.initializePageData(user);
      this.accountMessage.set(null);
      if (user) this.accountOpen.set(false);
    });
    void this.auth.initialize().then(() => this.initializePageData(this.auth.user()));
    this.readTheme();
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

  navigateToMode(slug: string): void {
    this.store.setMode(slug);
    void this.router.navigateByUrl(this.modePath(slug));
  }

  private async initializePageData(user: User | null): Promise<void> {
    await this.store.initializeBackend(user);
    const path = this.routePath();
    if (path.startsWith('roster')) await this.store.loadRosterDetails();
    if (path === 'roster/collections' || path === 'submit') await this.store.loadCollections();
  }

  private routePath(): string {
    return this.router.url.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
  }

  private modePath(slug: string): string {
    const path = MODE_PATHS[slug];
    if (!path) throw new Error(`No route is configured for game mode "${slug}".`);
    return path;
  }

  hasGoogleLinked(): boolean {
    return !!this.auth.user()?.identities?.some((identity) => identity.provider === 'google');
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
    if (event.target === event.currentTarget) this.closeAccount();
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.accountOpen()) this.closeAccount();
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
