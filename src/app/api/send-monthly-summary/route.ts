// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { year, month } = body

    if (!year || !month) {
      return NextResponse.json({ ok: false, error: 'Anno o mese mancanti' }, { status: 400 })
    }

    if (year < 2000 || year > 2100 || month < 1 || month > 12) {
      return NextResponse.json({ ok: false, error: 'Anno o mese non validi' }, { status: 400 })
    }

    const toEmail = process.env.MAIL_TO
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: 'Variabile MAIL_TO mancante' }, { status: 500 })
    }

    // Fetch tutti i profili non-admin
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('is_admin', false)
      .order('full_name')

    // Fetch riepilogo mensile per tutti gli utenti
    const { data: summaryData } = await supabaseAdmin
      .from('v_monthly_summaries')
      .select('user_id,name,year,month,ferie_days,smart_days,malattia_days,perm_entrata_count,perm_uscita_count,perm_studio_count')
      .eq('year', year)
      .eq('month', month)

    // Fetch eventi grezzi del mese
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = new Date(year, month, 1).toISOString().slice(0, 10) // primo giorno mese dopo
    const { data: events } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('starts_at', monthStart)
      .lt('starts_at', monthEnd)

    // Merge: tutti i dipendenti, anche quelli senza eventi
    const rows = (profiles || []).map(p => {
      const existing = (summaryData || []).find(r => r.user_id === p.id)
      return existing ?? {
        user_id: p.id,
        name: p.full_name || p.id.slice(0, 6),
        year,
        month,
        ferie_days: 0,
        smart_days: 0,
        malattia_days: 0,
        perm_entrata_count: 0,
        perm_uscita_count: 0,
        perm_studio_count: 0,
      }
    })

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Nessun dipendente trovato' }, { status: 400 })
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    await transporter.verify()

    const html = renderMonthlySummaryEmail(rows, year, month, events || [])
    const subject = `Riepilogo mese ${String(month).padStart(2, '0')}/${year}`

    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: toEmail,
      subject,
      html,
    })

    return NextResponse.json({
      ok: true,
      sent_to: toEmail,
      rows: rows.length,
    })
  } catch (err: any) {
    console.error('SMTP error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: err?.message,
        code: err?.code,
      },
      { status: 500 }
    )
  }
}
