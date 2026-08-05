// src/app/api/approvals/request/route.ts
// Invia al responsabile la richiesta di approvazione di un evento PENDING.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { eventTypeLabel, needsApproval, periodLabel, detailLabel } from '@/app/lib/approvals'
import { appBaseUrl, loadEvent, signApprovalToken } from '@/app/lib/approvals.server'
import { dispatchApprovalRequest } from '@/app/lib/notify'

export async function POST(req: Request) {
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return NextResponse.json({ ok: false, error: 'Non autenticato' }, { status: 401 })
    }

    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(jwt)
    const user = userData?.user
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: 'Sessione non valida' }, { status: 401 })
    }

    const { eventId } = await req.json().catch(() => ({}))
    if (!eventId) {
      return NextResponse.json({ ok: false, error: 'eventId mancante' }, { status: 400 })
    }

    const event = await loadEvent(String(eventId))
    if (!event) {
      return NextResponse.json({ ok: false, error: 'Evento non trovato' }, { status: 404 })
    }

    // Solo il richiedente o un admin possono far partire la notifica.
    if (event.user_id !== user.id) {
      const { data: me } = await supabaseAdmin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle()
      if (!me?.is_admin) {
        return NextResponse.json({ ok: false, error: 'Non autorizzato' }, { status: 403 })
      }
    }

    if (!needsApproval(event.type)) {
      return NextResponse.json({ ok: true, skipped: 'tipo non soggetto ad approvazione' })
    }
    if (event.status !== 'PENDING') {
      return NextResponse.json({ ok: true, skipped: `evento gia ${event.status}` })
    }

    const base = appBaseUrl(req)
    const link = (decision: 'APPROVED' | 'REJECTED') =>
      `${base}/api/approvals/decide?token=${encodeURIComponent(
        signApprovalToken(event.id, decision)
      )}`

    const result = await dispatchApprovalRequest({
      eventId: event.id,
      requesterName: event.requester_name,
      typeLabel: eventTypeLabel(event.type),
      periodLabel: periodLabel(event),
      detailLabel: detailLabel(event),
      note: event.note,
      approveUrl: link('APPROVED'),
      rejectUrl: link('REJECTED'),
    })

    await supabaseAdmin
      .from('events')
      .update({
        notified_at: result.delivered.length ? new Date().toISOString() : null,
        notify_error: result.failed.length
          ? result.failed.map(f => `${f.channel}: ${f.error}`).join(' | ')
          : null,
      })
      .eq('id', event.id)

    if (!result.delivered.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.failed.map(f => `${f.channel}: ${f.error}`).join(' | ') ||
            'Nessun canale disponibile',
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed })
  } catch (err: any) {
    console.error('approvals/request', err)
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 })
  }
}
