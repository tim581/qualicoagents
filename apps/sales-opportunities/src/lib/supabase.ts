import { createClient, SupabaseClient } from '@supabase/supabase-js'

function readConfig() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || key === 'your_anon_key_here' || key === 'placeholder') {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local (or NEXT_PUBLIC_* on Vercel).'
    )
  }

  return { url, key }
}

export function createSupabaseClient(): SupabaseClient {
  const { url, key } = readConfig()
  return createClient(url, key)
}
