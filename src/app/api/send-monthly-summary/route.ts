// src/app/api/send-monthly-summary/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '@/app/lib/supabaseAdmin'
import { renderMonthlySummaryEmail } from '@/app/emails/monthlySummary'

/* ------------------------- Supabase SSR helper ------------------------- */
async function createSSRClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 })
        },
      },
    }
  )
}
 
/* ------------------------ Admin check su profiles ---------------------- */
async function isAdminFromProfiles(userId: string): Promise<boolean> {
  const { data: prof } = await supabaseAdmin
    .from('profiles')
    .select('is_admin, role')
    .eq('id', userId)
    .maybeSingle()

  return prof?.is_admin === true || prof?.role === 'ADMIN'
}

/* ----------------------------- Authorization --------------------------- */
async function authorize(payload: any) {
  // 1) Secret per CRON/webhook
  const bodySecret = String(payload?.secret ?? '')
  if (process.env.CRON_SECRET && bodySecret === process.env.CRON_SECRET) {
    return { ok: true, reason: 'cron-secret' as const }
  }

  // 2) Sessione + admin
  const supabase = await createSSRClient()
  const { data: ures } = await supabase.auth.getUser()
  const user = ures?.user
  if (!user) return { ok: false, reason: 'no-session' as const }

  const admin = await isAdminFromProfiles(user.id)
  if (!admin) return { ok: false, reason: 'not-admin' as const }

  return { ok: true, reason: 'session-admin' as const }
}

/* --------------------------- Mail transporter -------------------------- */
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

/* -------------------------------- Handler ------------------------------ */
export async function POST(req: Request) {
  try {
    let payload: any = {}
    try { payload = await req.json() } catch {}

    const now = new Date()
    const year  = Number(payload?.year  ?? now.getFullYear())
    const month = Number(payload?.month ?? (now.getMonth() + 1))

    // Autorizzazione
    const auth = await authorize(payload)
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', reason: auth.reason },
        { status: 401 }
      )
    }

    // 1) Destinatari
    const { data: recipients, error: recErr } = await supabaseAdmin
      .from('profiles')
      .select('email, role')
      .in('role', ['ADMIN','MANAGER'])
      .not('email', 'is', null)

    if (recErr) {
      return NextResponse.json({ error: 'recipients-failed', details: recErr.message }, { status: 500 })
    }

    // 2) Righe per l’email (allinea al nome della tua view/tabella)
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('monthly_summary_view')
      .select('user_id,name,ferie_days,malattia_days,perm_entrata_count,perm_uscita_count,year,month')
      .eq('year', year)
      .eq('month', month)

    if (rowsErr) {
      return NextResponse.json({ error: 'rows-failed', details: rowsErr.message }, { status: 500 })
    }

    // 3) Render HTML (firma: rows, year, month)
    const html = renderMonthlySummaryEmail(rows ?? [], year, month)

    // 4) Invio email
    const toList = (recipients ?? []).map(r => r.email).filter(Boolean) as string[]
    if (toList.length === 0) {
      return NextResponse.json({ ok: true, note: 'Nessun destinatario' })
    }

    const transporter = buildTransport()
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: toList.join(','),
      subject: `Riepilogo ${String(month).padStart(2,'0')}/${year}`,
      html,
    })

    return NextResponse.json({ ok: true, mode: auth.reason, sent: toList.length })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'send-failed', details: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
