import { Injectable, signal } from '@angular/core';
import { AuthChangeEvent, AuthError, Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../supabase/supabase-client';

export const DUPLICATE_SIGNUP_MESSAGE = 'An account with this email already exists. Sign in instead.';

export function isDuplicateSignup(
  error: Pick<AuthError, 'code' | 'message'> | null,
  userOrIdentities: Partial<Omit<User, 'identities'>> & { identities?: readonly unknown[] | null } | readonly unknown[] | null | undefined,
): boolean {
  if (error) {
    return (
      error.code === 'user_already_exists' ||
      error.code === 'email_exists' ||
      error.code === 'identity_already_exists' ||
      /already (registered|exists)/i.test(error.message)
    );
  }

  if (!userOrIdentities) {
    return false;
  }

  if (Array.isArray(userOrIdentities)) {
    return userOrIdentities.length === 0;
  }

  const user = userOrIdentities as Partial<User>;

  // 1. Obfuscated user returned by Supabase when email confirmations are enabled
  if (user.identities && Array.isArray(user.identities) && user.identities.length === 0) {
    return true;
  }

  // 2. An existing user that has already confirmed their email or previously signed in
  if (user.email_confirmed_at || user.confirmed_at || user.last_sign_in_at) {
    return true;
  }

  // 3. User record was created more than 10 seconds ago
  if (user.created_at) {
    const createdMs = Date.parse(user.created_at);
    if (!Number.isNaN(createdMs) && Date.now() - createdMs > 10_000) {
      return true;
    }
  }

  // 4. Primary identity was created more than 10 seconds ago
  const firstIdentity = user.identities?.[0] as { created_at?: string } | undefined;
  if (firstIdentity?.created_at) {
    const idCreatedMs = Date.parse(firstIdentity.created_at);
    if (!Number.isNaN(idCreatedMs) && Date.now() - idCreatedMs > 10_000) {
      return true;
    }
  }

  return false;
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
    this.clearError();

    try {
      const { data: exists } = await supabase.rpc('email_exists', { p_email: email });
      if (exists === true) {
        return this.reportError(DUPLICATE_SIGNUP_MESSAGE);
      }
    } catch {
      // Fallback if RPC is not present in database
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return this.reportError(
        isDuplicateSignup(error, null) ? DUPLICATE_SIGNUP_MESSAGE : error.message,
      );
    }
    if (data.user && (!data.session || isDuplicateSignup(null, data.user))) {
      if (isDuplicateSignup(null, data.user)) {
        return this.reportError(DUPLICATE_SIGNUP_MESSAGE);
      }
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
