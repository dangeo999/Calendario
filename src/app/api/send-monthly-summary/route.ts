import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const TARGET_USER_ID = '984d8bb3-a659-40e5-a583-289408f6d9d7'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // <-- deve essere la SERVICE ROLE (server only)
)

export async function POST(req: Request) {
  try {
    // 1) Destinatario con fallback da env o hard-coded
    let toEmail = process.env.TEST_RECIPIENT ?? ''

    if (!toEmail) {
      // 2) Prova a leggerlo da 'profiles'
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', TARGET_USER_ID)
        .single()

      if (prof?.email) toEmail = prof.email

      // 3) Se non c’è in profiles, prova dagli utenti auth
      if (!toEmail) {
        const { data: ures, error: uerr } =
          await supabaseAdmin.auth.admin.getUserById(TARGET_USER_ID)
        if (ures?.user?.email) toEmail = ures.user.email
      }
    }

    if (!toEmail) {
      return NextResponse.json(
        { error: 'recipient-lookup-failed', hint: 'Nessuna email in profiles/auth e nessun TEST_RECIPIENT' },
        { status: 400 }
      )
    }

    // ...genera l’HTML e invia
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! }
    })

    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: toEmail,
      subject: `Riepilogo ${new Date().toLocaleDateString('it-IT', { month: '2-digit', year: 'numeric' })}`,
      html: /* emailHtml */
        '<p>Test riepilogo</p>'
    })

    return NextResponse.json({ ok: true, sent_to: toEmail })
  } catch (err: any) {
    return NextResponse.json({ error: 'send-failed', details: err?.message }, { status: 500 })
  }
}
