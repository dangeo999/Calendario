// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary' // se lo usi

// ⚠️ Per evitare abusi, tieni una semplice protezione via secret nell body
const REQUIRE_SECRET = true

export async function POST(req: Request) {
  try {
    // ---- sicurezza semplice (facoltativa ma consigliata) ----
    if (REQUIRE_SECRET) {
      let payload: any = {}
      try { payload = await req.json() } catch {}
      const secret = String(payload?.secret ?? '')
      if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    // ---- DESTINATARIO UNICO, SENZA LOOKUP ----
    const toEmail =
      process.env.REPORT_RECIPIENT // imposta su Vercel
      ?? 'd.neroni@geoconsultinformatica.it' // fallback hard-coded

    // ---- SMTP ----
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    })

    const now = new Date()
    const subject = `Riepilogo ${now.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`

    // Se hai un renderer HTML, usa quello. Altrimenti testo semplice per prova:
    const html = renderMonthlySummaryEmail
      ? renderMonthlySummaryEmail(/* dati */)
      : `<p>Ciao, questo è un test di invio riepilogo.</p>`

    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: toEmail,
      subject,
      html,
    })

    return NextResponse.json({ ok: true, sent_to: toEmail })
  } catch (err: any) {
    return NextResponse.json({ error: 'send-failed', details: err?.message }, { status: 500 })
  }
}
