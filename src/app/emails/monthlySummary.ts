// app/emails/monthlySummary.ts

type Row = {
  user_id: string
  name: string
  ferie_days: number
  malattia_days: number
  // Questi due campi ora si sommano e si mostrano come "Permessi (ore)"
  // Se nel DB sono ancora MINUTI, dividili per 60 qui sotto (vedi commento).
  perm_entrata_count: number
  perm_uscita_count: number
}

export function renderMonthlySummaryEmail(
  rows: Row[],
  year: number,
  month: number
) {
  const mm = String(month).padStart(2,'0')
  const title = `Riepilogo mese ${mm}/${year}`

  const tableRows = rows.map(r => {
    // Se nel DB i permessi sono ancora in MINUTI, usa:
    // const permOre = (r.perm_entrata_count + r.perm_uscita_count) / 60
    // Altrimenti, se sono già in ORE:
    const permOre = r.perm_entrata_count + r.perm_uscita_count

    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${r.name}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${r.ferie_days}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${r.malattia_days}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${permOre}</td>
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
          </tr>
        </thead>
        <tbody>${tableRows || `
          <tr><td colspan="5" style="padding:12px;text-align:center;color:#64748b">Nessun dato per il mese selezionato.</td></tr>
        `}</tbody>
      </table>
    </div>
  </div>
  `
}
