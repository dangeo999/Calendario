// src/app/lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js'

// questa libreria DEVE girare solo lato server
if (typeof window !== 'undefined') {
  throw new Error('supabaseAdmin deve essere usato solo sul server')
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'hr-mini-admin' } },
})
