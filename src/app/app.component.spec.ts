import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { SubmitPageComponent } from './features/lineups/pages/submit-page.component';
import { LineupsStore } from './features/lineups/lineups.store';
import { HeroIconService } from './core/hero-icons/hero-icon.service';
import { UserDataService } from './core/data/user-data.service';
import { provideRouter } from '@angular/router';
import { AuthService, DUPLICATE_SIGNUP_MESSAGE } from './core/auth/auth.service';
import { User } from '@supabase/supabase-js';
import { APP_ROUTES } from './app.routes';

describe('SubmitPageComponent', () => {
  it('does not show a mercenary control when creating a Twisted Realm team', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();
    TestBed.inject(LineupsStore).changeDraftMode('twisted-realm');
    fixture.detectChanges();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('label')) as HTMLLabelElement[];
    expect(labels.some((label) => label.textContent?.includes('Mercenary'))).toBeFalse();
    fixture.destroy();
  });

  describe('AppComponent account form', () => {
    it('blocks short passwords with a clear minimum-length validation', async () => {
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(APP_ROUTES),
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
          { provide: UserDataService, useValue: { configured: false } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(AppComponent);
      const component = fixture.componentInstance;
      component.openAccount();
      component.accountMode.set('sign-up');
      component.accountForm.setValue({ email: 'player@example.com', password: 'short1' });
      component.accountForm.controls.password.markAsDirty();
      fixture.detectChanges();

      expect(component.accountForm.invalid).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('Use at least 8 characters.');
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeTrue();
      expect(getComputedStyle(fixture.nativeElement.querySelector('.account-actions')).display).toBe('grid');

      component.accountForm.controls.email.setValue('not-an-email');
      component.accountForm.controls.password.setValue('long-enough-password');
      fixture.detectChanges();
      expect(component.accountForm.invalid).toBeTrue();
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeTrue();

      component.accountForm.controls.email.setValue('player@example.com');
      fixture.detectChanges();
      component.accountForm.controls.password.setValue('long-enough-password');
      fixture.detectChanges();
      expect(component.accountForm.valid).toBeTrue();
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeFalse();
      fixture.destroy();
    });

    it('displays a duplicate account error message when signing up with an existing email', async () => {
      const authMock = {
        error: signal<string | null>(null),
        user: signal<User | null>(null),
        ready: signal(true),
        configured: true,
        clearError() {
          this.error.set(null);
        },
        signUp: jasmine.createSpy('signUp').and.callFake(async () => {
          authMock.error.set(DUPLICATE_SIGNUP_MESSAGE);
        }),
      };
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(APP_ROUTES),
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
          { provide: UserDataService, useValue: { configured: false } },
          { provide: AuthService, useValue: authMock },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(AppComponent);
      const component = fixture.componentInstance;
      component.openAccount();
      component.selectAccountMode('sign-up');
      component.accountForm.setValue({ email: 'player@example.com', password: 'long-enough-password' });
      fixture.detectChanges();

      await component.submitAccount();
      fixture.detectChanges();

      expect(authMock.signUp).toHaveBeenCalledWith('player@example.com', 'long-enough-password');
      expect(component.accountMessage()).toBeNull();
      expect(component.auth.error()).toBe(DUPLICATE_SIGNUP_MESSAGE);
      const errorEl = fixture.nativeElement.querySelector('.auth-error');
      expect(errorEl?.textContent).toContain(DUPLICATE_SIGNUP_MESSAGE);
      expect(fixture.nativeElement.querySelector('.account-message')).toBeNull();

      component.selectAccountMode('sign-in');
      fixture.detectChanges();
      expect(component.auth.error()).toBeNull();
      expect(fixture.nativeElement.querySelector('.auth-error')).toBeNull();
      fixture.destroy();
    });
  });
});
