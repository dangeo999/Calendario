// src/app/lib/notify/types.ts

export type AbsenceNotice = {
  eventId: string
  requesterName: string
  typeLabel: string
  periodLabel: string
  detailLabel: string
  note?: string | null
  /** Link al calendario, per aprire l'evento dall'email. */
  calendarUrl: string
}

export interface NotificationChannel {
  /** Identificativo usato nei log e in events.notify_error. */
  readonly name: string
  /** true se tutte le env var necessarie sono presenti. */
  isConfigured(): boolean
  /** Notifica al responsabile. Informativa: non richiede nessuna azione. */
  sendAbsenceNotice(n: AbsenceNotice): Promise<void>
}
