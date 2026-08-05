// src/app/api/approvals/decide/route.ts
//
//  GET  ?token=...            -> pagina di conferma (link nella mail)
//  POST form-encoded token    -> applica la decisione (submit della pagina)
//  POST JSON + Bearer         -> applica la decisione dall'app (solo admin)
//
// Il doppio passaggio GET -> POST evita che uno scanner antispam o un
// prefetch del client di posta approvi una richiesta senza intervento umano.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { eventTypeLabel, periodLabel, detailLabel } from '@/app/lib/approvals'
import type { ApprovalDecision } from '@/app/lib/approvals'
import { applyDecision, loadEvent, verifyApprovalToken } from '@/app/lib/approvals.server'
import { dispatchDecisionAck } from '@/app/lib/notify'

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function page(opts: {
  title: string
  accent: string
  icon: string
  lines: string[]
  body?: string
  status?: number
}) {
  const html = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(opts.title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
  .card{width:100%;max-width:440px;background:#fff;border-radius:20px;overflow:hidden;
        box-shadow:0 4px 24px rgba(15,23,42,.10)}
  .head{padding:26px 24px;background:${opts.accent};color:#fff;text-align:center}
  .head .ico{font-size:40px;line-height:1}
  .head h1{margin:10px 0 0;font-size:19px;font-weight:700}
  .body{padding:22px 24px 26px}
  .row{display:flex;gap:10px;padding:9px 0;border-top:1px solid #eef2f7;font-size:14px}
  .row:first-child{border-top:none}
  .row b{min-width:96px;color:#64748b;font-weight:500}
  .row span{font-weight:600}
  .btns{display:flex;gap:10px;margin-top:20px}
  button{flex:1;padding:14px;border:none;border-radius:13px;font-size:15px;font-weight:700;
         cursor:pointer;font-family:inherit;color:#fff;background:${opts.accent}}
  .ghost{background:#fff;color:#64748b;border:2px solid #e2e8f0}
  .note{margin-top:16px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.5}
</style></head>
<body><div class="card">
  <div class="head"><div class="ico">${opts.icon}</div><h1>${esc(opts.title)}</h1></div>
  <div class="body">
    ${opts.lines.join('')}
    ${opts.body ?? ''}
  </div>
</div></body></html>`

  return new NextResponse(html, {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

const row = (label: string, value: unknown) =>
  `<div class="row"><b>${esc(label)}</b><span>${esc(value)}</span></div>`

const errorPage = (title: string, message: string, status = 400) =>
  page({
    title,
    accent: '#64748b',
    icon: '⚠️',
    lines: [`<div style="text-align:center;font-size:14px;color:#475569">${esc(message)}</div>`],
    status,
  })

// ---------------------------------------------------------------------
// GET — pagina di conferma
// ---------------------------------------------------------------------
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const parsed = verifyApprovalToken(token)
  if (!parsed) {
    return errorPage('Link non valido', 'Il link e scaduto oppure non e piu valido.', 400)
  }

  const event = await loadEvent(parsed.eventId)
  if (!event) {
    return errorPage('Richiesta non trovata', 'La richiesta e stata rimossa dal calendario.', 404)
  }

  const approving = parsed.decision === 'APPROVED'
  const accent = approving ? '#059669' : '#dc2626'

  if (event.status !== 'PENDING') {
    const gia = event.status === 'APPROVED' ? 'approvata' : 'rifiutata'
    return page({
      title: `Richiesta gia ${gia}`,
      accent: '#64748b',
      icon: 'ℹ️',
      lines: [
        row('Dipendente', event.requester_name),
        row('Tipo', eventTypeLabel(event.type)),
        row('Periodo', periodLabel(event)),
        `<div class="note">Nessuna azione necessaria.</div>`,
      ],
    })
  }

  return page({
    title: approving ? 'Confermi l’approvazione?' : 'Confermi il rifiuto?',
    accent,
    icon: approving ? '✅' : '❌',
    lines: [
      row('Dipendente', event.requester_name),
      row('Tipo', eventTypeLabel(event.type)),
      row('Periodo', periodLabel(event)),
      row('Durata', detailLabel(event)),
      ...(event.note ? [row('Nota', event.note)] : []),
    ],
    body: `
      <form method="POST" action="/api/approvals/decide">
        <input type="hidden" name="token" value="${esc(token)}">
        <div class="btns">
          <button type="submit">${approving ? 'Approva' : 'Rifiuta'}</button>
        </div>
      </form>
      <div class="note">La decisione aggiorna subito il calendario.</div>`,
  })
}

// ---------------------------------------------------------------------
// POST — applica la decisione
// ---------------------------------------------------------------------
export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || ''

  // --- Percorso app: JSON + Bearer, riservato agli admin ---
  if (contentType.includes('application/json')) {
    try {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
      if (!jwt) return NextResponse.json({ ok: false, error: 'Non autenticato' }, { status: 401 })

      const { data: userData } = await supabaseAdmin.auth.getUser(jwt)
      const user = userData?.user
      if (!user) return NextResponse.json({ ok: false, error: 'Sessione non valida' }, { status: 401 })

      const { data: me } = await supabaseAdmin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle()
      if (!me?.is_admin) {
        return NextResponse.json({ ok: false, error: 'Solo il responsabile puo approvare' }, { status: 403 })
      }

      const { eventId, decision } = await req.json().catch(() => ({}))
      if (!eventId || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
        return NextResponse.json({ ok: false, error: 'Parametri non validi' }, { status: 400 })
      }

      const outcome = await applyDecision(String(eventId), decision as ApprovalDecision, {
        channel: 'app',
        deciderId: user.id,
      })
      if (!outcome.ok) {
        return NextResponse.json({ ok: false, error: outcome.message }, { status: 409 })
      }
      return NextResponse.json({ ok: true, status: decision })
    } catch (err: any) {
      console.error('approvals/decide (json)', err)
      return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 })
    }
  }

  // --- Percorso mail: submit del form di conferma ---
  const form = await req.formData().catch(() => null)
  const token = String(form?.get('token') || '')
  const parsed = verifyApprovalToken(token)
  if (!parsed) {
    return errorPage('Link non valido', 'Il link e scaduto oppure non e piu valido.', 400)
  }

  const outcome = await applyDecision(parsed.eventId, parsed.decision, { channel: 'email' })
  if (!outcome.ok) {
    return errorPage(
      outcome.reason === 'conflict' ? 'Richiesta gia gestita' : 'Operazione non riuscita',
      outcome.message,
      outcome.reason === 'not_found' ? 404 : 409
    )
  }

  const { event } = outcome
  const approved = parsed.decision === 'APPROVED'

  if (!outcome.alreadyDecided) {
    await dispatchDecisionAck({
      eventId: event.id,
      requesterName: event.requester_name,
      typeLabel: eventTypeLabel(event.type),
      periodLabel: periodLabel(event),
      decision: parsed.decision,
    }).catch(() => {})
  }

  return page({
    title: approved ? 'Richiesta approvata' : 'Richiesta rifiutata',
    accent: approved ? '#059669' : '#dc2626',
    icon: approved ? '✅' : '❌',
    lines: [
      row('Dipendente', event.requester_name),
      row('Tipo', eventTypeLabel(event.type)),
      row('Periodo', periodLabel(event)),
      `<div class="note">Il calendario e stato aggiornato. Puoi chiudere questa pagina.</div>`,
    ],
  })
}
