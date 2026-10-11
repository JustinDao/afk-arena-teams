import { TestBed } from '@angular/core/testing';
import { AuthService, isDuplicateSignup } from './auth.service';

describe('AuthService', () => {
  it('recognizes duplicate signup errors and Supabase-obfuscated existing emails', () => {
    expect(isDuplicateSignup({ code: 'user_already_exists', message: 'User already registered' }, null)).toBeTrue();
    expect(isDuplicateSignup({ code: 'unexpected_error', message: 'Email already exists' }, null)).toBeTrue();
    expect(isDuplicateSignup(null, [])).toBeTrue();
    expect(isDuplicateSignup(null, [{ provider: 'email' }])).toBeFalse();
    expect(isDuplicateSignup({ code: 'weak_password', message: 'Password is too short' }, null)).toBeFalse();
    expect(isDuplicateSignup(null, { identities: [] })).toBeTrue();
    expect(isDuplicateSignup(null, { identities: [{ provider: 'email' }], email_confirmed_at: '2026-01-01T00:00:00Z' })).toBeTrue();
    expect(isDuplicateSignup(null, { identities: [{ provider: 'email' }], created_at: '2026-01-01T00:00:00Z' })).toBeTrue();
    expect(isDuplicateSignup(null, { identities: [{ provider: 'email' }], created_at: new Date().toISOString() })).toBeFalse();
  });

  it('clearly disables account operations until Supabase is configured', async () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(AuthService);
    if (service.configured) {
      expect(service.configured).toBeTrue();
      return;
    }
    await service.initialize();
    expect(service.configured).toBeFalse();
    expect(service.ready()).toBeTrue();
    await service.signIn('user@example.com', 'password123');
    expect(service.error()).toContain('Configure the Supabase URL');
  });
});
