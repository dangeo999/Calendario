// src/app/api/approvals/whatsapp-webhook/route.ts
// Webhook Meta WhatsApp Cloud API: riceve il tap sui bottoni del template.
//
// URL da inserire in Meta:  https://<dominio>/api/approvals/whatsapp-webhook
// Campo da sottoscrivere:   messages
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { eventTypeLabel, periodLabel } from '@/app/lib/approvals'
import type { ApprovalDecision } from '@/app/lib/approvals'
import { applyDecision } from '@/app/lib/approvals.server'
import { dispatchDecisionAck } from '@/app/lib/notify'
import { sendWhatsappText, whatsappApproverPhone } from '@/app/lib/notify/whatsapp'

// ---------------------------------------------------------------------
// GET — handshake di verifica di Meta
// ---------------------------------------------------------------------
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (
    verifyToken &&
    q.get('hub.mode') === 'subscribe' &&
    q.get('hub.verify_token') === verifyToken
  ) {
    return new NextResponse(q.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ---------------------------------------------------------------------
// POST — eventi in arrivo
// ---------------------------------------------------------------------
function signatureValid(raw: string, header: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  // Senza app secret configurato non si puo' verificare: rifiuta.
  if (!appSecret) return false
  if (!header?.startsWith('sha256=')) return false

  const expected = crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')
  const a = Buffer.from(header.slice('sha256='.length), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Estrae `APPROVED:<uuid>` / `REJECTED:<uuid>` dal payload del bottone. */
function parsePayload(raw: unknown): { decision: ApprovalDecision; eventId: string } | null {
  const m = /^(APPROVED|REJECTED):(.+)$/.exec(String(raw ?? '').trim())
  if (!m) return null
  return { decision: m[1] as ApprovalDecision, eventId: m[2] }
}

export async function POST(req: Request) {
  const raw = await req.text()

  if (!signatureValid(raw, req.headers.get('x-hub-signature-256'))) {
    console.warn('[whatsapp-webhook] firma non valida')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Da qui in poi rispondiamo sempre 200: un non-200 fa ripartire i retry di Meta.
  try {
    const body = JSON.parse(raw)
    const approver = whatsappApproverPhone()

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const msg of change?.value?.messages ?? []) {
          const payload =
            msg?.type === 'button'
              ? msg?.button?.payload
              : msg?.interactive?.button_reply?.id

          const parsed = parsePayload(payload)
          if (!parsed) continue

          // Solo il numero del responsabile puo' decidere.
          const from = String(msg?.from ?? '').replace(/[^\d]/g, '')
          if (approver && from !== approver) {
            console.warn(`[whatsapp-webhook] decisione ignorata da numero ${from}`)
            continue
          }

          const outcome = await applyDecision(parsed.eventId, parsed.decision, {
            channel: 'whatsapp',
          })

          if (!outcome.ok) {
            await sendWhatsappText(`⚠️ ${outcome.message}`).catch(() => {})
            continue
          }
          if (outcome.alreadyDecided) continue

          const { event } = outcome
          await dispatchDecisionAck({
            eventId: event.id,
            requesterName: event.requester_name,
            typeLabel: eventTypeLabel(event.type),
            periodLabel: periodLabel(event),
            decision: parsed.decision,
          }).catch(() => {})
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp-webhook] errore elaborazione', err)
  }

  return NextResponse.json({ ok: true })
}
