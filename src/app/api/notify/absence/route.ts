// src/app/api/notify/absence/route.ts
// Notifica al responsabile una nuova assenza. Informativa: nessuna approvazione.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { eventTypeLabel, notifiesApprover, periodLabel, detailLabel } from '@/app/lib/approvals'
import { appBaseUrl, loadEvent } from '@/app/lib/approvals.server'
import { dispatchAbsenceNotice } from '@/app/lib/notify'

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

    if (!notifiesApprover(event.type)) {
      return NextResponse.json({ ok: true, skipped: 'tipo senza notifica' })
    }

    const result = await dispatchAbsenceNotice({
      eventId: event.id,
      requesterName: event.requester_name,
      typeLabel: eventTypeLabel(event.type),
      periodLabel: periodLabel(event),
      detailLabel: detailLabel(event),
      note: event.note,
      calendarUrl: `${appBaseUrl(req)}/calendar`,
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
    console.error('notify/absence', err)
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 })
  }
}
