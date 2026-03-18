import { createBrowserClient } from '@supabase/ssr'

// Client-side Supabase client (uses anon key)
// DIFFERENT from src/lib/supabase.ts which uses service role key for server-side
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
