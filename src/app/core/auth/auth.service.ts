import { Injectable, signal } from '@angular/core';
import { AuthChangeEvent, AuthError, Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../supabase/supabase-client';

const DUPLICATE_SIGNUP_MESSAGE = 'An account with this email already exists. Sign in instead.';

export function isDuplicateSignup(
  error: Pick<AuthError, 'code' | 'message'> | null,
  identities: readonly unknown[] | null | undefined,
): boolean {
  return error
    ? error.code === 'user_already_exists' ||
      error.code === 'email_exists' ||
      /already (registered|exists)/i.test(error.message)
    : identities?.length === 0;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<User | null>(null);
  private readonly readySignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private initialized = false;
  private readonly userListeners = new Set<(user: User | null) => void>();

  readonly user = this.userSignal.asReadonly();
  readonly ready = this.readySignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly configured = supabaseConfigured;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!supabase) {
      this.readySignal.set(true);
      return;
    }
    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      this.setUser(session?.user ?? null);
      this.readySignal.set(true);
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      this.reportError(error.message);
      this.readySignal.set(true);
      return;
    }
    this.setUser(data.session?.user ?? null);
    this.readySignal.set(true);
  }

  async signUp(email: string, password: string): Promise<void> {
    if (!supabase) return this.reportError('Configure the Supabase URL and public anon key before enabling accounts.');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return this.reportError(
        isDuplicateSignup(error, null) ? DUPLICATE_SIGNUP_MESSAGE : error.message,
      );
    }
    if (data.user && !data.session && isDuplicateSignup(null, data.user.identities)) {
      return this.reportError(DUPLICATE_SIGNUP_MESSAGE);
    }
    this.setUser(data.session?.user ?? null);
    this.clearError();
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!supabase) return this.reportError('Configure the Supabase URL and public anon key before enabling accounts.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return this.reportError(error.message);
    this.setUser(data.user);
    this.clearError();
  }

  async signInWithGoogle(): Promise<void> {
    if (!supabase) return this.reportError('Configure the Supabase URL and public anon key before enabling accounts.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) this.reportError(error.message);
  }

  async linkGoogle(): Promise<void> {
    if (!supabase || !this.userSignal()) {
      return this.reportError('Sign in with your email and password before linking Google.');
    }
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) this.reportError(error.message);
  }

  async signOut(): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.auth.signOut();
    if (error) {
      this.reportError(error.message);
      return false;
    }
    this.setUser(null);
    this.clearError();
    return true;
  }

  reportError(message: string): void {
    this.errorSignal.set(message);
  }

  clearError(): void {
    this.errorSignal.set(null);
  }

  onUserChange(listener: (user: User | null) => void): () => void {
    this.userListeners.add(listener);
    return () => this.userListeners.delete(listener);
  }

  private setUser(user: User | null): void {
    const previousUserId = this.userSignal()?.id ?? null;
    this.userSignal.set(user);
    if (previousUserId === (user?.id ?? null)) return;
    for (const listener of this.userListeners) listener(user);
  }
}
