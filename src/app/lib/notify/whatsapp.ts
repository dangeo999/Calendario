// src/app/lib/notify/whatsapp.ts
// Meta WhatsApp Cloud API. Attivo solo se le env var sono presenti.
import type { ApprovalRequest, DecisionNotice, NotificationChannel } from './types'

const GRAPH = () => process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID || ''
const TOKEN = () => process.env.WHATSAPP_ACCESS_TOKEN || ''
const TO = () => (process.env.WHATSAPP_APPROVER_PHONE || '').replace(/[^\d]/g, '')
const TEMPLATE = () => process.env.WHATSAPP_TEMPLATE_NAME || 'richiesta_assenza'
const LANG = () => process.env.WHATSAPP_TEMPLATE_LANG || 'it'

/** Meta rifiuta parametri con a-capo, tab o 4+ spazi consecutivi. */
const p = (s: unknown) => {
  const clean = String(s ?? '—').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()
  return clean.length ? clean.slice(0, 900) : '—'
}

async function graphPost(body: unknown) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH()}/${PHONE_ID()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    throw new Error(`WhatsApp Cloud API: ${msg}`)
  }
  return json
}

export const whatsappChannel: NotificationChannel = {
  name: 'whatsapp',

  isConfigured() {
    return Boolean(PHONE_ID() && TOKEN() && TO())
  },

  /**
   * Template `richiesta_assenza` (categoria UTILITY), corpo con 5 variabili
   * e due bottoni quick-reply. Vedi docs/approvazioni.md per il testo esatto
   * da sottomettere a Meta.
   */
  async sendApprovalRequest(r: ApprovalRequest) {
    await graphPost({
      messaging_product: 'whatsapp',
      to: TO(),
      type: 'template',
      template: {
        name: TEMPLATE(),
        language: { code: LANG() },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: p(r.requesterName) },
              { type: 'text', text: p(r.typeLabel) },
              { type: 'text', text: p(r.periodLabel) },
              { type: 'text', text: p(r.detailLabel) },
              { type: 'text', text: p(r.note || 'nessuna') },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: `APPROVED:${r.eventId}` }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: `REJECTED:${r.eventId}` }],
          },
        ],
      },
    })
  },

  /** Il tap sul bottone apre la finestra 24h: il testo libero qui e' gratuito. */
  async sendDecisionAck(n: DecisionNotice) {
    const esito = n.decision === 'APPROVED' ? '✅ Approvata' : '❌ Rifiutata'
    await graphPost({
      messaging_product: 'whatsapp',
      to: TO(),
      type: 'text',
      text: {
        body: `${esito}\n\n${n.requesterName} — ${n.typeLabel}\n${n.periodLabel}\n\nIl calendario e stato aggiornato.`,
      },
    })
  },
}

/** Invio di un testo libero al responsabile (solo dentro la finestra 24h). */
export async function sendWhatsappText(body: string) {
  if (!whatsappChannel.isConfigured()) return
  await graphPost({
    messaging_product: 'whatsapp',
    to: TO(),
    type: 'text',
    text: { body },
  })
}

export const whatsappApproverPhone = TO
