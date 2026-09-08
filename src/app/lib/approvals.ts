// src/app/lib/approvals.ts
// Etichette e notifiche assenze, condivise client + server. Nessuna dipendenza server-only.

export type DbEventType =
  | 'FERIE'
  | 'SMART_WORKING'
  | 'PERMESSO_ENTRATA_ANTICIPATA'
  | 'PERMESSO_USCITA_ANTICIPATA'
  | 'MALATTIA'
  | 'PERMESSO_STUDIO'

/**
 * Tipi che fanno partire una notifica al responsabile.
 * L'evento e' comunque attivo da subito: nessuna approvazione richiesta.
 */
export const NOTIFY_TYPES: DbEventType[] = [
  'FERIE',
  'PERMESSO_USCITA_ANTICIPATA',
]

export const notifiesApprover = (type: string): boolean =>
  (NOTIFY_TYPES as string[]).includes(type)

export const eventTypeLabel = (type: string): string =>
  ({
    FERIE: 'Ferie',
    SMART_WORKING: 'Smart working',
    PERMESSO_ENTRATA_ANTICIPATA: 'Permesso entrata',
    PERMESSO_USCITA_ANTICIPATA: 'Permesso uscita',
    MALATTIA: 'Malattia',
    PERMESSO_STUDIO: 'Permesso studio',
  } as Record<string, string>)[type] ?? type

// ---------------------------------------------------------------------
// Formattazione date — sempre su fuso Europe/Rome, anche lato server (UTC)
// ---------------------------------------------------------------------
const TZ = 'Europe/Rome'

const fmtDate = new Intl.DateTimeFormat('it-IT', {
  timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric',
})
const fmtTime = new Intl.DateTimeFormat('it-IT', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit',
})

const isPermessoType = (t: string) => t.startsWith('PERMESSO_')

/** ends_at e' esclusivo (00:00 del giorno successivo): riporta l'ultimo giorno incluso. */
const lastIncludedDay = (endsAt: string) =>
  new Date(new Date(endsAt).getTime() - 24 * 60 * 60 * 1000)

export type EventLike = {
  type: string
  starts_at: string
  ends_at: string
  permesso_hours?: number | null
}

/** Testo leggibile del periodo, es. "dal 12 agosto 2026 al 20 agosto 2026". */
export function periodLabel(e: EventLike): string {
  const start = new Date(e.starts_at)

  if (isPermessoType(e.type)) {
    return `${fmtDate.format(start)} alle ${fmtTime.format(start)}`
  }

  const end = lastIncludedDay(e.ends_at)
  const sameDay = fmtDate.format(start) === fmtDate.format(end)
  return sameDay
    ? fmtDate.format(start)
    : `dal ${fmtDate.format(start)} al ${fmtDate.format(end)}`
}

/** Dettaglio secondario: ore per i permessi, giorni di calendario per il resto. */
export function detailLabel(e: EventLike): string {
  if (isPermessoType(e.type)) {
    const h = Number(e.permesso_hours ?? 0)
    return h ? `${h} ${h === 1 ? 'ora' : 'ore'}` : '—'
  }
  const start = new Date(e.starts_at)
  const end = lastIncludedDay(e.ends_at)
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  return `${days} ${days === 1 ? 'giorno' : 'giorni'}`
}
