// ===============================
// 📧 monthlySummary.ts — versione compatibile email (Outlook friendly)
// ===============================

type Row = {
  user_id: string
  name: string
  ferie_days: number
  malattia_days: number
  perm_entrata_count: number
  perm_uscita_count: number
  perm_studio_count: number
}

type EventRow = {
  id?: string
  user_id: string
  type:
    | 'FERIE'
    | 'SMART_WORKING'
    | 'PERMESSO_ENTRATA_ANTICIPATA'
    | 'PERMESSO_USCITA_ANTICIPATA'
    | 'MALATTIA'
    | 'PERMESSO_STUDIO'
  starts_at: string
  ends_at?: string | null
  permesso_hours?: number | null
}

// info per un singolo giorno
type DayInfo = {
  ferie: boolean
  malattia: boolean
  perm: boolean      // permessi entrata/uscita
  studio: boolean    // permessi studio
  permHours: number  // ore permesso entr/usc
  studioHours: number // ore permesso studio
}

// palette (HEX) allineata alle tue variabili CSS:
// --evt-ferie:    #e53935;
// --evt-entrata:  #1e88e5;
// --evt-malattia: #d81b60;
// --evt-studio:   #f9a825;
const COLORS = {
  ferie: '#e53935',
  malattia: '#d81b60',
  permesso: '#1e88e5',
  studio: '#f9a825',
  neutral: '#e5e7eb',
  border: '#cbd5e1',
  text: '#1f2933',
  surface: '#f8fafc',
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// costruisce mappa utente → giorno → info
function buildDaysByUser(
  events: EventRow[],
  year: number,
  month: number
): Record<string, Record<number, DayInfo>> {
  const byUser: Record<string, Record<number, DayInfo>> = {}
  if (!events) return byUser

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 1)

  for (const e of events) {
    if (!e.starts_at) continue

    const start = new Date(e.starts_at)
    if (start < monthStart || start >= monthEnd) continue

    const uid = e.user_id
    if (!byUser[uid]) byUser[uid] = {}
    const d = start.getDate()

    if (!byUser[uid][d]) {
      byUser[uid][d] = {
        ferie: false,
        malattia: false,
        perm: false,
        studio: false,
        permHours: 0,
        studioHours: 0,
      }
    }

    const info = byUser[uid][d]
    const t = e.type.toUpperCase()
    const h = Number(e.permesso_hours || 0)

    if (t === 'FERIE') {
      info.ferie = true
    } else if (t === 'MALATTIA') {
      info.malattia = true
    } else if (t.indexOf('STUDIO') >= 0) {
      info.studio = true
      info.studioHours += h
    } else if (t.indexOf('PERMESSO') >= 0 || t.indexOf('ENTRATA') >= 0 || t.indexOf('USCITA') >= 0) {
      info.perm = true
      info.permHours += h
    }
  }

  return byUser
}

