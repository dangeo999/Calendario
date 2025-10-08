export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'

// --- helper comuni ---
async function sendMonthlySummary(year: number, month: number) {
  // 3) Dati riepilogo
  const { data: rows, error: sumErr } = await supabaseAdmin
    .from('v_monthly_summaries')
    .select('user_id,name,year,month,ferie_days,smart_days,malattia_days,perm_entrata_count,perm_uscita_count')
    .eq('year', year)
    .eq('month', month)
    .order('name', { ascending: true })
  if (sumErr) throw sumErr

  // 4) Destinatari tramite RPC
  type AdminEmailRow = { id: string; email: string | null }
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('admin_emails', {})
  if (rpcErr) throw rpcErr
  const adminEmails = (rpcData ?? []) as AdminEmailRow[]
  const recipients = adminEmails.map(r => r.email).filter((e): e is string => !!e && e.length > 0)

  // Fallback opzionale (dev)
  const fallback = (process.env.MAIL_TO_TEST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const finalRecipients = recipients.length ? recipients : fallback
  if (finalRecipients.length === 0) {
    return { ok: false, recipients, message: 'Nessun admin con email (e nessun MAIL_TO_TEST).' }
  }

  // 5) Invio email
  const html = renderMonthlySummaryEmail(rows ?? [], year, month)
  const subject = `Riepilogo mese ${String(month).padStart(2, '0')}/${year}`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  })

  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER!,
    to: finalRecipients.join(','),
    subject,
    html,
  })

  return { ok: true, recipients: finalRecipients, messageId: info.messageId }
}

// --- POST manuale (bottone/test) ---
export async function POST(req: Request) {
  try {
    let payload: unknown = {}
    try { payload = await req.json() } catch {}
    const p = payload as { year?: number; month?: number; secret?: string }
    const now = new Date()
    const year  = Number(p?.year ?? now.getFullYear())
    const month = Number(p?.month ?? (now.getMonth() + 1))
    const secret = String(p?.secret ?? '')

    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await sendMonthlySummary(year, month)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('send-monthly-summary POST error', err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}

// --- helper: fuso Europe/Rome ---
function romeParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d)
  const y = Number(parts.find(p => p.type === 'year')!.value)
  const m = Number(parts.find(p => p.type === 'month')!.value)
  const day = Number(parts.find(p => p.type === 'day')!.value)
  return { y, m, day }
}
function isSecondMondayRome(d = new Date()) {
  const { y, m, day } = romeParts(d)
  const first = new Date(Date.UTC(y, m - 1, 1, 12))
  const dow = first.getUTCDay() // 0=dom, 1=lun
  const firstMonday = 1 + ((1 - dow + 7) % 7)
  const secondMonday = firstMonday + 7
  return day === secondMonday
}

// --- GET per Vercel Cron ---
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = String(url.searchParams.get('secret') ?? '')
    const ua = req.headers.get('user-agent') || ''
    const isVercelCron = ua.includes('vercel-cron/1.0')

    // Consenti: a) cron Vercel, b) secret valido (per test manuali)
    if (process.env.CRON_SECRET && !isVercelCron && secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isSecondMondayRome(new Date())) {
      return NextResponse.json({ ok: true, skipped: 'not_second_monday' })
    }

    const { y, m } = romeParts(new Date())
    const result = await sendMonthlySummary(y, m)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('send-monthly-summary GET error', err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}
