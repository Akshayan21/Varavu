import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// One shared auth client avoids competing refresh timers and session storage writes.
export const supabase = import.meta.env.VITE_DATA_MODE !== 'mock' && supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;
