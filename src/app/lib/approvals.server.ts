// src/app/lib/approvals.server.ts
// Lettura evento + richiedente per le notifiche al responsabile. Solo lato server.

import { supabaseAdmin } from '@/app/lib/supabaseAdmin'

if (typeof window !== 'undefined') {
  throw new Error('approvals.server deve essere usato solo sul server')
}

export type EventWithRequester = {
  id: string
  user_id: string
  type: string
  note: string | null
  starts_at: string
  ends_at: string
  permesso_hours: number | null
  requester_name: string
}

export async function loadEvent(eventId: string): Promise<EventWithRequester | null> {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, user_id, type, note, starts_at, ends_at, permesso_hours')
    .eq('id', eventId)
    .maybeSingle()

  if (error || !event) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', event.user_id)
    .maybeSingle()

  return {
    ...(event as any),
    requester_name:
      profile?.full_name || profile?.email || String(event.user_id).slice(0, 8),
  }
}

// ---------------------------------------------------------------------
// URL base dell'app (per i link nelle notifiche)
// ---------------------------------------------------------------------
export function appBaseUrl(req?: Request): string {
  const fromEnv = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/+$/, '')

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`

  if (req) {
    const h = req.headers
    const host = h.get('x-forwarded-host') || h.get('host')
    const proto = h.get('x-forwarded-proto') || 'https'
    if (host) return `${proto}://${host}`
  }
  return 'http://localhost:3000'
}
