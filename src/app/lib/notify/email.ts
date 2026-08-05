// src/app/lib/notify/email.ts
import nodemailer from 'nodemailer'
import type { ApprovalRequest, DecisionNotice, NotificationChannel } from './types'

const approverEmail = () => process.env.APPROVER_EMAIL || process.env.MAIL_TO || ''

const esc = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  })
}

function renderRequestEmail(r: ApprovalRequest): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid #eef2f7;color:#64748b;font-size:13px;width:110px;">${esc(label)}</td>
      <td style="padding:10px 0;border-top:1px solid #eef2f7;color:#0f172a;font-size:14px;font-weight:600;">${esc(value)}</td>
    </tr>`

  const btn = (href: string, label: string, bg: string) => `
    <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;border-radius:12px;background:${bg};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;">${esc(label)}</a>`

  return `<!doctype html>
<html lang="it"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 14px rgba(15,23,42,.08);">

        <tr><td style="padding:22px 26px;background:linear-gradient(135deg,#1e88e5,#1565c0);">
          <div style="color:#ffffff;font-size:18px;font-weight:700;">Nuova richiesta da approvare</div>
          <div style="color:rgba(255,255,255,.85);font-size:13px;margin-top:4px;">Calendario Geoconsult</div>
        </td></tr>

        <tr><td style="padding:22px 26px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row('Dipendente', r.requesterName)}
            ${row('Tipo', r.typeLabel)}
            ${row('Periodo', r.periodLabel)}
            ${row('Durata', r.detailLabel)}
            ${r.note ? row('Nota', r.note) : ''}
          </table>
        </td></tr>

        <tr><td align="center" style="padding:22px 26px 8px;">
          ${btn(r.approveUrl, 'Approva', '#059669')}
          &nbsp;&nbsp;
          ${btn(r.rejectUrl, 'Rifiuta', '#dc2626')}
        </td></tr>

        <tr><td style="padding:6px 26px 24px;">
          <div style="color:#94a3b8;font-size:11px;line-height:1.5;text-align:center;">
            Ti verra chiesta una conferma prima che la decisione diventi definitiva.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

export const emailChannel: NotificationChannel = {
  name: 'email',

  isConfigured() {
    return Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        approverEmail()
    )
  },

  async sendApprovalRequest(r) {
    await transporter().sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: approverEmail(),
      subject: `Richiesta ${r.typeLabel} — ${r.requesterName} (${r.periodLabel})`,
      html: renderRequestEmail(r),
      text:
        `Nuova richiesta da approvare\n\n` +
        `Dipendente: ${r.requesterName}\n` +
        `Tipo: ${r.typeLabel}\n` +
        `Periodo: ${r.periodLabel}\n` +
        `Durata: ${r.detailLabel}\n` +
        (r.note ? `Nota: ${r.note}\n` : '') +
        `\nApprova: ${r.approveUrl}\nRifiuta: ${r.rejectUrl}\n`,
    })
  },

  async sendDecisionAck(n: DecisionNotice) {
    const esito = n.decision === 'APPROVED' ? 'APPROVATA' : 'RIFIUTATA'
    await transporter().sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: approverEmail(),
      subject: `Richiesta ${esito} — ${n.requesterName}`,
      text:
        `Richiesta ${esito}.\n\n` +
        `Dipendente: ${n.requesterName}\n` +
        `Tipo: ${n.typeLabel}\n` +
        `Periodo: ${n.periodLabel}\n`,
    })
  },
}
