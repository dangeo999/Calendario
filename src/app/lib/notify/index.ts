// src/app/lib/notify/index.ts
// Dispatcher dei canali di notifica.
//
// APPROVAL_CHANNELS (csv) sceglie i canali attivi. Default: "email".
// Per attivare WhatsApp: APPROVAL_CHANNELS="email,whatsapp" (o solo "whatsapp").
// Un canale elencato ma non configurato viene semplicemente saltato.

import type { ApprovalRequest, DecisionNotice, NotificationChannel } from './types'
import { emailChannel } from './email'
import { whatsappChannel } from './whatsapp'

const ALL: Record<string, NotificationChannel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
}

export function activeChannels(): NotificationChannel[] {
  const wanted = (process.env.APPROVAL_CHANNELS || 'email')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  return wanted
    .map(name => ALL[name])
    .filter((c): c is NotificationChannel => Boolean(c) && c.isConfigured())
}

export type DispatchResult = {
  delivered: string[]
  failed: { channel: string; error: string }[]
}

/** Invia su tutti i canali attivi. Non lancia: riporta cosa e' andato storto. */
export async function dispatchApprovalRequest(
  req: ApprovalRequest
): Promise<DispatchResult> {
  const channels = activeChannels()
  const delivered: string[] = []
  const failed: { channel: string; error: string }[] = []

  await Promise.all(
    channels.map(async ch => {
      try {
        await ch.sendApprovalRequest(req)
        delivered.push(ch.name)
      } catch (err: any) {
        console.error(`[notify:${ch.name}] invio fallito`, err)
        failed.push({ channel: ch.name, error: String(err?.message || err) })
      }
    })
  )

  if (channels.length === 0) {
    failed.push({ channel: 'nessuno', error: 'Nessun canale di notifica configurato' })
  }

  return { delivered, failed }
}

/** Conferma al responsabile. Best-effort: gli errori vengono solo loggati. */
export async function dispatchDecisionAck(notice: DecisionNotice): Promise<void> {
  await Promise.all(
    activeChannels().map(async ch => {
      if (!ch.sendDecisionAck) return
      try {
        await ch.sendDecisionAck(notice)
      } catch (err) {
        console.error(`[notify:${ch.name}] ack fallito`, err)
      }
    })
  )
}

export type { ApprovalRequest, DecisionNotice, NotificationChannel }
