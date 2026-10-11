import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

export const supabaseConfigured = Boolean(environment.supabaseUrl && environment.supabaseKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  })
  : null;
