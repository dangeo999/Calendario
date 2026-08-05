// src/app/lib/approvals.server.ts
// Token firmati + applicazione della decisione. Solo lato server.

import crypto from 'crypto'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import type { ApprovalDecision, ApprovalStatus } from '@/app/lib/approvals'
import { needsApproval } from '@/app/lib/approvals'

if (typeof window !== 'undefined') {
  throw new Error('approvals.server deve essere usato solo sul server')
}

const TOKEN_TTL_DAYS = 60

function secret(): string {
  const s = process.env.APPROVAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('Missing APPROVAL_SECRET (o SUPABASE_SERVICE_ROLE_KEY)')
  return s
}

const b64url = (b: Buffer) => b.toString('base64url')

/** Token opaco e firmato: <payload>.<hmac>. Non richiede stato sul DB. */
export function signApprovalToken(eventId: string, decision: ApprovalDecision): string {
  const payload = {
    e: eventId,
    d: decision,
    x: Math.floor(Date.now() / 1000) + TOKEN_TTL_DAYS * 86400,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyApprovalToken(
  token: string
): { eventId: string; decision: ApprovalDecision } | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts

  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!p?.e || (p.d !== 'APPROVED' && p.d !== 'REJECTED')) return null
    if (typeof p.x !== 'number' || p.x < Math.floor(Date.now() / 1000)) return null
    return { eventId: String(p.e), decision: p.d }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// Lettura evento + profilo richiedente
// ---------------------------------------------------------------------
export type EventWithRequester = {
  id: string
  user_id: string
  type: string
  note: string | null
  starts_at: string
  ends_at: string
  permesso_hours: number | null
  status: ApprovalStatus
  requester_name: string
}

export async function loadEvent(eventId: string): Promise<EventWithRequester | null> {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, user_id, type, note, starts_at, ends_at, permesso_hours, status')
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
// Applicazione decisione — idempotente
// ---------------------------------------------------------------------
export type DecisionOutcome =
  | { ok: true; event: EventWithRequester; alreadyDecided: boolean }
  | { ok: false; reason: 'not_found' | 'not_approvable' | 'conflict' | 'error'; message: string }

export async function applyDecision(
  eventId: string,
  decision: ApprovalDecision,
  opts: { channel: string; deciderId?: string | null }
): Promise<DecisionOutcome> {
  const event = await loadEvent(eventId)
  if (!event) {
    return { ok: false, reason: 'not_found', message: 'Richiesta non trovata o gia rimossa.' }
  }
  if (!needsApproval(event.type)) {
    return {
      ok: false,
      reason: 'not_approvable',
      message: 'Questa tipologia di evento non richiede approvazione.',
    }
  }

  // Gia' decisa: idempotente se la decisione coincide, conflitto altrimenti.
  if (event.status !== 'PENDING') {
    if (event.status === decision) {
      return { ok: true, event, alreadyDecided: true }
    }
    return {
      ok: false,
      reason: 'conflict',
      message:
        event.status === 'APPROVED'
          ? 'Questa richiesta risulta gia approvata.'
          : 'Questa richiesta risulta gia rifiutata.',
    }
  }

  const { data: updated, error } = await supabaseAdmin
    .from('events')
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: opts.deciderId ?? null,
      decision_channel: opts.channel,
    })
    .eq('id', eventId)
    .eq('status', 'PENDING') // guardia anti doppio-click / retry webhook
    .select('id')

  if (error) {
    return { ok: false, reason: 'error', message: error.message }
  }

  // Zero righe: qualcun altro ha deciso fra la lettura e la scrittura.
  if (!updated?.length) {
    const fresh = await loadEvent(eventId)
    if (fresh && fresh.status === decision) {
      return { ok: true, event: fresh, alreadyDecided: true }
    }
    return {
      ok: false,
      reason: 'conflict',
      message: 'La richiesta e stata gestita da qualcun altro nel frattempo.',
    }
  }

  return { ok: true, event: { ...event, status: decision }, alreadyDecided: false }
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
