// Supabase Edge Function: verify-ownership
//
// Proves a person owns the business they are claiming by sending a code to
// the phone number already listed publicly for that business (never a number
// the applicant typed), through Twilio Verify.
//
// Actions (POST JSON, signed-in user):
//   { action: 'options', application_id }              what the Apply page can offer
//   { action: 'start',   application_id, channel }     channel: 'sms' | 'call'
//   { action: 'check',   application_id, code }        6 digit code
//
// Deploy:  npx supabase functions deploy verify-ownership
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
//          (set them in your own terminal, see README_WEB_126.txt)
//
// Until the three secrets exist the function answers { configured: false }
// and the Apply page falls back to admin review.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

const MAX_STARTS = 3; // codes sent per application per 24 hours
const MAX_CHECKS = 6; // wrong guesses per application per 24 hours

function e164(raw: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (/^1[2-9]\d{9}$/.test(d)) return '+' + d;
  if (/^[2-9]\d{9}$/.test(d)) return '+1' + d;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Use POST' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  const user = u?.user;
  if (!user) return out({ error: 'Sign in first' }, 401);

  let body: { action?: string; application_id?: string; channel?: string; code?: string } = {};
  try {
    body = await req.json();
  } catch {
    return out({ error: 'Bad request' }, 400);
  }
  const appId = String(body.application_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(appId)) return out({ error: 'Bad application' }, 400);

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const service = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  const configured = !!(sid && token && service);

  if (body.action === 'options') {
    const { data, error } = await asUser.rpc('portal_verify_options', { p_app_id: appId });
    if (error) return out({ error: error.message }, 400);
    return out({ configured, ...(data as Record<string, unknown>) });
  }

  if (!configured) return out({ error: 'not_configured' }, 200);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: app } = await admin
    .from('business_applications')
    .select('id,user_id,status,claim_listing_id')
    .eq('id', appId)
    .maybeSingle();
  if (!app || app.user_id !== user.id) return out({ error: 'Application not found' }, 404);
  if (app.status !== 'pending') return out({ error: 'This application is already decided.' }, 400);
  if (!app.claim_listing_id) return out({ error: 'Only claims of an existing listing can be verified by phone.' }, 400);

  const { data: listing } = await admin.from('listings').select('phone').eq('id', app.claim_listing_id).maybeSingle();
  const to = e164(listing?.phone ?? null);
  if (!to) return out({ error: 'no_phone' }, 200);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = async (kind: 'start' | 'check') => {
    const { count: n } = await admin
      .from('verify_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', appId)
      .eq('kind', kind)
      .gte('created_at', since);
    return n ?? 0;
  };
  const twilio = (path: string, form: Record<string, string>) =>
    fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });

  if (body.action === 'start') {
    if ((await count('start')) >= MAX_STARTS) return out({ error: 'too_many' }, 200);
    const channel = body.channel === 'call' ? 'call' : 'sms';
    await admin.from('verify_attempts').insert({ application_id: appId, user_id: user.id, kind: 'start' });
    const res = await twilio('Verifications', { To: to, Channel: channel });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.error('twilio start failed', res.status, j?.code, j?.message);
      // 60203 = Twilio's own send limit reached for this number.
      return out({ error: j?.code === 60203 ? 'too_many' : 'send_failed' }, 200);
    }
    return out({ sent: true, channel, last4: to.slice(-4) });
  }

  if (body.action === 'check') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code.length < 4 || code.length > 10) return out({ error: 'bad_code' }, 200);
    if ((await count('check')) >= MAX_CHECKS) return out({ error: 'too_many' }, 200);
    await admin.from('verify_attempts').insert({ application_id: appId, user_id: user.id, kind: 'check' });
    const res = await twilio('VerificationCheck', { To: to, Code: code });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('twilio check failed', res.status, j?.code, j?.message);
      // 20404 = no code is waiting (expired or never sent).
      return out({ error: j?.code === 20404 ? 'expired' : 'check_failed' }, 200);
    }
    if (j?.status !== 'approved') return out({ verified: false });
    const { data: result, error } = await admin.rpc('service_verified_approve', { p_id: appId, p_method: 'phone_code' });
    if (error) {
      console.error('approve failed', error.message);
      return out({ error: 'approve_failed' }, 200);
    }
    return out({ verified: true, result });
  }

  return out({ error: 'Unknown action' }, 400);
});
