import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL
  ?? /supabaseUrl:\s*'([^']+)'/.exec(readFileSync(new URL('../src/environments/environment.ts', import.meta.url), 'utf8'))?.[1];
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard > Project Settings > API > service_role) in .env.local or your shell.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { error } = await supabase.rpc('refresh_recommendation_pool');
if (error) {
  console.error(`Refresh failed: ${error.message}`);
  process.exit(1);
}
const { data } = await supabase.from('recommendation_meta').select('refreshed_at').maybeSingle();
console.log(`Recommendation pool refreshed at ${data?.refreshed_at ?? 'unknown time'}.`);
