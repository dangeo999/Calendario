// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

// Protezione opzionale con secret
const REQUIRE_SECRET = true

export async function POST(req: Request) {
  try {
    // --- sicurezza semplice ---
    if (REQUIRE_SECRET) {
      let payload: any = {}
      try { payload = await req.json() } catch {}
      const secret = String(payload?.secret ?? '')
      if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    // --- destinatario fisso, niente lookup ---
    const toEmail =
      process.env.REPORT_RECIPIENT ?? 'd.neroni@geoconsultinformatica.it'

    // --- SMTP transporter ---
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

    // HTML semplice per prova (nessun render esterno)
    const html = `
      <div style="font-family:system-ui,Segoe UI,Arial">
        <h2>Riepilogo mensile (test)</h2>
        <p>Ciao Daniele,<br/>questo è un invio di test senza lookup.</p>
        <p style="font-size:12px;color:#666">Ora server: ${now.toISOString()}</p>
      </div>
    `

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
