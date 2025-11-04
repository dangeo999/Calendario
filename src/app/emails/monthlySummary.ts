// app/emails/monthlySummary.ts

type Row = {
  user_id: string
  name: string
  ferie_days: number
  malattia_days: number
  perm_entrata_count: number
  perm_uscita_count: number
  perm_studio_count: number
  notes?: string | null
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// converte \n in <br> e mantiene i pallini “• ”
function renderNotes(n?: string | null) {
  if (!n) return ''
  return escapeHtml(n).replace(/\n/g, '<br>')
}

export function renderMonthlySummaryEmail(rows: Row[], year: number, month: number) {
  const mm = String(month).padStart(2, '0')
  const title = `Riepilogo mese ${mm}/${year}`

  const tableRows = (rows ?? []).map(r => {
    const permOre = Number(r.perm_entrata_count ?? 0) + Number(r.perm_uscita_count ?? 0)
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(r.name ?? r.user_id)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(r.ferie_days ?? 0)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(r.malattia_days ?? 0)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${permOre}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(r.perm_studio_count ?? 0)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;max-width:520px;word-wrap:break-word;white-space:pre-wrap">
          ${renderNotes(r.notes)}
        </td>
      </tr>
    `
  }).join('')

  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a">
    <h2 style="margin:0 0 12px">${title}</h2>
    <p style="margin:0 0 10px;color:#475569">Di seguito il riepilogo delle presenze/assenze del mese.</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0">
        <thead>
          <tr style="background:#f8fafc;color:#334155">
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e7eb">Utente</th>
            <th style="text-align:center;padding:10px;border-bottom:1px solid #e5e7eb">Ferie (gg)</th>
            <th style="text-align:center;padding:10px;border-bottom:1px solid #e5e7eb">Malattia (gg)</th>
            <th style="text-align:center;padding:10px;border-bottom:1px solid #e5e7eb">Permessi (ore)</th>
            <th style="text-align:center;padding:10px;border-bottom:1px solid #e5e7eb">Permessi Studio (ore)</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e7eb">Note</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || `
            <tr>
              <td colspan="6" style="padding:12px;text-align:center;color:#64748b">
                Nessun dato per il mese selezionato.
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  </div>
  `
}
