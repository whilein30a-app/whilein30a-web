// Supabase Edge Function: send-outbox
//
// Sends the emails that the database queued in email_outbox: new application,
// deal, event and plan request (to admin), and receipt, approval and rejection
// (to the business). Run it every minute from Supabase > Integrations > Cron.
//
// Deploy:   supabase functions deploy send-outbox --no-verify-jwt
// Secrets:  RESEND_API_KEY   (the in30a.app domain must be verified in Resend)
//           CRON_SECRET      (the same long random string as send-sponsor-report)
// Cron:     every minute, HTTP request (POST) to
//           https://<project>.supabase.co/functions/v1/send-outbox
//           with header  x-cron-secret: <CRON_SECRET>
//
// Without RESEND_API_KEY nothing is sent and nothing is lost: the rows wait.
// A row is tried up to 5 times, then left with its error for you to read.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FROM = 'in30A <hello@in30a.app>';
const jsonHeaders = { 'Content-Type': 'application/json' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function html(body: string, link: string | null): string {
  const paras = body.split(/\n\n+/).map((p) => `<p style="margin:0 0 14px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const button = link && /^https:\/\//.test(link)
    ? `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#0b6e6e;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Open the portal</a></p>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#1a2b2b">${paras}${button}<p style="color:#6b7a7a;font-size:12px;margin-top:28px">in30A Business Portal</p></div>`;
}

serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 401, headers: jsonHeaders });
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return new Response(JSON.stringify({ sent: 0, note: 'RESEND_API_KEY is not set. Emails are waiting in email_outbox.' }), { headers: jsonHeaders });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: rows, error } = await admin.rpc('outbox_claim', { p_limit: 25 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });

  let sent = 0;
  let failed = 0;
  for (const r of (rows ?? []) as Array<{ id: number; to_email: string; subject: string; body: string; link: string | null }>) {
    let problem = '';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [r.to_email], subject: r.subject, html: html(r.body, r.link), text: r.body + (r.link ? `\n\n${r.link}` : '') }),
      });
      if (!res.ok) problem = `resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      problem = String(e).slice(0, 200);
    }
    if (problem) {
      failed++;
      await admin.from('email_outbox').update({ last_error: problem }).eq('id', r.id);
    } else {
      sent++;
      await admin.from('email_outbox').update({ sent_at: new Date().toISOString(), last_error: null }).eq('id', r.id);
    }
  }
  console.log('send-outbox:', JSON.stringify({ sent, failed }));
  return new Response(JSON.stringify({ sent, failed }), { headers: jsonHeaders });
});
