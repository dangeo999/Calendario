// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'

/** ============ CONFIG SEMPLICE: destinatario forzato per ora ============ */
const TARGET_USER_ID = '984d8bb3-a659-40e5-a583-289408f6d9d7'

/** --------------------------- Mail transporter -------------------------- */
function buildTransport() {
  const secure = String(process.env.SMTP_SECURE ?? 'false') === 'true'
  const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587))
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  })
}

/** -------------------------------- Handler ------------------------------ */
export async function POST(req: Request) {
  try {
    // Body tollerante (per passare year/month manualmente se vuoi)
    let payload: any = {}
    try { payload = await req.json() } catch {}

    const now = new Date()
    const year  = Number.isFinite(+payload?.year)  ? +payload.year  : now.getFullYear()
    const month = Number.isFinite(+payload?.month) ? +payload.month : (now.getMonth() + 1)

    /** -------------------- 1) Risolvi destinatario singolo -------------------- */
    const { data: userRow, error: userErr } = await supabaseAdmin
      .schema('auth')
      .from('users')
      .select('id, email')
      .eq('id', TARGET_USER_ID)
      .maybeSingle()

    if (userErr) {
      return NextResponse.json(
        { error: 'recipient-lookup-failed', details: userErr.message },
        { status: 500 }
      )
    }

    const toEmail = userRow?.email
    if (!toEmail) {
      return NextResponse.json(
        { error: 'recipient-missing-email', details: `Nessuna email trovata per user ${TARGET_USER_ID}` },
        { status: 400 }
      )
    }

    /** ---------------- 2) Recupera righe per l’email dalla VIEW -------------- */
    type MailRow = {
      user_id: string
      name: string
      year: number
      month: number
      ferie_days: number
      malattia_days: number
      smart_days?: number | null
      perm_entrata_count: number
      perm_uscita_count: number
      notes?: string | null
    }

    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('monthly_summary_view')
      .select('user_id,name,year,month,ferie_days,malattia_days,smart_days,perm_entrata_count,perm_uscita_count,notes')
      .eq('year', year)
      .eq('month', month) as unknown as { data: MailRow[]; error: any }

    if (rowsErr) {
      return NextResponse.json(
        { error: 'rows-failed', details: rowsErr.message },
        { status: 500 }
      )
    }

    /** -------------------------- 3) Render email ----------------------------- */
    const emailHtml = renderMonthlySummaryEmail(rows ?? [], year, month)

    /** -------------------------- 4) Invio email ------------------------------ */
    const transporter = buildTransport()
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: toEmail,
      subject: `Riepilogo ${String(month).padStart(2, '0')}/${year}`,
      html: emailHtml,
    })

    return NextResponse.json({ ok: true, sent_to: toEmail, rows: (rows ?? []).length })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'send-failed', details: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
