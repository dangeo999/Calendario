// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { year, month, rows, events } = body

    if (!year || !month) {
      return NextResponse.json({ ok: false, error: 'Anno o mese mancanti' }, { status: 400 })
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Nessun dato da inviare' }, { status: 400 })
    }

    const toEmail = process.env.MAIL_TO
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: 'Variabile MAIL_TO mancante' }, { status: 500 })
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    await transporter.verify()

    // ✅ passa anche gli eventi
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
        response: err?.response,
      },
      { status: 500 }
    )
  }
}
