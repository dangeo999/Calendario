// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

// ▼ opzionale: semplice secret per proteggere l'endpoint
const REQUIRE_SECRET = false

export async function POST(req: Request) {
  try {
    const toEmail = process.env.REPORT_RECIPIENT ?? 'd.neroni@geoconsultinformatica.it'

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true', // 465 -> true, 587 -> false
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    // Verifica connessione/credenziali
    await transporter.verify()

    const now = new Date()
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER, // deve spesso coincidere con SMTP_USER
      to: toEmail,
      subject: `Riepilogo ${now.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`,
      html: `<p>Test invio senza lookup.<br>${now.toISOString()}</p>`,
    })

    return NextResponse.json({ ok: true, sent_to: toEmail })
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'send-failed',
        message: err?.message,
        code: err?.code,
        command: err?.command,
        response: err?.response,
        responseCode: err?.responseCode,
        // utile per sanity check (senza password)
        debug: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER,
          from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
        },
      },
      { status: 500 }
    )
  }
}