// mini calendario: tanti quadratini in linea + legenda testuale sotto
// mini calendario: tanti quadratini in linea + legenda testuale sotto
function renderMiniCalendarForUser(
  userId: string,
  daysByUser: Record<string, Record<number, DayInfo>>,
  year: number,
  month: number
): string {
  const infoByDay = daysByUser[userId] || {}
  const daysInMonth = new Date(year, month, 0).getDate()

  let cellsHtml = ''
  const legendParts: string[] = []

  const mmStr = String(month).padStart(2, '0')

  for (let d = 1; d <= daysInMonth; d++) {
    const info = infoByDay[d]
    let bg = COLORS.neutral

    if (info) {
      const ddStr = String(d).padStart(2, '0')
      const dateStr = `${ddStr}/${mmStr}`

      if (info.ferie) {
        bg = COLORS.ferie
        legendParts.push(`${dateStr} F`)
      } else if (info.malattia) {
        bg = COLORS.malattia
        legendParts.push(`${dateStr} M`)
      } else if (info.studio) {
        bg = COLORS.studio
        const h = info.studioHours || 0
        legendParts.push(
          h ? `${dateStr} S(${h}h)` : `${dateStr} S`
        )
      } else if (info.perm) {
        bg = COLORS.permesso
        const h = info.permHours || 0
        legendParts.push(
          h ? `${dateStr} P(${h}h)` : `${dateStr} P`
        )
      }
    }

    cellsHtml += `
      <td width="10" height="10" style="padding:0;margin:0;">
        <div style="
          width:10px;height:10px;
          background:${bg};
          border-radius:2px;
          margin-right:1px;
        ">&nbsp;</div>
      </td>
    `
  }

  const legendHtml =
    legendParts.length > 0
      ? `<div style="margin-top:2px;font-size:11px;color:#4b5563;">${legendParts.join(' · ')}</div>`
      : ''

  // tabella 1 riga con tutti i giorni in linea
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr>${cellsHtml}</tr>
    </table>
    ${legendHtml}
  `
}


// renderer principale
export function renderMonthlySummaryEmail(
  rows: Row[],
  year: number,
  month: number,
  events: EventRow[] = []
) {
  const mm = String(month).padStart(2, '0')
  const title = `Riepilogo mese ${mm}/${year}`
  const daysByUser = buildDaysByUser(events, year, month)

  const bodyRows = (rows || [])
    .map(r => {
      const permOre = Number(r.perm_entrata_count || 0) + Number(r.perm_uscita_count || 0)
      const miniCal = renderMiniCalendarForUser(r.user_id, daysByUser, year, month)

      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid ${COLORS.border};">
            ${escapeHtml(r.name || r.user_id)}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${COLORS.border};text-align:center;">
            ${r.ferie_days || 0}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${COLORS.border};text-align:center;">
            ${r.malattia_days || 0}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${COLORS.border};text-align:center;">
            ${permOre}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${COLORS.border};text-align:center;">
            ${r.perm_studio_count || 0}
          </td>
          <td style="padding:6px;border-bottom:1px solid ${COLORS.border};">
            ${miniCal}
          </td>
        </tr>
      `
    })
    .join('')

  const tableBody =
    bodyRows ||
    `<tr><td colspan="6" style="padding:12px;text-align:center;color:#6b7280;">
        Nessun dato per il mese selezionato.
      </td></tr>`

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;color:${COLORS.text};">
    <h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>
    <p style="margin:0 0 10px;color:#4b5563;">
    Riepilogo delle presenze e dei permessi per il mese di ${mm}/${year}.
    </p>

    <div style="border:1px solid ${COLORS.border};border-radius:10px;overflow:hidden;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:${COLORS.surface};color:#1f2933;">
            <th align="left"  style="padding:10px;border-bottom:1px solid ${COLORS.border};">Utente</th>
            <th align="center" style="padding:10px;border-bottom:1px solid ${COLORS.border};">Ferie (gg)</th>
            <th align="center" style="padding:10px;border-bottom:1px solid ${COLORS.border};">Malattia (gg)</th>
            <th align="center" style="padding:10px;border-bottom:1px solid ${COLORS.border};">Permessi (ore)</th>
            <th align="center" style="padding:10px;border-bottom:1px solid ${COLORS.border};">Permessi Studio (ore)</th>
            <th align="left"  style="padding:10px;border-bottom:1px solid ${COLORS.border};">Calendario Permessi</th>
          </tr>
        </thead>
        <tbody>
          ${tableBody}
        </tbody>
      </table>
      <p style="text-align:center;margin-top:8px;font-size:11px;color:#4b5563;">
        <span style="display:inline-block;width:10px;height:10px;background:${COLORS.ferie};border-radius:2px;margin-right:3px;"></span> F = Ferie
        &nbsp;•&nbsp;
        <span style="display:inline-block;width:10px;height:10px;background:${COLORS.malattia};border-radius:2px;margin-right:3px;"></span> M = Malattia
        &nbsp;•&nbsp;
        <span style="display:inline-block;width:10px;height:10px;background:${COLORS.permesso};border-radius:2px;margin-right:3px;"></span> P = Permesso Entrata/Uscita
        &nbsp;•&nbsp;
        <span style="display:inline-block;width:10px;height:10px;background:${COLORS.studio};border-radius:2px;margin-right:3px;"></span> S = Permesso Studio
      </p>
    </div>

  </div>
  `
}
