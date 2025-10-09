// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'

/** ---- helper: controlla se l'utente loggato è ADMIN/MANAGER ---- */
async function isAdminFromProfiles() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
      },
    }
  )

  const { data: uRes } = await supabase.auth.getUser()
  const user = uRes?.user
  if (!user) return false

  const { data: prof } = await supabase
    .from('profiles')
    .select('is_admin, role')
    .eq('id', user.id)
    .single()

  return !!(prof?.is_admin || prof?.role === 'MANAGER')
}

/** ---- invio email riepilogo mese ---- */
async function sendMonthlySummary(year: number, month: number) {
  // 1) dati riepilogo dal DB
  const { data: rows, error: sumErr } = await supabaseAdmin
    .from('v_monthly_summaries')
    .select(
      'user_id,name,year,month,ferie_days,smart_days,malattia_days,perm_entrata_count,perm_uscita_count'
    )
    .eq('year', year)
    .eq('month', month)
  if (sumErr) throw sumErr

  // 2) destinatari admin via RPC
  type AdminEmailRow = { id: string; email: string | null }
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('admin_emails', {})
  if (rpcErr) throw rpcErr
  const recipients = (rpcData ?? [])
    .map((r: AdminEmailRow) => r.email)
    .filter((e: string | null): e is string => !!e && e.length > 0)

  // fallback opzionale per test
  const fallback = (process.env.MAIL_TO_TEST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const finalRecipients = recipients.length ? recipients : fallback
  if (!finalRecipients.length) {
    return { ok: false, recipients, message: 'Nessun admin con email (e nessun MAIL_TO_TEST).' }
  }

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

/** ---- POST (bottone/test manuale) ---- */
export async function POST(req: Request) {
  try {
    let payload: any = {}
    try {
      payload = await req.json()
    } catch {}
    const now = new Date()
    const year = Number(payload?.year ?? now.getFullYear())
    const month = Number(payload?.month ?? now.getMonth() + 1)
    const secret = String(payload?.secret ?? '')

    // Autorizzazione: o secret valido, o utente admin/manager
    const secretOk = !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
    const adminOk = await isAdminFromProfiles()

    if (!secretOk && !adminOk) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await sendMonthlySummary(year, month)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('send-monthly-summary POST error', err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}

/** ---- util fuso Europe/Rome ---- */
function romeParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
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

/** ---- GET per Vercel Cron ---- */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = String(url.searchParams.get('secret') ?? '')
    const ua = req.headers.get('user-agent') || ''
    const isVercelCron = ua.includes('vercel-cron/1.0')

    // Consenti a) cron Vercel, b) secret valido (per test manuali)
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
