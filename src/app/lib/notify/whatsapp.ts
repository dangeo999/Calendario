// src/app/lib/notify/whatsapp.ts
// Meta WhatsApp Cloud API. Attivo solo se le env var sono presenti.
import type { AbsenceNotice, NotificationChannel } from './types'

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
   * Template `richiesta_assenza` (categoria UTILITY), corpo con 5 variabili,
   * nessun bottone: e' una notifica informativa.
   * Vedi docs/notifiche-assenze.md per il testo esatto da sottomettere a Meta.
   */
  async sendAbsenceNotice(n: AbsenceNotice) {
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
              { type: 'text', text: p(n.requesterName) },
              { type: 'text', text: p(n.typeLabel) },
              { type: 'text', text: p(n.periodLabel) },
              { type: 'text', text: p(n.detailLabel) },
              { type: 'text', text: p(n.note || 'nessuna') },
            ],
          },
        ],
      },
    })
  },
}
